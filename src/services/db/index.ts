import { PrismaClient, Venue } from "@prisma/client";
import { ScrapedEvent } from "../../utils/validation";
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
    const transactionData: ScrapedEvent[] = [];
    const variousArtist = await this.prisma.artist.findUnique({
      where: { name: "Various" },
    });

    if (!variousArtist) {
      throw new Error("Various artist not found");
    }

    for (const event of scrapedEvents) {
      let normalized: ScrapedEvent | undefined;
      try {
        const validated = scrapedEventSchema.parse(event);

        if (!validated?.endDate) {
          validated.endDate = DateTime.fromISO(validated.startDate)
            .plus({
              hours: 2,
            })
            .toISO() as string;
        }

        normalized = await this.checkForDuplicates(validated);

        if (!normalized) {
          logger.debug(
            `Skipping duplicate event: ${event.eventName ? event.eventName : event.artist}`,
          );
          continue;
        }

        const artist = await this.maybeCreateArtist(normalized);

        transactionData.push({
          ...normalized,
          artistId: artist.id,
        });
      } catch (e: unknown) {
        if (event.eventName && !event.artist && normalized) {
          /*
           * If we have an event name but no artist, we can assume it's a
           * various event
           */
          transactionData.push({ ...normalized, artistId: variousArtist.id });
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

            const startDate = DateTime.fromISO(data.startDate).setZone(
              "America/Toronto",
            );

            const endDate = data.endDate
              ? DateTime.fromISO(data.endDate).setZone("America/Toronto")
              : startDate.plus({ hours: 2 });

            if (startDate < DateTime.now()) {
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
   * Process scraped event data and return a partial event
   * Skip duplicates and cancel events that have been rescheduled
   * @param {ScrapedEvent} scrapedEvent
   * @param {string} venueId
   */
  private async checkForDuplicates(
    scrapedEvent: ScrapedEvent,
  ): Promise<ScrapedEvent | undefined> {
    const existingEvent = await this.prisma.event.findUnique({
      where: {
        startDate_venueId: {
          venueId: scrapedEvent.venueId,
          startDate: scrapedEvent.startDate,
        },
      },
      include: {
        artist: true,
        venue: true,
      },
    });

    if (existingEvent) {
      // If event is duplicate skip
      if (
        existingEvent.artist.name.toLowerCase() ===
        scrapedEvent.artist.toLowerCase()
      ) {
        return;
      }
      // if event name is different, deactive previous event
      // and create new one
      else {
        await this.prisma.event.update({
          where: { id: existingEvent.id },
          data: { cancelled: true },
        });
      }
    }

    return scrapedEvent;
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
        },
      });
    }

    return artist;
  }
}
