import { PuppeteerWebBaseLoader } from "@langchain/community/document_loaders/web/puppeteer";
import { HtmlToTextTransformer } from "@langchain/community/document_transformers/html_to_text";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Venue } from "@prisma/client";
import { wait, scrapedEventSchema, ScrapedEvent } from "../../utils";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { pull } from "langchain/hub";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import extract from "./messages/extract";
import { Logger } from "../logger";
import { z } from "zod";
import { Ai, getAi, getEmbeddings, Embeddings } from "../../utils/ai";

export default class Scraper {
  private venue: Venue;
  private loader: PuppeteerWebBaseLoader;
  private eventSchema = scrapedEventSchema;
  private embeddings: Embeddings;
  private ai: Ai;

  constructor(venue: Venue) {
    this.venue = venue;
    this.ai = getAi();
    this.embeddings = getEmbeddings();

    const eventsUrl = `https://${venue.website}/${venue.eventsPath}`;

    this.loader = new PuppeteerWebBaseLoader(eventsUrl, {
      launchOptions: {
        headless: true,
      },
      gotoOptions: {
        waitUntil: "domcontentloaded",
      },
      // XXX: We could implement custom navigation logic here
      // it could rely on the llm locating the button press
      async evaluate(page, browser) {
        // Wait for js to load
        await wait(1000);
        const result = await page.evaluate(() => document.body.innerHTML);
        await browser.close();
        return result;
      },
    });
  }

  public async getEvents(): Promise<ScrapedEvent[]> {
    Logger.info(`Conducting initial scraping ${this.venue.name}`);
    return await this.parse();
    // Logger.info(`Conducting refinement for ${this.venue.name}`);
    // return await this.refine(initial);
  }

  async parse() {
    const transformer = new HtmlToTextTransformer({
      removeNewlines: true,
      removeExtraWhitespace: true,
      removeHtmlTags: true,
      removeHtmlComments: true,
      uppercaseHeadings: false,
    });

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 900,
      chunkOverlap: 100,
      // We could get creative with the splitter here in terms of filtering data
    });
    const docs = await this.loader.load();
    const sequence = transformer.pipe(splitter);
    const newDocuments = await sequence.invoke(docs);
    const vectorStore = await MemoryVectorStore.fromDocuments(
      newDocuments,
      this.embeddings,
    );
    const retriever = vectorStore.asRetriever();
    const prompt = await pull<ChatPromptTemplate>("rlm/rag-prompt");

    const ragChain = await createStuffDocumentsChain<
      z.infer<typeof this.eventSchema>[]
    >({
      llm: this.ai,
      prompt,
      outputParser: new JsonOutputParser(),
    });

    const retrievedDocs = await retriever.invoke(extract);

    const response = await ragChain.invoke({
      question: extract,
      context: retrievedDocs,
    });

    return response.map((r) => ({ ...r, venueId: this.venue.id }));
  }
}
