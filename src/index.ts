import cron from "node-cron";
import { prisma } from "./config/db";
import { wait } from "./utils";
import Scraper from "./services/scraper";

cron.schedule(
  "*/1 * * * *",
  async () => {
    // get all crawlable venues
    const venues = await prisma.venue.findMany({
      where: {
        crawlable: true,
      },
    });
    // for each venue get events
    for (const venue of venues) {
      await wait(1000);
      const scraper = new Scraper(venue);
      const events = await scraper.getEvents(venue);
      console.log({ events });
    }
  },
  {
    scheduled: true,
  },
);

process.stdin.resume();
