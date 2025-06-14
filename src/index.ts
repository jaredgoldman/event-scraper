import cron from 'node-cron'
import { prisma } from './config/db'
import { getAiConfig, wait } from './utils'
import { AiService, DbService, ScraperService } from './services'
import { logger, initLog } from './services/logger'
import { Venue } from '@prisma/client'
import util from 'util'
import { env } from './config'
import { getVenueConfig } from './config/venues'

const db = new DbService(prisma)

const AI_PROVIDERS = [
  'OPENAI',
  'ANTHROPIC',
  'GOOGLE',
  // 'GROQ', 'COHERE',
]

/**
 * Extract and store events for a venue
 * @param {Venue} venue
 */
const extractAndStoreEvents = async (venue: Venue, docsOverride?: any) => {
  // Get events for the current month
  const eventsThisMonth = await db.getEventsThisMonthByVenue(venue)
  // Use pre-chunked docs if provided, else scrape and chunk
  let docs = docsOverride
  if (!docs) {
    const scraperService = new ScraperService(venue)
    const pageContent = await scraperService.scrapePage()
    // Use AiService just for chunking
    const aiService = new AiService(
      venue,
      eventsThisMonth,
      getVenueConfig(venue.name),
      getAiConfig()
    )
    docs = await aiService.transformHtmlToText([
      {
        pageContent: pageContent[0].pageContent,
        metadata: pageContent[0].metadata,
      },
    ])
  }

  // structured data from the (possibly pre-chunked) docs
  const aiService = new AiService(
    venue,
    eventsThisMonth,
    getVenueConfig(venue.name),
    getAiConfig()
  )

  const events = await aiService.parseScrapedHTML(docs)

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

      await wait(env.VENUE_TIMEOUT)
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

const scrapeAndProcessAllProviders = async () => {
  for (const venue of await db.getVenues()) {
    logger.info(`scraping events for ${venue.name}`)
    // Scrape and chunk ONCE per venue
    const eventsThisMonth = await db.getEventsThisMonthByVenue(venue)
    const scraperService = new ScraperService(venue)
    const pageContent = await scraperService.scrapePage()
    // Use AiService just for chunking (default provider)
    const aiService = new AiService(
      venue,
      eventsThisMonth,
      getVenueConfig(venue.name),
      getAiConfig()
    )
    const docs = await aiService.transformHtmlToText([
      {
        pageContent: pageContent[0].pageContent,
        metadata: pageContent[0].metadata,
      },
    ])

    for (const provider of AI_PROVIDERS) {
      logger.info(`Running multi-provider scraper with AI_PROVIDER=${provider}`)
      process.env.AI_PROVIDER = provider
      // Use the same docs, but new AI/embeddings/config for each provider
      const aiService = new AiService(
        venue,
        eventsThisMonth,
        getVenueConfig(venue.name),
        getAiConfig()
      )
      const events = await aiService.parseScrapedHTML(docs)
      if (!Array.isArray(events)) {
        logger.error('Invalid data, expected array', events)
        continue
      }
      logger.debug(
        `Scraped ${events.length} events for ${venue.name} with provider ${provider}: ${util.inspect(events, false, null, true)}`
      )
      await db.processAndCreateEvents(events)
      await wait(env.VENUE_TIMEOUT)
    }
  }
  logger.info(`All venues scraped for all providers, going back to sleep..💤`)
  process.exit(-1)
}

/*
 * Main entrypoint
 */
initLog()

const main = env.MULTI_PROVIDER
  ? scrapeAndProcessAllProviders
  : scrapeAndProcess

switch (env.NODE_ENV) {
  case 'production':
    if (env.SCHEDULE_CHRON) {
      cron.schedule(env.CRON_SCHEDULE, async () => await main(), {
        scheduled: true,
      })
    } else {
      main()
    }
    break
  case 'test':
  case 'development':
    main()
    break
}
