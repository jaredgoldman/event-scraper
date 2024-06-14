// import cron from "node-cron";
import { prisma } from "./config/db";
import { wait, sendWithRetries } from "./utils";
import Scraper from "./services/scraper";
import Database from "./services/db";
import util from "util";
import { Logger, initLog } from "./services/logger";
import { Venue } from "@prisma/client";

// cron.schedule("*/1 * * * *", async () => main(), {
//   scheduled: true,
// });

const main = async () => {
  const db = new Database(prisma);

  for (const venue of await db.getVenues()) {
    try {
      const processedEvents = await sendWithRetries(() =>
        extractAndStoreEvents(venue, db),
      );
      await wait(5000);
      if (processedEvents.length === 0) {
        Logger.warn(`No events found for ${venue.name}`);
        continue;
      } else {
        Logger.info(
          `processed and stored ${processedEvents.length} events for ${venue.name}, waiting 5s`,
        );
      }
    } catch (e: unknown) {
      Logger.error(
        `Error scraping events for ${venue.name}.`,
        util.inspect(e, false, null, true),
      );
      continue;
    }
  }
  Logger.info("Scraping complete");
  // process.exit();
};

const extractAndStoreEvents = async (venue: Venue, db: Database) => {
  const scraper = new Scraper(venue);
  Logger.info(`scraping events for ${venue.name}`);
  const events = await scraper.getEvents();
  Logger.info(`scraped ${events.length} events from ${venue.name}`);
  return await db.processAndCreateEvents(events);
};

(async () => {
  Logger.info(initLog());
  while (true) {
    await main();
  }
})();
// process.stdin.resume();
