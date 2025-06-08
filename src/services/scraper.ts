import { PuppeteerWebBaseLoader } from '@langchain/community/document_loaders/web/puppeteer'
import { Venue } from '@prisma/client'
import { wait } from '../utils'
import { logger } from './logger'
import { Page, Browser } from 'puppeteer'

/**
 * A scraper that extracts structured data from a venue's events page.
 * @class
 */
export class ScraperService {
  private loader: PuppeteerWebBaseLoader

  /**
   * Constructor
   * @param {Venue} venue - The venue to scrape
   */
  constructor(venue: Venue) {
    const eventsUrl = new URL(
      venue.eventsPath ?? '',
      `https://${venue.website}`
    ).toString()

    logger.debug(`Scraping events from ${eventsUrl}`)

    this.loader = new PuppeteerWebBaseLoader(eventsUrl, {
      launchOptions: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disabled-setupid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
        executablePath: '/usr/bin/google-chrome-stable',
        timeout: 120000,
      },
      gotoOptions: {
        waitUntil: ['domcontentloaded'],
        timeout: 60000,
      },
      evaluate: this.evaluate.bind(this),
    })
  }

  /**
   * Evaluate the page content
   * @param {Page} page - The page to evaluate
   * @param {Browser} browser - The browser instance
   * @returns {Promise<string>} - The evaluated content
   */
  private async evaluate(page: Page, browser: Browser): Promise<string> {
    try {
      // Wait for initial page load with longer timeout
      await page
        .waitForNetworkIdle({
          idleTime: 5000,
          timeout: 30000,
        })
        .catch((e) => {
          logger.warn(
            `Initial network idle timeout, continuing anyway: ${e.message}`
          )
        })

      // Wait for any dynamic content to load
      await page
        .waitForFunction(
          () => {
            const observer = new MutationObserver(() => {})
            observer.observe(document.body, {
              childList: true,
              subtree: true,
            })
            return true
          },
          { timeout: 10000 }
        )
        .catch((e) => {
          logger.warn(
            `Dynamic content wait timeout, continuing anyway: ${e.message}`
          )
        })

      // Progressive scroll with checks for new content
      let previousHeight = 0
      let currentHeight = await page.evaluate(() => document.body.scrollHeight)
      let scrollAttempts = 0
      const maxScrollAttempts = 5

      while (
        scrollAttempts < maxScrollAttempts &&
        currentHeight > previousHeight
      ) {
        previousHeight = currentHeight

        await page
          .evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight)
          })
          .catch((e) => {
            logger.warn(`Scroll failed, continuing anyway: ${e.message}`)
          })

        await wait(2000)

        // Wait for any new content to load after scroll
        await page
          .waitForNetworkIdle({
            idleTime: 3000,
            timeout: 10000,
          })
          .catch((e) => {
            logger.warn(
              `Scroll network idle timeout, continuing anyway: ${e.message}`
            )
          })

        currentHeight = await page.evaluate(() => document.body.scrollHeight)
        scrollAttempts++
      }

      // Final wait for any remaining dynamic content
      await page
        .waitForNetworkIdle({
          idleTime: 5000,
          timeout: 20000,
        })
        .catch((e) => {
          logger.warn(
            `Final network idle timeout, continuing anyway: ${e.message}`
          )
        })

      const result = await page.evaluate(() => document.body.innerHTML)
      await browser.close()
      return result
    } catch (error: unknown) {
      logger.error(
        `Error during page evaluation: ${error instanceof Error ? error.message : String(error)}`
      )
      await browser.close()
      throw error
    }
  }

  /**
   * Scrape the venue's events page and return html
   */
  async scrapePage() {
    return await this.loader.load()
  }
}
