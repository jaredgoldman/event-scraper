import { prisma } from "../config/db";
import env from "../config/env";

const main = async () => {
  console.info("seeding database 🌱")
  await prisma.venue.create({
    data: {
      name: "The Rex",
      address: "194 Queen St W",
      city: "Toronto",
      photoPath: "https://picsum.photos/200/300",
      photoName: "photo.jpg",
      instagramHandle: "@therextoronto",
      website: "therex.ca",
      latitude: 43.6509,
      longitude: -79.3883,
      crawlable: true,
      eventsPath: "events",
      phoneNumber: "416-598-2475",
      facebookLink: "https://www.facebook.com/therextoronto",
    },
  });
  await prisma.venue.create({
    data: {
      name: "Drom Taberna",
      address: "458 Queen St W",
      city: "Toronto",
      photoPath: "https://picsum.photos/200/300",
      photoName: "photo.jpg",
      instagramHandle: "@dromtaberna",
      website: "dromtaberna.com",
      latitude: 43.6479,
      longitude: -79.4004,
      crawlable: true,
      eventsPath: "events-9O8Cm",
      phoneNumber: "416-598-2475",
      facebookLink: "https://www.facebook.com/dromtaberna",
    },
  });
  await prisma.venue.create({
    data: {
      name: "Jazz Bistro",
      address: "251 Victoria St",
      city: "Toronto",
      photoPath: "https://picsum.photos/200/300",
      photoName: "photo.jpg",
      instagramHandle: "@jazzbistroto",
      website: "jazzbistro.ca",
      latitude: 43.6559,
      longitude: -79.3794,
      crawlable: true,
      eventsPath: "event-calendar",
      phoneNumber: "416-363-5299",
      facebookLink: "https://www.facebook.com/JazzBistroTO",
    },
  });
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
  console.info("seeding complete 💪")
};

main();
