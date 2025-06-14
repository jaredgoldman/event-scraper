import { z } from 'zod'

// Helper function to normalize artist names for comparison
const normalizeArtistName = (name: string): string => {
  return name.toLowerCase().trim()
}

// Helper function to deduplicate events
const deduplicateEvents = (events: z.infer<typeof scrapedEventSchema>[]): z.infer<typeof scrapedEventSchema>[] => {
  const seen = new Set<string>()
  return events.filter(event => {
    // Create a unique key based on artist name, start date, and venue
    const key = `${normalizeArtistName(event.artist)}|${event.startDate}|${event.venueId}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export const scrapedEventSchema = z.object({
  artist: z.string().min(1),
  eventName: z.string().optional(),
  startDate: z.string().refine((val) => {
    try {
      const date = new Date(val)
      return !isNaN(date.getTime())
    } catch {
      return false
    }
  }, "Invalid datetime"),
  endDate: z.string().optional().nullable().refine((val) => {
    if (!val) return true
    try {
      const date = new Date(val)
      return !isNaN(date.getTime())
    } catch {
      return false
    }
  }, "Invalid datetime"),
  venueId: z.string(),
  artistId: z.string().optional(),
  unsure: z.boolean().optional().nullable(),
})

// Create a schema for an array of events that automatically deduplicates
export const scrapedEventsSchema = z.array(scrapedEventSchema).transform(deduplicateEvents)

export type ScrapedEvent = z.infer<typeof scrapedEventSchema>
