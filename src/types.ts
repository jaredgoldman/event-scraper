import { Prisma } from '@prisma/client'
import { AI_PROVIDERS } from './const'

export type EventWithArtistVenue = Prisma.EventGetPayload<{
  include: { artist: true; venue: true }
}>

export interface VenueConfig {
  typicalShowTimes: {
    startTime: string // Format: "HH:mm"
    endTime: string // Format: "HH:mm"
  }[]
}

export type AI_PROVIDER = (typeof AI_PROVIDERS)[keyof typeof AI_PROVIDERS]
