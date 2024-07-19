import { Prisma } from "@prisma/client";

export type EventWithArtistVenue = Prisma.EventGetPayload<{
  include: { artist: true; venue: true };
}>;
