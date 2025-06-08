import { z } from 'zod'

export const scrapedEventSchema = z.object({
  artist: z.string().min(1),
  eventName: z.string().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional().nullable(),
  venueId: z.string(),
  artistId: z.string().optional(),
  unsure: z.boolean().optional().nullable(),
})

export type ScrapedEvent = z.infer<typeof scrapedEventSchema>
