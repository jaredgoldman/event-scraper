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

  /**
   * @param {Venue} venue - The venue to scrape.
   * @param {Event[]} eventsThisMonth - The events that have already been scraped for this month.
   * @param {Ai} ai - The AI to use for processing the scraped data.
   * @param {Embeddings} embeddings - The embeddings to use for processing the scraped data.
   * @param {number} chunkSize - The size of the chunks to split the text into.
   * @param {RunnableSequence} ragChain - The RagChain to use for processing the scraped data.
   */
  constructor(venue: Venue, eventsThisMonth: Event[]) {
    const { ai, embeddings, chunkSize } = getAiStuff();
    this.venue = venue;
    this.eventsThisMonth = eventsThisMonth;
    this.embeddings = embeddings;
    this.ai = ai;
    this.chunkSize = chunkSize;
    const eventsUrl = `https://${venue.website}/${venue.eventsPath}`;

    this.loader = new PuppeteerWebBaseLoader(eventsUrl, {
      launchOptions: {
        headless: true,
        args: ["--no-sandbox", "--disabled-setupid-sandbox"],
        executablePath: "/usr/bin/google-chrome-stable",
        timeout: 60000,
      },
      gotoOptions: {
        waitUntil: ["networkidle0", "domcontentloaded"],
        timeout: 60000,
      },
      async evaluate(page, browser) {
        try {
          await page.waitForNetworkIdle({ 
            idleTime: 1000, 
            timeout: 30000
          }).catch(e => {
            logger.warn(`Network idle timeout, continuing anyway: ${e.message}`);
          });
          
          await wait(5000);
          
          await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
          }).catch(e => {
            logger.warn(`Scroll failed, continuing anyway: ${e.message}`);
          });
          
          await wait(2000);
          
          const result = await page.evaluate(() => document.body.innerHTML);
          await browser.close();
          return result;
        } catch (error: unknown) {
          logger.error(`Error during page evaluation: ${error instanceof Error ? error.message : String(error)}`);
          await browser.close();
          throw error;
        }
      },
    });
  }

  /**
   * Scrape the venue's events page and return structured data.
   * @returns {Promise<ScrapedEvent[]>} - The structured data of the venue's events.
   */
  public async getEvents(): Promise<ScrapedEvent[]> {
    return (await this.parse()) ?? [];
  }

  /**
   * Parse the HTML content of the venue's events page to extract structured data.
   */
  private async parse(): Promise<ScrapedEvent[]> {
    const docs = await this.loader.load();
    const newDocuments = await this.transformHtmlToText(docs);
    logger.debug(`Generated ${newDocuments.length} documents`);
    const vectorStore = await MemoryVectorStore.fromDocuments(
      newDocuments,
      this.embeddings,
    );

    const retriever = vectorStore.asRetriever(150);
    const retrievedDocs = await retriever.invoke(extract);
    logger.debug(
      `Retrieved ${retrievedDocs.length} documents: ${util.inspect(retrievedDocs, { depth: null })}`,
    );
    const response = (await this.callRagChain(retrievedDocs)) ?? [];
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
            validationResult.error
          );
          throw new Error("Schema validation failed");
        }
      } catch (e: unknown) {
        lastError = e;
        attempts++;
        
        if (e instanceof SyntaxError) {
          logger.error(
            `JSON syntax error on attempt ${attempts}/${maxRetries}`,
            e
          );
        } else {
          logger.error(
            `Error processing events for ${this.venue.name} on attempt ${attempts}/${maxRetries}`,
            e
          );
        }

        if (attempts === maxRetries) {
          logger.error(
            `Failed to process events for ${this.venue.name} after ${maxRetries} attempts`,
            lastError
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
}
