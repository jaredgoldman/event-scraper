// import cron from "node-cron";
import { prisma } from "./config/db";
import { wait } from "./utils";
import Scraper from "./services/scraper";
import Database from "./services/db";
import util from "util";
import { Logger, initLog } from "./services/logger";

// cron.schedule("*/1 * * * *", async () => main(), {
//   scheduled: true,
// });

const main = async () => {
  initLog();
  const db = new Database(prisma);

  const venues = await prisma.venue.findMany({
    where: {
      crawlable: true,
    },
  });

  for (const venue of venues) {
    try {
      Logger.info(`scraping ${venue.name}`);
      const scraper = new Scraper(venue);
      const events = await scraper.getEvents();
      Logger.info(`scraped ${events.length} events from ${venue.name}`);
      const processedEvents = await db.processAndCreateEvents(events);
      await wait(5000);
      Logger.info(
        `processed and stored ${processedEvents.length} events for ${venue.name}, waiting 30s`,
      );
    } catch (e: unknown) {
      Logger.error(
        `Error scraping events for ${venue.name}.`,
        util.inspect(e, false, null, true),
      );
      continue;
    }
  }
  Logger.info("Scraping complete");
  process.exit();
};

main();

// process.stdin.resume();
