import { PuppeteerWebBaseLoader } from "@langchain/community/document_loaders/web/puppeteer";
import { HtmlToTextTransformer } from "@langchain/community/document_transformers/html_to_text";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Event, Venue } from "@prisma/client";
import extract from "./messages/extract";
import {
  wait,
  scrapedEventSchema,
  ScrapedEvent,
  getAiStuff,
  Ai,
  Embeddings,
} from "../../utils";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { logger } from "../logger";
import { z } from "zod";
import { RunnableSequence } from "@langchain/core/runnables";
import util from "util";
import { DocumentInterface } from "@langchain/core/documents";
import { DateTime } from "luxon";
import env from "../../config/env";

/**
 * A scraper that extracts structured data from a venue's events page.
 * @class
 */
export default class Scraper {
  private venue: Venue;
  private eventsThisMonth: Event[];
  private loader: PuppeteerWebBaseLoader;
  private eventSchema = scrapedEventSchema;
  private embeddings: Embeddings;
  private ai: Ai;
  private chunkSize = 2000;
  private ragChain: RunnableSequence | null = null;
  private originalHtml: string | null = null;
  private readonly timezone = env.TIMEZONE
  private readonly maxFutureDays = 90;
  private readonly minPastDays = 7;
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000;
  private readonly circuitBreakerThreshold = 5;
  private readonly circuitBreakerTimeout = 60000;
  private failureCount = 0;
  private lastFailureTime = 0;
  private circuitOpen = false;

  constructor(venue: Venue, eventsThisMonth: Event[]) {
    const { ai, embeddings, chunkSize } = getAiStuff();
    this.venue = venue;
    this.eventsThisMonth = eventsThisMonth;
    this.embeddings = embeddings;
    this.ai = ai;
    this.chunkSize = chunkSize;
    const eventsUrl = new URL(
      venue.eventsPath ?? "",
      `https://${venue.website}`,
    ).toString();

    logger.debug(`Scraping events from ${eventsUrl}`);

    this.loader = new PuppeteerWebBaseLoader(eventsUrl, {
      launchOptions: {
        headless: true,
        args: [
          "--no-sandbox",
          "--disabled-setupid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-web-security",
          "--disable-features=IsolateOrigins,site-per-process",
        ],
        executablePath: "/usr/bin/google-chrome-stable",
        timeout: 120000,
      },
      gotoOptions: {
        waitUntil: ["domcontentloaded"],
        timeout: 60000,
      },
      async evaluate(page, browser) {
        try {
          // Wait for initial page load with longer timeout
          await page
            .waitForNetworkIdle({
              idleTime: 5000,
              timeout: 30000,
            })
            .catch((e) => {
              logger.warn(
                `Initial network idle timeout, continuing anyway: ${e.message}`,
              );
            });

          // Wait for any dynamic content to load
          await page
            .waitForFunction(
              () => {
                const observer = new MutationObserver(() => {});
                observer.observe(document.body, {
                  childList: true,
                  subtree: true,
                });
                return true;
              },
              { timeout: 10000 }
            )
            .catch((e) => {
              logger.warn(
                `Dynamic content wait timeout, continuing anyway: ${e.message}`,
              );
            });

          // Progressive scroll with checks for new content
          let previousHeight = 0;
          let currentHeight = await page.evaluate(() => document.body.scrollHeight);
          let scrollAttempts = 0;
          const maxScrollAttempts = 5;

          while (scrollAttempts < maxScrollAttempts && currentHeight > previousHeight) {
            previousHeight = currentHeight;
            
            await page
              .evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
              })
              .catch((e) => {
                logger.warn(`Scroll failed, continuing anyway: ${e.message}`);
              });

            await wait(2000);

            // Wait for any new content to load after scroll
            await page
              .waitForNetworkIdle({
                idleTime: 3000,
                timeout: 10000,
              })
              .catch((e) => {
                logger.warn(
                  `Scroll network idle timeout, continuing anyway: ${e.message}`,
                );
              });

            currentHeight = await page.evaluate(() => document.body.scrollHeight);
            scrollAttempts++;
          }

          // Final wait for any remaining dynamic content
          await page
            .waitForNetworkIdle({
              idleTime: 5000,
              timeout: 20000,
            })
            .catch((e) => {
              logger.warn(
                `Final network idle timeout, continuing anyway: ${e.message}`,
              );
            });

          const result = await page.evaluate(() => document.body.innerHTML);
          await browser.close();
          return result;
        } catch (error: unknown) {
          logger.error(
            `Error during page evaluation: ${error instanceof Error ? error.message : String(error)}`,
          );
          await browser.close();
          throw error;
        }
      },
    });
  }

  /**
   * Execute a function with retry logic and circuit breaker
   * @param {Function} fn - The function to execute
   * @param {string} operation - The name of the operation for logging
   * @returns {Promise<T>} - The result of the function
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    operation: string,
  ): Promise<T> {
    if (this.circuitOpen) {
      const now = Date.now();
      if (now - this.lastFailureTime < this.circuitBreakerTimeout) {
        throw new Error(`Circuit breaker is open for ${operation}`);
      }
      this.circuitOpen = false;
      this.failureCount = 0;
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await fn();
        this.failureCount = 0;
        return result;
      } catch (error) {
        lastError = error;
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.failureCount >= this.circuitBreakerThreshold) {
          this.circuitOpen = true;
          logger.error(
            `Circuit breaker opened for ${operation} after ${this.failureCount} failures`,
          );
          throw new Error(`Circuit breaker opened for ${operation}`);
        }

        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        logger.warn(
          `Attempt ${attempt}/${this.maxRetries} failed for ${operation}, retrying in ${delay}ms`,
          error,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Convert a date string to ISO format in Toronto timezone
   * @param {string} dateStr - The date string to convert
   * @returns {string} - The date in ISO format
   */
  private convertToTimeZone(dateStr: string): string {
    try {
      // First try to parse as ISO
      let dt = DateTime.fromISO(dateStr, { zone: this.timezone });

      // If that fails, try common time formats in Toronto timezone
      if (!dt.isValid) {
        const formats = [
          "yyyy-MM-dd HH:mm",
          "yyyy-MM-dd h:mm a",
          "yyyy-MM-dd h:mma",
          "yyyy-MM-dd hh:mm a",
          "yyyy-MM-dd hh:mma",
          "MM/dd/yyyy HH:mm",
          "MM/dd/yyyy h:mm a",
          "MM/dd/yyyy h:mma",
          "MM/dd/yyyy hh:mm a",
          "MM/dd/yyyy hh:mma",
          "MMMM d, yyyy HH:mm",
          "MMMM d, yyyy h:mm a",
          "MMMM d, yyyy h:mma",
          "MMMM d, yyyy hh:mm a",
          "MMMM d, yyyy hh:mma",
          "d MMMM yyyy HH:mm",
          "d MMMM yyyy h:mm a",
          "d MMMM yyyy h:mma",
          "d MMMM yyyy hh:mm a",
          "d MMMM yyyy hh:mma",
          "MMM d, yyyy HH:mm",
          "MMM d, yyyy h:mm a",
          "MMM d, yyyy h:mma",
          "MMM d, yyyy hh:mm a",
          "MMM d, yyyy hh:mma",
          "d MMM yyyy HH:mm",
          "d MMM yyyy h:mm a",
          "d MMM yyyy h:mma",
          "d MMM yyyy hh:mm a",
          "d MMM yyyy hh:mma",
        ];

        for (const format of formats) {
          dt = DateTime.fromFormat(dateStr, format, { zone: this.timezone });
          if (dt.isValid) break;
        }
      }

      // If still invalid, try to parse as just date and assume evening time (7 PM)
      if (!dt.isValid) {
        dt = DateTime.fromFormat(dateStr, "yyyy-MM-dd", {
          zone: this.timezone,
        }).set({ hour: 19, minute: 0, second: 0, millisecond: 0 });
      }

      // If we have a valid date, ensure it's in Toronto timezone
      if (dt.isValid) {
        // Force conversion to Toronto timezone and ensure UTC offset is correct
        dt = dt.setZone(this.timezone, { keepLocalTime: false });

        // Validate date is within acceptable range
        // const now = DateTime.now().setZone(this.timezone);
        // const minDate = now.minus({ days: this.minPastDays });
        // const maxDate = now.plus({ days: this.maxFutureDays });

        // if (dt < minDate) {
        //   logger.warn(`Date ${dt.toISO()} is too far in the past`);
        //   throw new Error(`Date ${dt.toISO()} is too far in the past`);
        // }

        // if (dt > maxDate) {
        //   logger.warn(`Date ${dt.toISO()} is too far in the future`);
        //   throw new Error(`Date ${dt.toISO()} is too far in the future`);
        // }

        return dt.toISO() as string;
      }

      throw new Error(`Invalid date format: ${dateStr}`);
    } catch (error) {
      logger.error(`Error converting date ${dateStr} to Toronto time:`, error);
      throw error;
    }
  }

  /**
   * Validate and convert event dates to Toronto timezone
   * @param {ScrapedEvent} event - The event to validate
   * @returns {ScrapedEvent} - The event with converted dates
   */
  private validateAndConvertDates(event: ScrapedEvent): ScrapedEvent {
    try {
      const startDate = this.convertToTimeZone(event.startDate);
      const endDate = event.endDate
        ? this.convertToTimeZone(event.endDate)
        : undefined;

      return {
        ...event,
        startDate,
        endDate,
      };
    } catch (error) {
      logger.error(`Error validating dates for event:`, error);
      throw error;
    }
  }

  /**
   * Scrape the venue's events page and return structured data.
   * @returns {Promise<ScrapedEvent[]>} - The structured data of the venue's events.
   */
  public async getEvents(): Promise<ScrapedEvent[]> {
    try {
      const initialEvents = await this.executeWithRetry(
        () => this.parse(),
        "parse",
      ) ?? [];

      if (initialEvents.length === 0) {
        return [];
      }

      // Convert dates to Toronto timezone
      const eventsWithTorontoTime = initialEvents.map((event) =>
        this.validateAndConvertDates(event),
      );

      logger.info(
        `Refining ${eventsWithTorontoTime.length} events for ${this.venue.name}`,
      );

      const refinedEvents = await this.executeWithRetry(
        () => this.refineEvents(eventsWithTorontoTime),
        "refine",
      );

      logger.info(
        `Refined ${refinedEvents.length} events for ${this.venue.name}`,
      );

      return refinedEvents;
    } catch (error) {
      logger.error(
        `Failed to scrape events for ${this.venue.name}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Parse the HTML content of the venue's events page to extract structured data.
   */
  private async parse(): Promise<ScrapedEvent[]> {
    const docs = await this.executeWithRetry(
      () => this.loader.load(),
      "load",
    );

    this.originalHtml = docs[0].pageContent;
    const newDocuments = await this.executeWithRetry(
      () => this.transformHtmlToText(docs),
      "transform",
    );

    logger.debug(`Generated ${newDocuments.length} documents`);
    const vectorStore = await MemoryVectorStore.fromDocuments(
      newDocuments,
      this.embeddings,
    );

    const retriever = vectorStore.asRetriever(150);
    const retrievedDocs = await this.executeWithRetry(
      () => retriever.invoke(extract),
      "retrieve",
    );

    logger.debug(
      `Retrieved ${retrievedDocs.length} documents: ${util.inspect(retrievedDocs, { depth: null })}`,
    );

    const response = await this.executeWithRetry(
      () => this.callRagChain(retrievedDocs),
      "rag",
    ) ?? [];

    return response.map((r) => ({ ...r, venueId: this.venue.id }));
  }

  /**
   * Call the RagChain to extract structured data from the retrieved documents.
   * @param {DocumentInterface<Record<string, any>>[]} context - The context documents to provide to the RagChain.
   */
  async callRagChain(
    context: DocumentInterface<Record<string, any>>[],
  ): Promise<ScrapedEvent[] | undefined> {
    const events = this.eventsThisMonth.map((event) => ({
      ...event,
      venueName: this.venue.name,
    }));

    if (!this.ragChain) {
      const prompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          `You are a large language model skilled at parsing cleaned html data and extracting structured data about live music events.
          You MUST follow these rules:
          1. Always return a valid JSON array of events
          2. Each event MUST match the schema exactly
          3. If you're unsure about a field, omit it rather than guessing
          4. If no valid events are found, return an empty array []
          5. Never include any explanatory text outside the JSON
          6. Ensure all dates are in ISO format (YYYY-MM-DD)
          7. Ensure all prices are numbers or null
          8. Ensure all URLs are valid URLs or null
          9. Each event MUST include a venueId field with the value: {venueId}`,
        ],
        [
          "user",
          `Instructions: {instructions}

          {context}

          Events already scraped: {events}

          Remember to return ONLY a valid JSON array matching the schema.`,
        ],
      ]);

      const chain = await createStuffDocumentsChain({
        llm: this.ai,
        prompt,
        outputParser: new JsonOutputParser(),
      });

      type ChainInput = {
        instructions: string;
        context: DocumentInterface[];
        events: Event[];
        venueId: string;
      };

      this.ragChain = RunnableSequence.from([
        {
          instructions: (input: ChainInput) => input.instructions,
          context: (input: ChainInput) => input.context,
          events: (input: ChainInput) => JSON.stringify(input.events),
          venueId: (input: ChainInput) => input.venueId,
        },
        chain,
      ]);
    }

    const maxRetries = 3;
    let attempts = 0;
    let lastError: unknown;

    while (attempts < maxRetries) {
      try {
        const result = await this.ragChain.invoke({
          instructions: extract,
          context,
          events,
          venueId: this.venue.id,
        });

        // Validate the result against the schema
        const validationResult = z.array(this.eventSchema).safeParse(result);
        if (validationResult.success) {
          return validationResult.data;
        } else {
          logger.warn(
            `Schema validation failed on attempt ${attempts + 1}:`,
            validationResult.error,
          );
          throw new Error("Schema validation failed");
        }
      } catch (e: unknown) {
        lastError = e;
        attempts++;

        if (e instanceof SyntaxError) {
          logger.error(
            `JSON syntax error on attempt ${attempts}/${maxRetries}`,
            e,
          );
        } else {
          logger.error(
            `Error processing events for ${this.venue.name} on attempt ${attempts}/${maxRetries}`,
            e,
          );
        }

        if (attempts === maxRetries) {
          logger.error(
            `Failed to process events for ${this.venue.name} after ${maxRetries} attempts`,
            lastError,
          );
          logger.debug("Context that caused the error:", context);
          return undefined;
        }

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
      }
    }

    return undefined;
  }

  /**
   * Use the HtmlToTextTransformer or custom util to convert HTML content to plain text.
   */
  private async transformHtmlToText(docs: DocumentInterface[]) {
    const transformer = new HtmlToTextTransformer();
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.chunkSize,
      chunkOverlap: 100,
    });

    const sequence = transformer.pipe(splitter);
    const newDocuments = await sequence.invoke(docs);
    return newDocuments;
  }

  /**
   * Refine the extracted events by comparing them with the original HTML content.
   * @param {ScrapedEvent[]} events - The initially extracted events
   * @returns {Promise<ScrapedEvent[]>} - The refined events
   */
  private async refineEvents(events: ScrapedEvent[]): Promise<ScrapedEvent[]> {
    if (!this.originalHtml) {
      logger.warn("No original HTML content available for refinement");
      return events;
    }

    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        `You are an expert in verifying and refining extracted event data from HTML content.
        Your task is to validate and refine the extracted events by comparing them with the original HTML content.
        You MUST follow these rules:
        1. Compare each extracted event with the original HTML content
        2. Verify the accuracy of artist names, event names, and dates
        3. Correct any obvious errors or inconsistencies
        4. Add any missing events that were not extracted in the first pass
        5. Remove any events that don't actually exist in the HTML
        6. All times MUST be interpreted as America/Toronto timezone
        7. Ensure all dates are in ISO format (YYYY-MM-DDTHH:mm:ss.sssZ)
        8. Each event MUST include a venueId field with the value: {venueId}`,
      ],
      [
        "user",
        `Original HTML content: {html}

        Extracted events: {events}

        Context: {context}

        Venue ID: {venueId}

        Please refine and validate these events against the original HTML content.
        Remember that all times should be interpreted as America/Toronto timezone.
        Return ONLY a valid JSON array matching the schema.`,
      ],
    ]);

    const chain = await createStuffDocumentsChain({
      llm: this.ai,
      prompt,
      outputParser: new JsonOutputParser(),
    });

    const refinementChain = RunnableSequence.from([
      {
        html: (input: {
          html: string;
          events: ScrapedEvent[];
          venueId: string;
          context: DocumentInterface[];
        }) => input.html,
        events: (input: {
          html: string;
          events: ScrapedEvent[];
          venueId: string;
          context: DocumentInterface[];
        }) => JSON.stringify(input.events),
        context: (input: {
          html: string;
          events: ScrapedEvent[];
          venueId: string;
          context: DocumentInterface[];
        }) => input.context,
        venueId: (input: {
          html: string;
          events: ScrapedEvent[];
          venueId: string;
          context: DocumentInterface[];
        }) => input.venueId,
      },
      chain,
    ]);

    try {
      const result = await refinementChain.invoke({
        html: this.originalHtml,
        events,
        context: await this.transformHtmlToText([
          { pageContent: this.originalHtml, metadata: {} },
        ]),
        venueId: this.venue.id,
      });

      // Validate the result against the schema and convert dates
      const validationResult = z.array(this.eventSchema).safeParse(result);
      if (validationResult.success) {
        // Convert all dates to Toronto timezone
        return validationResult.data.map((event) =>
          this.validateAndConvertDates(event),
        );
      } else {
        logger.warn(
          "Schema validation failed during refinement:",
          validationResult.error,
        );
        return events;
      }
    } catch (error) {
      logger.error("Error during event refinement:", error);
      return events;
    }
  }
}
