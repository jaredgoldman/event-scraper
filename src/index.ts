import cron from 'node-cron'
import { prisma } from './config/db'
import { getAiStuff, wait } from './utils'
import { AiService, DbService, ScraperService } from './services'
import { logger, initLog } from './services/logger'
import { Venue } from '@prisma/client'
import util from 'util'
import { env } from './config'

const db = new DbService(prisma)

/**
 * Extract and store events for a venue
 * @param {Venue} venue
 */
const extractAndStoreEvents = async (venue: Venue) => {
  const { ai, embeddings } = getAiStuff()
  // Get events for the current month
  const eventsThisMonth = await db.getEventsThisMonthByVenue(venue)
  // Scrape the venue's events page
  const scraperService = new ScraperService(venue)
  const pageContent = await scraperService.scrapePage()
  // structured data from the scraped page
  const aiService = new AiService(ai, embeddings, venue, eventsThisMonth)
  const events = await aiService.parseScrapedHTML(pageContent)

  if (!Array.isArray(events)) {
    logger.error('Invalid data, expected array', events)
    return []
  }
  logger.debug(
    `Scraped ${events.length} events for ${venue.name}: ${util.inspect(events, false, null, true)}`
  )
  return await db.processAndCreateEvents(events)
}

/**
 * Scrape and process events for all venues
 */
const scrapeAndProcess = async () => {
  let processedEventCount = 0

  for (const venue of await db.getVenues()) {
    try {
      logger.info(`scraping events for ${venue.name}`)

      const processedEvents = await extractAndStoreEvents(venue)

      logger.debug(
        `scraped ${processedEvents.length} events from ${venue.name}`
      )

      processedEventCount += processedEvents.length

      await wait(5000)
      if (processedEvents.length === 0) {
        logger.warn(`No events found for ${venue.name}`)

        continue
      } else {
        logger.info(
          `${processedEvents.length} events processed for for ${venue.name}`
        )
      }
    } catch (e: unknown) {
      logger.error(
        `Error scraping events for ${venue.name}.`,
        util.inspect(e, false, null, true)
      )

      continue
    }
  }
  logger.info(
    `All venues scraped, ${processedEventCount} events added going back to sleep..💤`
  )
  process.exit(-1)
}

/*
 * Main entrypoint
 */
initLog()

switch (env.NODE_ENV) {
  case 'production':
    if (env.SCHEDULE_CHRON) {
      cron.schedule(env.CRON_SCHEDULE, async () => await scrapeAndProcess(), {
        scheduled: true,
      })
    } else {
      scrapeAndProcess()
    }
    break
  case 'test':
  case 'development':
    scrapeAndProcess()
    break
}
