import { z } from "zod";

export const scrapedEventSchema = z.object({
  artist: z.string().min(1),
  eventName: z.string().optional(),
  startDate: z.string().min(24),
  endDate: z.string().optional(),
  venueId: z.string(),
  artistId: z.string().optional(),
  unsure: z.boolean(),
});

export type ScrapedEvent = z.infer<typeof scrapedEventSchema>;
