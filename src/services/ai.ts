import { Ai, Embeddings } from '../utils'
import { Venue, Event } from '@prisma/client'
import { extract } from '../prompts'
import {
  scrapedEventSchema,
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

export class AiService {
  private ai: Ai
  private embeddings: Embeddings
  private chunkSize = 2000
  private originalHtml: string | null = null
  private eventSchema = scrapedEventSchema
  private venue: Venue
  private ragChain: RunnableSequence | null = null
  private eventsThisMonth: Event[]

  constructor(
    ai: Ai,
    embeddings: Embeddings,
    venue: Venue,
    eventsThisMonth: Event[]
  ) {
    this.ai = ai
    this.embeddings = embeddings
    this.venue = venue
    this.eventsThisMonth = eventsThisMonth
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
        Each event MUST include:
        - artist: string (required)
        - artistId: string (optional)
        - eventName: string (optional)
        - startDate: string in ISO format (required)
        - endDate: string in ISO format (optional)
        - venueId: string (required)
        - unsure: boolean (optional)

        Events already scraped: {events}

        Remember to return ONLY a valid JSON array matching the schema.`

      type ChainInput = {
        instructions: string
        context: DocumentInterface[]
        events: Event[]
        venueId: string
      }

      this.ragChain = RunnableSequence.from([
        {
          instructions: (input: ChainInput) => input.instructions,
          context: (input: ChainInput) => input.context,
          events: (input: ChainInput) => JSON.stringify(input.events),
          venueId: (input: ChainInput) => input.venueId,
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
          const result = await this.ai.invoke(messages)
          const content =
            typeof result.content === 'string'
              ? result.content
              : JSON.stringify(result.content)
          return JSON.parse(content)
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
        })

        logger.debug(
          `RAG Chain result: ${util.inspect(result, { depth: null })}`
        )

        // HACK: if result is an object with an events key in it, grab contents
        if (result && typeof result === 'object' && 'events' in result) {
          result = result.events
        }
        // Validate the result against the schema
        const validationResult = z.array(this.eventSchema).safeParse(result)
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
      8. Each event MUST include a venueId field with the value: {venueId}`

    const userPrompt = `Original HTML content: {html}

      Extracted events: {events}

      Context: {context}

      Venue ID: {venueId}

      Please refine and validate these events against the original HTML content.
      Remember that all times should be interpreted as America/Toronto timezone.
      Return ONLY a valid JSON array matching the schema.`

    const refinementChain = RunnableSequence.from([
      {
        html: (input: {
          html: string
          events: ScrapedEvent[]
          venueId: string
          context: DocumentInterface[]
        }) => input.html,
        events: (input: {
          html: string
          events: ScrapedEvent[]
          venueId: string
          context: DocumentInterface[]
        }) => JSON.stringify(input.events),
        context: (input: {
          html: string
          events: ScrapedEvent[]
          venueId: string
          context: DocumentInterface[]
        }) => input.context,
        venueId: (input: {
          html: string
          events: ScrapedEvent[]
          venueId: string
          context: DocumentInterface[]
        }) => input.venueId,
      },
      async (input) => {
        const messages = [
          {
            role: 'system',
            content: systemPrompt.replace('{venueId}', input.venueId),
          },
          {
            role: 'user',
            content: userPrompt
              .replace('{html}', input.html)
              .replace('{events}', input.events)
              .replace(
                '{context}',
                input.context
                  .map((doc: DocumentInterface) => doc.pageContent)
                  .join('\n')
              )
              .replace('{venueId}', input.venueId),
          },
        ]
        const result = await this.ai.invoke(messages)
        const content =
          typeof result.content === 'string'
            ? result.content
            : JSON.stringify(result.content)
        return JSON.parse(content)
      },
    ])

    try {
      const result = await refinementChain.invoke({
        html: this.originalHtml,
        events,
        context: await this.transformHtmlToText([
          { pageContent: this.originalHtml, metadata: {} },
        ]),
        venueId: this.venue.id,
      })

      // Validate the result against the schema and convert dates
      const validationResult = z.array(this.eventSchema).safeParse(result)
      if (validationResult.success) {
        // Convert all dates to Toronto timezone
        return validationResult.data.map((event) =>
          this.validateAndConvertDates(event)
        )
      } else {
        logger.warn(
          'Schema validation failed during refinement:',
          validationResult.error
        )
        return events
      }
    } catch (error) {
      logger.error('Error during event refinement:', error)
      return events
    }
  }

  /**
   * Use the HtmlToTextTransformer or custom util to convert HTML content to plain text.
   */
  private async transformHtmlToText(docs: DocumentInterface[]) {
    const transformer = new HtmlToTextTransformer()
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.chunkSize,
      chunkOverlap: 100,
    })

    const sequence = transformer.pipe(splitter)
    const newDocuments = await sequence.invoke(docs)
    return newDocuments
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

    const retriever = vectorStore.asRetriever(150)
    const retrievedDocs = await executeWithRetry(
      () => retriever.invoke(extract),
      'retrieve'
    )

    logger.debug(
      `Retrieved ${retrievedDocs.length} documents: ${util.inspect(retrievedDocs, { depth: null })}`
    )

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

      logger.info(
        `Refining ${eventsWithTorontoTime.length} events for ${this.venue.name}`
      )

      const refinedEvents = await executeWithRetry(
        () => this.refineEvents(eventsWithTorontoTime),
        'refine'
      )

      logger.info(
        `Refined ${refinedEvents.length} events for ${this.venue.name}`
      )

      return refinedEvents
    } catch (error) {
      logger.error(`Failed to scrape events for ${this.venue.name}:`, error)
      return []
    }
  }
}
