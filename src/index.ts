import cron from "node-cron";
import { prisma } from "./config/db";

cron.schedule(
  "*/1 * * * *",
  async () => {
    const venues = await prisma.venue.findMany({
      where: {
        crawlable: true,
      },
    });
  },
  {
    scheduled: true,
  },
);

process.stdin.resume();
