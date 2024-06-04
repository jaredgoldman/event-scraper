import { PrismaClient, Event } from "@prisma/client";
import { ScrapedEvent } from "~/types/*";

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
   * Process array of normalized events and save to db
   */
  async processAndCreateEvents(scrapedEvents: ScrapedEvent[]) {
    const transactionData: ScrapedEvent[] = [];

    for (const event of scrapedEvents) {
      const normalized = await this.checkForDuplicates(event);

      if (!normalized) continue;

      const artist = await this.maybeCreateArtist(normalized);

      transactionData.push({
        ...normalized,
        artistId: artist.id,
      });
    }

    await this.prisma.$transaction([
      ...transactionData.map((data) => {
        if (!data.artistId) throw new Error("Artist id not found");
        return this.prisma.event.create({
          data: {
            name: data.artist,
            startDate: new Date(data.startDate),
            endDate: new Date(data.endDate),
            artist: { connect: { id: data.artistId } },
            venue: { connect: { id: data.venueId } },
          },
        });
      }),
    ]);
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
