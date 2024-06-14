import { PrismaClient } from "@prisma/client";
import { ScrapedEvent } from "../../utils/validation";
import {
  PrismaClientKnownRequestError,
  PrismaClientValidationError,
} from "@prisma/client/runtime/library";
import { Logger } from "../logger";
import { z } from "zod";
import { scrapedEventSchema } from "../../utils/validation";
import assert from "node:assert";

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

  async getVenues() {
    return await this.prisma.venue.findMany({
      where: {
        crawlable: true,
      },
    });
  }
  /**
   * Process array of normalized events and save to db
   */
  async processAndCreateEvents(scrapedEvents: ScrapedEvent[]) {
    const transactionData: ScrapedEvent[] = [];

    for (const event of scrapedEvents) {
      try {
        const validated = scrapedEventSchema.parse(event);
        const normalized = await this.checkForDuplicates(validated);

        if (!normalized) {
          Logger.info(`Skipping duplicate event: ${event.eventName}`);
          continue;
        }

        const artist = await this.maybeCreateArtist(normalized);

        transactionData.push({
          ...normalized,
          artistId: artist.id,
        });
      } catch (e: unknown) {
        Logger.error(`Error processing event: ${e}`);
      }
    }

    const txnResults = await Promise.all(
      transactionData.map(async (data) => {
        try {
          assert(data.artistId, "Artist ID is required");

          return await this.prisma.event.create({
            data: {
              name: data.eventName,
              startDate: new Date(data.startDate),
              endDate: new Date(data.endDate),
              artist: { connect: { id: data.artistId } },
              venue: { connect: { id: data.venueId } },
            },
          });
        } catch (error) {
          // Log the error and continue
          if (error instanceof PrismaClientKnownRequestError) {
            Logger.info(
              `Skipping duplicate event: ${data.eventName || data.artist}`,
            );
            return null;
          } else if (error instanceof PrismaClientValidationError) {
            throw new Error("Invalid data, throwing error");
          }
          Logger.error(`Failed to create event: ${error}`);
          return null;
        }
      }),
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
  ): Promise<ScrapedEvent> {
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
