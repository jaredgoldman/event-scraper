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
import { cleanHtml } from "../../utils";
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
  private chunkSize = 4000;
  private ragChain: RunnableSequence;

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
      },
      gotoOptions: {
        waitUntil: "domcontentloaded",
      },
      async evaluate(page, browser) {
        await wait(1000);
        const result = await page.evaluate(() => document.body.innerHTML);
        await browser.close();
        return result;
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
  private async parse() {
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
    const response = await this.callRagChain(retrievedDocs);
    return response.map((r) => ({ ...r, venueId: this.venue.id }));
  }

  /**
   * Call the RagChain to extract structured data from the retrieved documents.
   * @param {DocumentInterface<Record<string, any>>[]} context - The context documents to provide to the RagChain.
   */
  async callRagChain(context: DocumentInterface<Record<string, any>>[]) {
    const events = this.eventsThisMonth.map((event) => ({
      ...event,
      venueName: this.venue.name,
    }));

    if (!this.ragChain) {
      const prompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          `You are a large language modal skilled at parsing cleaned html data
          with the aim of extracting structured data detailing live music events`,
        ],
        [
          "user",
          "Instructions: ${instructions} - Context: ${context} - Events already scraped: ${events}",
        ],
      ]);
      this.ragChain = await createStuffDocumentsChain<
        z.infer<typeof this.eventSchema>[]
      >({
        llm: this.ai,
        prompt,
        outputParser: new JsonOutputParser(),
      });
    }

    try {
      return await this.ragChain.invoke({
        instructions: extract,
        context,
        events,
      });
    } catch (e: unknown) {
      if (e instanceof SyntaxError) {
        logger.error("Syntax error in JSON response, attempting to recover");
        // Maybe we can ask the ai to continue here... but how do we connect the answers?
        try {
          return await this.ragChain.invoke({
            instructions: `Your last response gave me unparsable, can you try again?`,
            context,
            events,
          });
        } catch (e: unknown) {
          logger.error("Error recovering from JSON syntax error", e);
          logger.debug("Context", context);
        }
      } else {
        logger.error(`Error events for ${this.venue.name}: ${e}`);
      }
    }
  }

  /**
   * Use the HtmlToTextTransformer or custom util to convert HTML content to plain text.
   */
  private async transformHtmlToText(docs: DocumentInterface[]) {
    for (let doc of docs) {
      doc.pageContent = cleanHtml(doc.pageContent);
    }
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
