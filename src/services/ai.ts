import { Ai, Embeddings } from '../utils'
import { Venue, Event } from '@prisma/client'
import { extract } from '../prompts'
import {
  scrapedEventSchema,
  scrapedEventsSchema,
  ScrapedEvent,
  executeWithRetry,
  convertToTimeZone,
} from '../utils'
import { DocumentInterface } from '@langchain/core/documents'
import { RunnableSequence } from '@langchain/core/runnables'
import { z } from 'zod'
import { logger } from './'
import { HNSWLib } from '@langchain/community/vectorstores/hnswlib'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { HtmlToTextTransformer } from '@langchain/community/document_transformers/html_to_text'
import util from 'util'
import { VenueConfig } from '../types'
import { createHtmlToTextTransformer } from '../config/transformers'
import { cleanAndParseJson } from '../utils/json'

export class AiService {
  private ai: Ai
  private embeddings: Embeddings
  private chunkSize = 2000
  private originalHtml: string | null = null
  private eventSchema = scrapedEventSchema
  private eventsSchema = scrapedEventsSchema
  private venue: Venue
  private venueConfig: VenueConfig | null
  private ragChain: RunnableSequence | null = null
  private eventsThisMonth: Event[]
  private aiConfig: { refineEvents: boolean }

  constructor(
    ai: Ai,
    embeddings: Embeddings,
    venue: Venue,
    eventsThisMonth: Event[],
    venueConfig?: VenueConfig,
    aiConfig: { refineEvents: boolean } = { refineEvents: false }
  ) {
    this.ai = ai
    this.embeddings = embeddings
    this.venue = venue
    this.eventsThisMonth = eventsThisMonth
    this.venueConfig = venueConfig || null
    this.aiConfig = aiConfig
  }

  private getVenueConfigContext(): string {
    if (!this.venueConfig) return '';
    
    const showTimes = this.venueConfig.typicalShowTimes
      .map(time => `${time.startTime} - ${time.endTime}`)
      .join(', ');
    
    return `\nVenue typically has shows at these times: ${showTimes}`;
  }

  /**
   * Call the RagChain to extract structured data from the retrieved documents.
   * @param {DocumentInterface<Record<string, any>>[]} context - The context documents to provide to the RagChain.
   */
  private async callRagChain(
    context: DocumentInterface<Record<string, any>>[]
  ): Promise<ScrapedEvent[] | undefined> {
    const events = this.eventsThisMonth.map((event) => ({
      ...event,
      venueName: this.venue.name,
    }))

    if (!this.ragChain) {
      const extract = `Extract all events from the provided HTML content.
        Events may be described in paragraphs, not just tables or lists. If you see a date, artist, and time in the same chunk, extract it as an event. If an event spans multiple lines, combine the information.

        Each event MUST include:
        - artist: string (required, the main performer or group)
        - eventName: string (optional, the title of the event or show; do NOT repeat the artist name here)
        - artistId: string (optional)
        - startDate: string in ISO format (required)
        - endDate: string in ISO format (optional)
        - venueId: string (required)
        - unsure: boolean (optional)

        IMPORTANT:
        - If both an artist and a show/event title are present, set artist to the performer and eventName to the show title.
        - If only an artist is present, set eventName to null or omit it.
        - Do NOT conflate artist and eventName. For example:
          Example 1: <div>Artist: John Doe Quartet<br>Event: Jazz Night</div>
            → { "artist": "John Doe Quartet", "eventName": "Jazz Night", ... }
          Example 2: <div>Artist: Jane Smith</div>
            → { "artist": "Jane Smith", ... }

        Events already scraped: {events}
        {venueConfig}

        Remember to return ONLY a valid JSON array matching the schema. DO NOT wrap the response in markdown code blocks.
        Ensure all strings are properly escaped and the JSON is valid.`

      type ChainInput = {
        instructions: string
        context: DocumentInterface[]
        events: Event[]
        venueId: string
        venueConfig: string
      }

      this.ragChain = RunnableSequence.from([
        {
          instructions: (input: ChainInput) => input.instructions,
          context: (input: ChainInput) => input.context,
          events: (input: ChainInput) => JSON.stringify(input.events),
          venueId: (input: ChainInput) => input.venueId,
          venueConfig: (input: ChainInput) => input.venueConfig,
        },
        async (input) => {
          const messages = [
            { role: 'system', content: extract },
            {
              role: 'user',
              content: input.context
                .map((doc: DocumentInterface) => doc.pageContent)
                .join('\n'),
            },
          ]
          const response = await this.ai.invoke(messages)
          
          // Get the content using the proper AIMessage methods
          const content = response.text
          
          try {
            // Parse the cleaned content
            const parsed = cleanAndParseJson<ScrapedEvent[] | { events: ScrapedEvent[] }>(content)
            // Handle both array and object with events property
            return Array.isArray(parsed) ? parsed : parsed.events || []
          } catch (e) {
            logger.error('Failed to parse JSON response:', e)
            throw e
          }
        },
      ])
    }

    const maxRetries = 3
    let attempts = 0
    let lastError: unknown

    while (attempts < maxRetries) {
      try {
        let result = await this.ragChain.invoke({
          instructions: extract,
          context,
          events,
          venueId: this.venue.id,
          venueConfig: this.getVenueConfigContext(),
        })

        logger.debug(
          `RAG Chain result: ${util.inspect(result, { depth: null })}`
        )

        // Validate the result against the schema and deduplicate
        const validationResult = this.eventsSchema.safeParse(result)
        if (validationResult.success) {
          return validationResult.data
        } else {
          logger.warn(
            `Schema validation failed on attempt ${attempts + 1}:`,
            validationResult.error
          )
          throw new Error('Schema validation failed')
        }
      } catch (e: unknown) {
        lastError = e
        attempts++

        if (e instanceof SyntaxError) {
          logger.error(
            `JSON syntax error on attempt ${attempts}/${maxRetries}`,
            e
          )
        } else {
          logger.error(
            `Error processing events for ${this.venue.name} on attempt ${attempts}/${maxRetries}`,
            e
          )
        }

        if (attempts === maxRetries) {
          logger.error(
            `Failed to process events for ${this.venue.name} after ${maxRetries} attempts`,
            lastError
          )
          logger.debug('Context that caused the error:', context)
          return undefined
        }

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempts))
      }
    }

    return undefined
  }

  /**
   * Refine the extracted events by comparing them with the original HTML content.
   * @param {ScrapedEvent[]} events - The initially extracted events
   * @returns {Promise<ScrapedEvent[]>} - The refined events
   */
  private async refineEvents(events: ScrapedEvent[]): Promise<ScrapedEvent[]> {
    if (!this.originalHtml) {
      logger.warn('No original HTML content available for refinement')
      return events
    }

    const systemPrompt = `You are an expert in verifying and refining extracted event data from HTML content.
      Your task is to validate and refine the extracted events by comparing them with the original HTML content.
      You MUST follow these rules:
      1. Compare each extracted event with the original HTML content
      2. Verify the accuracy of artist names, event names, and dates
      3. Correct any obvious errors or inconsistencies
      4. Add any missing events that were not extracted in the first pass
      5. Remove any events that don't actually exist in the HTML
      6. All times MUST be interpreted as America/Toronto timezone
      7. Ensure all dates are in ISO format (YYYY-MM-DDTHH:mm:ss.sssZ)
      8. Each event MUST include a venueId field with the value: {venueId}
      9. Return ONLY a valid JSON array of events, not an object with an events property
      10. DO NOT modify the venueId field - keep it exactly as provided
      11. If no specific time is mentioned in the HTML, use the venue's typical show times: {venueConfig}`

    // Process events in smaller batches to avoid token limits
    const batchSize = 1 // Process one event at a time
    const refinedEvents: ScrapedEvent[] = []

    // Transform HTML once for all batches
    const transformedHtml = await this.transformHtmlToText([
      { pageContent: this.originalHtml, metadata: {} },
    ])

    // Take only the first document to reduce context size
    const limitedContext = transformedHtml[0]

    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize)
      
      const userPrompt = `HTML content: {context}

        Event to refine: {events}

        Venue ID: {venueId}

        Please refine and validate this event against the HTML content.
        Remember that all times should be interpreted as America/Toronto timezone.
        Return ONLY a valid JSON array matching the schema.
        IMPORTANT: Keep the venueId field exactly as provided in the input event.`

      const refinementChain = RunnableSequence.from([
        {
          context: (input: {
            events: ScrapedEvent[]
            venueId: string
            context: DocumentInterface
          }) => input.context,
          events: (input: {
            events: ScrapedEvent[]
            venueId: string
            context: DocumentInterface
          }) => JSON.stringify(input.events),
          venueId: (input: {
            events: ScrapedEvent[]
            venueId: string
            context: DocumentInterface
          }) => input.venueId,
        },
        async (input) => {
          const messages = [
            {
              role: 'system',
              content: systemPrompt
                .replace('{venueId}', input.venueId)
                .replace('{venueConfig}', this.getVenueConfigContext()),
            },
            {
              role: 'user',
              content: userPrompt
                .replace('{context}', input.context.pageContent)
                .replace('{events}', input.events)
                .replace('{venueId}', input.venueId),
            },
          ]
          const result = await this.ai.invoke(messages)
          const content =
            typeof result.content === 'string'
              ? result.content
              : JSON.stringify(result.content)
          
          try {
            // Parse the cleaned content
            const parsed = cleanAndParseJson<ScrapedEvent[] | { events: ScrapedEvent[] }>(content)
            // Handle both array and object with events property
            const events = Array.isArray(parsed) ? parsed : parsed.events || []
            // Ensure venueId is preserved
            return events.map((event: Partial<ScrapedEvent>) => ({
              ...event,
              venueId: this.venue.id,
            }))
          } catch (e) {
            logger.error('Failed to parse JSON response:', e)
            throw e
          }
        },
      ])

      try {
        const result = await refinementChain.invoke({
          events: batch,
          context: limitedContext,
          venueId: this.venue.id,
        })

        // Validate the result against the schema and deduplicate
        const validationResult = this.eventsSchema.safeParse(result)
        if (validationResult.success) {
          // Convert all dates to Toronto timezone
          const refinedBatch = validationResult.data.map((event) =>
            this.validateAndConvertDates(event)
          )
          refinedEvents.push(...refinedBatch)
        } else {
          logger.warn(
            'Schema validation failed during refinement:',
            validationResult.error
          )
          refinedEvents.push(...batch)
        }
      } catch (error) {
        logger.error('Error during event refinement:', error)
        refinedEvents.push(...batch)
      }
    }

    return refinedEvents
  }

  /**
   * Convert HTML content to plain text while preserving essential structure.
   */
  private async transformHtmlToText(docs: DocumentInterface[]) {
    const transformer = createHtmlToTextTransformer()

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1500,
      chunkOverlap: 400,
    })

    const sequence = transformer.pipe(splitter)
    const newDocuments = await sequence.invoke(docs)

    // Only remove empty lines and trim whitespace
    return newDocuments.map(doc => ({
      ...doc,
      pageContent: doc.pageContent
        .split('\n')
        .filter(line => line.trim().length > 0)
        .join('\n')
        .trim()
    }))
  }

  /**
   * Scrape the venue's events page and return structured data.
   * @returns {Promise<ScrapedEvent[]>} - The structured data of the venue's events.
   */

  /**
   * Validate and convert event dates to Toronto timezone
   * @param {ScrapedEvent} event - The event to validate
   * @returns {ScrapedEvent} - The event with converted dates
   */
  private validateAndConvertDates(event: ScrapedEvent): ScrapedEvent {
    try {
      const startDate = convertToTimeZone(event.startDate)
      const endDate = event.endDate
        ? convertToTimeZone(event.endDate)
        : undefined

      return {
        ...event,
        startDate,
        endDate,
      }
    } catch (error) {
      logger.error(`Error validating dates for event:`, error)
      throw error
    }
  }

  /**
   * Parse the HTML content of the venue's events page to extract structured data.
   */
  private async parse(docs: DocumentInterface[]): Promise<ScrapedEvent[]> {
    this.originalHtml = docs[0].pageContent
    const newDocuments = await executeWithRetry(
      () => this.transformHtmlToText(docs),
      'transform'
    )

    logger.debug(`Generated ${newDocuments.length} documents`)
    const vectorStore = await HNSWLib.fromDocuments(
      newDocuments,
      this.embeddings
    )

    // Use min(150, documentCount) to avoid requesting more documents than available
    const k = Math.min(150, newDocuments.length)
    const retriever = vectorStore.asRetriever(k)
    const retrievedDocs = await executeWithRetry(
      () => retriever.invoke(extract),
      'retrieve'
    )

    logger.debug(
      `Retrieved ${retrievedDocs.length} documents: ${util.inspect(retrievedDocs, { depth: null })}`
    )

    // Log each chunk's pageContent for debugging
    retrievedDocs.forEach((doc, idx) => {
      logger.debug(`Chunk ${idx + 1}:\n${doc.pageContent}`)
    })

    const response =
      (await executeWithRetry(
        () =>
          this.callRagChain(
            retrievedDocs as DocumentInterface<Record<string, any>>[]
          ),
        'rag'
      )) ?? []

    return response.map((r) => ({ ...r, venueId: this.venue.id }))
  }

  public async parseScrapedHTML(
    docs: DocumentInterface[]
  ): Promise<ScrapedEvent[]> {
    try {
      const initialEvents =
        (await executeWithRetry(() => this.parse(docs), 'parse')) ?? []

      if (initialEvents.length === 0) {
        return []
      }

      // Convert dates to Toronto timezone
      const eventsWithTorontoTime = initialEvents.map((event) =>
        this.validateAndConvertDates(event)
      )

      if (this.aiConfig.refineEvents) {
        logger.info(
          `Refining ${eventsWithTorontoTime.length} events for ${this.venue.name}`
        )
        const refinedEvents = await executeWithRetry(
          () => this.refineEvents(eventsWithTorontoTime),
          'refine'
        )
        // Deduplicate after refinement
        const dedupedRefinedEvents = this.eventsSchema.parse(refinedEvents)
        logger.info(
          `Refined ${dedupedRefinedEvents.length} events for ${this.venue.name}`
        )
        return dedupedRefinedEvents
      } else {
        const dedupedEvents = this.eventsSchema.parse(eventsWithTorontoTime)
        logger.info(
          `Final deduplicated events for ${this.venue.name}: ${dedupedEvents.length}`
        )
        return dedupedEvents
      }
    } catch (error) {
      logger.error(`Failed to scrape events for ${this.venue.name}:`, error)
      return []
    }
  }
}
