// import cron from "node-cron";
import { prisma } from "./config/db";
import { wait } from "./utils";
import Scraper from "./services/scraper";
import Database from "./services/db";

// cron.schedule("*/1 * * * *", async () => main(), {
//   scheduled: true,
// });

const main = async () => {
  const scraper = new Scraper();
  const db = new Database(prisma);
  // get all crawlable venues
  const venues = await prisma.venue.findMany({
    where: {
      crawlable: true,
    },
  });
  // for each venue get events
  for (const venue of venues) {
    console.log(`scraping ${venue.name}`);
    await wait(1000);
    const events = await scraper.getEvents(venue);
    console.log({
      events,
    });
    // await db.processAndCreateEvents(events);
  }
};

main();

// process.stdin.resume();
