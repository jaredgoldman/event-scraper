import { Event, PrismaClient, Venue } from "@prisma/client";
import { ScrapedEvent } from "../../utils/validation";
import { EventWithArtistVenue } from "../../types";
import {
  PrismaClientKnownRequestError,
  PrismaClientValidationError,
} from "@prisma/client/runtime/library";
import { logger } from "../logger";
import { scrapedEventSchema } from "../../utils/validation";
import assert from "node:assert";
import { DateTime } from "luxon";
import env from "../../config/env";

/**
 * Class responsible for db interactions
 * TODO: create event cache to reduce db fetches
 */
export default class Database {
  private prisma: PrismaClient;

  /**
   * @param {PrismaClient} prisma
   */
  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Fetch venues that are crawlable
   */
  async getVenues() {
    return await this.prisma.venue.findMany({
      where: {
        crawlable: true,
      },
    });
  }

  /**
   * Get events for the current month
   */
  async getEventsThisMonthByVenue(venue: Venue) {
    return await this.prisma.event.findMany({
      where: {
        startDate: {
          gte: DateTime.now()
            .setZone("America/Toronto")
            .startOf("month")
            .toJSDate(),
          lte: DateTime.now()
            .setZone("America/Toronto")
            .endOf("month")
            .toJSDate(),
        },
        venueId: venue.id,
      },
    });
  }
  /**
   * Process array of normalized events and save to db
   */
  async processAndCreateEvents(scrapedEvents: ScrapedEvent[]) {
    const transactionData: (ScrapedEvent & { conflict: boolean })[] = [];
    const variousArtist = await this.prisma.artist.findUnique({
      where: { name: "Various" },
    });

    if (!variousArtist) {
      throw new Error("Various artist not found");
    }

    for (const event of scrapedEvents) {
      let isConflict = false;
      try {
        const validated = scrapedEventSchema.parse(event);

        if (!validated?.endDate) {
          validated.endDate = DateTime.fromISO(validated.startDate)
            .plus({
              hours: 2,
            })
            .toISO() as string;
        }

        const { conflictEvent, isDuplicate } =
          await this.checkForDuplicatesAndConflicts(validated);

        if (isDuplicate) {
          logger.debug(
            `Skipping duplicate event: ${event.eventName ? event.eventName : event.artist}`,
          );
          continue;
        }

        /*
         * TODO: Implement conflicting event functionality
         */
        if (conflictEvent) {
          logger.debug(
            `Found conflicting event: ${conflictEvent.name ? conflictEvent.name : conflictEvent.artist.name}`,
          );
          isConflict = true;
          await this.updateConflictingEvent(conflictEvent);
        }

        const artist = await this.maybeCreateArtist(event);

        transactionData.push({
          ...event,
          artistId: artist.id,
          conflict: isConflict,
        });
      } catch (e: unknown) {
        if (event.eventName && !event.artist && event) {
          /*
           * If we have an event name but no artist, we can assume it's a
           * various event
           */
          transactionData.push({
            ...event,
            conflict: isConflict,
            artistId: variousArtist.id,
          });
        } else {
          logger.error(`Error processing event: ${e}`, event);
        }
      }
    }

    const txnResults = await Promise.all(
      transactionData
        .map(async (data) => {
          try {
            assert(data.artistId, "Artist ID is required");

            const startDate = DateTime.fromISO(data.startDate)
              // Set the year to the current year always
              .set({ year: DateTime.now().year })
              .setZone("America/Toronto");

            const endDate = data.endDate
              ? DateTime.fromISO(data.endDate).setZone("America/Toronto")
              : startDate.plus({ hours: 2 });

            if (startDate < DateTime.now().minus({ days: 3 })) {
              logger.debug(
                `Skipping event in the past: ${data.eventName || data.artist}`,
              );
              return null;
            }

            return await this.prisma.event.create({
              data: {
                name: data.eventName ?? "",
                startDate: startDate.toJSDate(),
                endDate: endDate.toJSDate(),
                conflict: data.conflict,
                artist: { connect: { id: data.artistId } },
                venue: { connect: { id: data.venueId } },
                approved: !Boolean(env.NODE_ENV === "development"),
              },
            });
          } catch (error) {
            // Log the error and continue
            if (error instanceof PrismaClientKnownRequestError) {
              logger.debug(
                `Skipping duplicate event: ${data.eventName || data.artist}`,
              );
              return null;
            } else if (error instanceof PrismaClientValidationError) {
              throw new Error("Invalid data, throwing error");
            }
            logger.error(`Failed to create event: ${error}`);
            return null;
          }
        })
        .filter(Boolean),
    );

    // Filter out the null results
    return txnResults.filter((result) => result !== null);
  }

  /**
   * Check for duplicate events, i.e. events that are within 4 hours of each other
   * with the same name and venue
   * @param {ScrapedEvent} scrapedEvent
   * @returns {Promise<{ scrapedEvent: ScrapedEvent; conflictEvent: Event; isDuplicate: boolean }>}
   */
  private async checkForDuplicatesAndConflicts(
    scrapedEvent: ScrapedEvent,
  ): Promise<{
    scrapedEvent: ScrapedEvent;
    conflictEvent: EventWithArtistVenue | null;
    isDuplicate: boolean;
  }> {
    const existingEvent = await this.prisma.event.findFirst({
      where: {
        startDate: {
          lte: DateTime.fromISO(scrapedEvent.startDate)
            .set({ year: DateTime.now().year })
            .plus({ hours: 4 })
            .toJSDate(),
          gte: DateTime.fromISO(scrapedEvent.startDate)
            .minus({ hours: 4 })
            .toJSDate(),
        },
        venueId: scrapedEvent.venueId,
        artist: {
          name: {
            contains: scrapedEvent.artist,
            mode: "insensitive",
          },
        },
      },
      include: {
        artist: true,
        venue: true,
      },
    });

    // event is duplicate if it has the same start time
    const isDuplicate = Boolean(
      existingEvent &&
        DateTime.fromJSDate(existingEvent?.startDate) ===
          DateTime.fromISO(scrapedEvent.startDate),
    );

    return {
      scrapedEvent,
      conflictEvent: existingEvent,
      isDuplicate: isDuplicate,
    };
  }

  /**
   * Find or create aritst
   * @param {ScrapedEvent} scrapedEvent
   * TODO: rely on artist cache and/or figure our how to optimize
   */
  private async maybeCreateArtist(scrapedEvent: ScrapedEvent) {
    let artist = await this.prisma.artist.findUnique({
      where: {
        name: scrapedEvent.artist,
      },
    });

    if (!artist) {
      artist = await this.prisma.artist.create({
        data: {
          name: scrapedEvent.artist,
          approved: true,
        },
      });
    }

    return artist;
  }

  /**
   * Update event with conflicting event
   * @param {Event} event
   */
  private async updateConflictingEvent(event: Event) {
    // we would like to add a conflicting event to the conflicting event fields
    await this.prisma.event.update({
      where: {
        id: event.id,
      },
      data: {
        conflictingEvents: {
          connect: {
            id: event.id,
          },
        },
      },
    });
  }
}
