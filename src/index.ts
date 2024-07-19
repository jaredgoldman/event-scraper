import cron from "node-cron";
import { prisma } from "./config/db";
import { wait } from "./utils";
import Scraper from "./services/scraper";
import Database from "./services/db";
import util from "util";
import { logger, initLog } from "./services/logger";
import { Venue, Event } from "@prisma/client";
import env from "./config/env";

const db = new Database(prisma);
initLog();

/**
 * Main function
 */
const main = async () => {
  await scrapeAndProcess(db);
  process.exit(0);
};

/**
 * Scrape and process events for all venues
 * @param {Database} db
 */
const scrapeAndProcess = async (db: Database) => {
  let processedEventCount = 0;
  for (const venue of await db.getVenues()) {
    logger.info(`scraping events for ${venue.name}`);
    try {
      const events = await db.getEventsThisMonthByVenue(venue);
      const processedEvents = await extractAndStoreEvents(venue, db, events);
      logger.debug(
        `scraped ${processedEvents.length} events from ${venue.name}`,
      );
      processedEventCount += processedEvents.length;
      await wait(5000);
      if (processedEvents.length === 0) {
        logger.warn(`No events found for ${venue.name}`);
        continue;
      } else {
        logger.info(
          `${processedEvents.length} events processed for for ${venue.name}`,
        );
      }
    } catch (e: unknown) {
      logger.error(
        `Error scraping events for ${venue.name}.`,
        util.inspect(e, false, null, true),
      );
      continue;
    }
  }
  logger.info(
    `All venues scraped, ${processedEventCount} events added going back to sleep..💤`,
  );
};

/**
 * Extract and store events for a venue
 * @param {Venue} venue
 * @param {Database} db
 * @param {Event[]} eventsThisMonth
 */
const extractAndStoreEvents = async (
  venue: Venue,
  db: Database,
  eventsThisMonth: Event[],
) => {
  const scraper = new Scraper(venue, eventsThisMonth);
  const events = await scraper.getEvents();
  if (!Array.isArray(events)) {
    logger.error("Invalid data, expected array", events);
    return [];
  }
  logger.debug(
    `Scraped ${events.length} events for ${venue.name}: ${util.inspect(events, false, null, true)}`,
  );
  return await db.processAndCreateEvents(events);
};

switch (env.NODE_ENV) {
  case "production":
    if (env.SCHEDULE_CHRON) {
      cron.schedule(env.CRON_SCHEDULE, async () => await main(), {
        scheduled: true,
      });
    } else {
      main()
    }
    break;
  case "test":
  case "development":
    main();
    break;
}
