import { Prisma } from '@prisma/client'

export type EventWithArtistVenue = Prisma.EventGetPayload<{
  include: { artist: true; venue: true }
}>

export interface VenueConfig {
  typicalShowTimes: {
    startTime: string; // Format: "HH:mm"
    endTime: string;   // Format: "HH:mm"
  }[];
}
