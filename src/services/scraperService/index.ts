import * as cheerio from "cheerio";
import puppeteer from "puppeteer-core";
import { wait } from "../../utils";
import OpenAI from "openai";
import { Venue } from "@prisma/client";
import env from "../../config/env";
import { ScrapedEvent } from "./types";
import { cleanHtml } from "./utils";

export default class ScraperService {
  private venue: Venue;
  private ai: OpenAI;

  constructor(venue: Venue) {
    this.venue = venue;
    this.ai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });
  }

  // TODO: parse into smaller functions for use with limited lambda times
  public async getEvents(venue: Venue): Promise<ScrapedEvent[]> {
    try {
      if (!venue.website || !venue.eventsPath) {
        throw new Error("No website or events path provided");
      }

      this.venue = venue;
      const url = `https://${this.venue.website}${
        this.venue?.eventsPath || ""
      }`;
      const page = await this.loadPage(url);
      const content = await page.content();
      const parsed = cheerio.load(content);
      const body = parsed("body").html()?.trim();
      if (!body) throw new Error("Error parsing body");
      const cleaned = cleanHtml(body);
      const events = await this.sendMessagesToAI([
        { role: "system", content: prompt, name: "system" },
        { role: "user", content: cleaned, name: "user" },
      ]);
      if (!events) throw new Error("Error getting events");
      return JSON.parse(events);
    } catch (e) {
      throw new Error(`Error getting events: ${e}`);
    }
  }

  private async loadPage(url: string) {
    try {
      const browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--single-process"],
      });

      const page = await browser.newPage();
      await page.goto(url, {
        waitUntil: "networkidle2",
      });
      // wait for extra js to load
      await wait(1000);
      return page;
    } catch (e) {
      throw new Error("Error loading page to scrape");
    }
  }

  private async sendMessagesToAI(
    // messages: { role: string; content: string; name: string }[]
    messages: any[],
  ) {
    try {
      const res = await this.ai.chat.completions.create({
        model: "gpt-4-0125-preview",
        messages,
        tools: [
          {
            type: "function",
            function: {
              name: "parse_data",
              description:
                "Parse raw HTML data and find events. Add the artist name as well as the start and end time of the event in ISO format",
              parameters: {
                type: "object",
                properties: {
                  data: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        artist: { type: "string" },
                        band: { type: "string" },
                        startTime: { type: "string" },
                        endTime: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
        tool_choice: {
          type: "function",
          function: { name: "parse_data" },
        },
      });

      if (!res.choices || !res?.choices[0]?.message) {
        throw new Error("Error parsing HTML");
      }
      if (res.choices[0].message.tool_calls) {
        return res?.choices[0]?.message?.tool_calls[0]?.function.arguments;
      }
    } catch (e: unknown) {
      throw new Error(`AI service error: ${e}`);
    }
  }
}
