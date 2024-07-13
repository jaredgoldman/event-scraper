import { prisma } from "../config/db";
import env from "../config/env";
import venues from "./data/venues.json";

const main = async () => {
  console.info("seeding database 🌱");
  const added =await prisma.venue.createMany({ data: venues });
  console.log(added)
  await prisma.admin.create({
    data: {
      email: env.ADMIN_EMAIL,
    },
  });
  await prisma.artist.create({
    data: {
      name: "Various",
      approved: true,
    },
  });
  console.info("seeding complete 💪");
};

main();
