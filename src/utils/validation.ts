import { z } from "zod";

export const scrapedEventSchema = z.object({
  artist: z.string(),
  eventName: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  venueId: z.string(),
  artistId: z.string().optional(),
});

export type ScrapedEvent = z.infer<typeof scrapedEventSchema>;
