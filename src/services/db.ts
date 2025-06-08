import { Event, PrismaClient, Venue } from '@prisma/client'
import { ScrapedEvent } from '../utils/validation'
import { EventWithArtistVenue } from '../types'
import { logger } from './logger'
import { scrapedEventSchema } from '../utils/validation'
import assert from 'node:assert'
import { DateTime } from 'luxon'
import { env } from '../config'
import {
  PrismaClientKnownRequestError,
  PrismaClientValidationError,
} from '@prisma/client/runtime/library'

/**
 * Class responsible for db interactions
 * TODO: create event cache to reduce db fetches
 */
export class DbService {
  private prisma: PrismaClient
  private readonly TIMEZONE = 'America/Toronto'

  /**
   * @param {PrismaClient} prisma
   */
  constructor(prisma: PrismaClient) {
    this.prisma = prisma
  }

  /**
   * Helper method to ensure consistent timezone handling
   * @param {string} isoDate - ISO date string
   * @returns {DateTime} - DateTime object in Toronto timezone
   */
  private toTorontoTime(isoDate: string): DateTime {
    return DateTime.fromISO(isoDate, { zone: this.TIMEZONE }).setZone(
      this.TIMEZONE,
      { keepLocalTime: false }
    )
  }

  /**
   * Fetch venues that are crawlable
   */
  async getVenues() {
    return await this.prisma.venue.findMany({
      where: {
        crawlable: true,
      },
    })
  }

  /**
   * Get events for the current month
   */
  async getEventsThisMonthByVenue(venue: Venue) {
    const now = DateTime.now().setZone(this.TIMEZONE)
    return await this.prisma.event.findMany({
      where: {
        startDate: {
          gte: now.startOf('month').toJSDate(),
          lte: now.endOf('month').toJSDate(),
        },
        venueId: venue.id,
      },
    })
  }
  /**
   * Process array of normalized events and save to db
   */
  async processAndCreateEvents(scrapedEvents: ScrapedEvent[]) {
    const transactionData: (ScrapedEvent & { conflict: boolean })[] = []
    const variousArtist = await this.prisma.artist.findUnique({
      where: { name: 'Various' },
    })
    const duplicateStats = new Map<string, number>()
    const now = DateTime.now().setZone(this.TIMEZONE)

    if (!variousArtist) {
      throw new Error('Various artist not found')
    }

    for (const event of scrapedEvents) {
      let isConflict = false
      try {
        const validated = scrapedEventSchema.parse(event)

        // Ensure dates are in Toronto timezone
        const startDate = this.toTorontoTime(validated.startDate)
        if (!startDate.isValid) {
          throw new Error(`Invalid start date: ${validated.startDate}`)
        }

        // If no end date, set it to 2 hours after start
        if (!validated?.endDate) {
          validated.endDate = startDate.plus({ hours: 2 }).toISO()
        } else {
          const endDate = this.toTorontoTime(validated.endDate)
          if (!endDate.isValid) {
            throw new Error(`Invalid end date: ${validated.endDate}`)
          }
          validated.endDate = endDate.toISO()
        }

        // Update the validated event with the processed dates
        validated.startDate = startDate.toISO() as string

        const { conflictEvent, isDuplicate } =
          await this.checkForDuplicatesAndConflicts(validated)

        if (isDuplicate) {
          const venueName = await this.getVenueName(validated.venueId)
          const currentCount = duplicateStats.get(venueName) || 0
          duplicateStats.set(venueName, currentCount + 1)

          logger.debug(
            `Skipping duplicate event: ${event.eventName ? event.eventName : event.artist} at ${venueName}`
          )
          continue
        }

        /*
         * TODO: Implement conflicting event functionality
         */
        if (conflictEvent) {
          logger.debug(
            `Found conflicting event: ${conflictEvent.name ? conflictEvent.name : conflictEvent.artist.name}`
          )
          isConflict = true
          await this.updateConflictingEvent(conflictEvent)
        }

        const artist = await this.maybeCreateArtist(event)

        transactionData.push({
          ...event,
          artistId: artist.id,
          conflict: isConflict,
        })
      } catch (e: unknown) {
        if (event.eventName && !event.artist && event) {
          /*
           * If we have an event name but no artist, we can assume it's a
           * various event
           */
          transactionData.push({
            ...event,
            conflict: isConflict,
            artistId: variousArtist.id,
          })
        } else {
          logger.error(`Error processing event: ${e}`, event)
        }
      }
    }

    // Log duplicate statistics
    if (duplicateStats.size > 0) {
      logger.info('Duplicate events summary:')
      for (const [venue, count] of duplicateStats.entries()) {
        logger.info(`${venue}: ${count} duplicate events`)
      }
    }

    const txnResults = await Promise.all(
      transactionData
        .map(async (data) => {
          try {
            assert(data.artistId, 'Artist ID is required')

            // Ensure dates are in Toronto timezone
            const startDate = this.toTorontoTime(data.startDate)
            const endDate = data.endDate
              ? this.toTorontoTime(data.endDate)
              : startDate.plus({ hours: 2 })

            // Skip events more than 3 days in the past
            if (startDate < now.minus({ days: 3 })) {
              logger.debug(
                `Skipping event in the past: ${data.eventName || data.artist}`
              )
              return null
            }

            return await this.prisma.event.create({
              data: {
                name: data.eventName ?? '',
                startDate: startDate.toJSDate(),
                endDate: endDate.toJSDate(),
                conflict: data.conflict,
                artist: { connect: { id: data.artistId } },
                venue: { connect: { id: data.venueId } },
                approved: !Boolean(env.NODE_ENV === 'development'),
              },
            })
          } catch (error) {
            // Log the error and continue
            if (error instanceof PrismaClientKnownRequestError) {
              logger.debug(
                `Skipping duplicate event: ${data.eventName || data.artist}`
              )
              return null
            } else if (error instanceof PrismaClientValidationError) {
              throw new Error('Invalid data, throwing error')
            }
            logger.error(`Failed to create event: ${error}`)
            return null
          }
        })
        .filter(Boolean)
    )

    // Filter out the null results
    return txnResults.filter((result) => result !== null)
  }

  /**
   * Check for duplicate events, i.e. events that are within 4 hours of each other
   * with the same name and venue
   * @param {ScrapedEvent} scrapedEvent
   * @returns {Promise<{ scrapedEvent: ScrapedEvent; conflictEvent: Event; isDuplicate: boolean }>}
   */
  private async checkForDuplicatesAndConflicts(
    scrapedEvent: ScrapedEvent
  ): Promise<{
    scrapedEvent: ScrapedEvent
    conflictEvent: EventWithArtistVenue | null
    isDuplicate: boolean
  }> {
    // Parse the start date and ensure it's in Toronto timezone
    const eventStartDate = this.toTorontoTime(scrapedEvent.startDate)
    if (!eventStartDate.isValid) {
      throw new Error(`Invalid start date: ${scrapedEvent.startDate}`)
    }

    // Normalize artist name for comparison
    const normalizedArtistName = this.normalizeArtistName(scrapedEvent.artist)

    // Find potential matches within a 4-hour window
    const potentialMatches = await this.prisma.event.findMany({
      where: {
        startDate: {
          lte: eventStartDate.plus({ hours: 4 }).toJSDate(),
          gte: eventStartDate.minus({ hours: 4 }).toJSDate(),
        },
        venueId: scrapedEvent.venueId,
        OR: [
          {
            artist: {
              name: {
                contains: normalizedArtistName,
                mode: 'insensitive',
              },
            },
          },
          {
            name: {
              contains: normalizedArtistName,
              mode: 'insensitive',
            },
          },
        ],
      },
      include: {
        artist: true,
        venue: true,
      },
    })

    // Calculate similarity scores for each potential match
    const matchesWithScores = potentialMatches.map((event) => ({
      event,
      score: this.calculateSimilarityScore(
        normalizedArtistName,
        event.artist.name,
        event.name
      ),
    }))

    // Sort by similarity score
    matchesWithScores.sort((a, b) => b.score - a.score)

    // Check for exact time match (duplicate)
    const exactTimeMatch = matchesWithScores.find(
      (match) =>
        DateTime.fromJSDate(match.event.startDate)
          .toUTC()
          .equals(eventStartDate) && match.score > 0.8
    )

    // Check for time conflict
    const timeConflict = matchesWithScores.find(
      (match) =>
        !DateTime.fromJSDate(match.event.startDate)
          .toUTC()
          .equals(eventStartDate) && match.score > 0.8
    )

    return {
      scrapedEvent,
      conflictEvent: timeConflict?.event ?? null,
      isDuplicate: Boolean(exactTimeMatch),
    }
  }

  /**
   * Normalize artist name for comparison
   * @param {string} name - The artist name to normalize
   * @returns {string} - The normalized name
   */
  private normalizeArtistName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') // Remove special characters
      .replace(/\s+/g, '') // Remove spaces
      .trim()
  }

  /**
   * Calculate similarity score between two strings
   * @param {string} normalizedName - Normalized name
   * @param {string} artistName - Artist name
   * @param {string} eventName - Event name
   * @returns {number} - Similarity score between 0 and 1
   */
  private calculateSimilarityScore(
    normalizedName: string,
    artistName: string,
    eventName: string
  ): number {
    const normalizedArtistName = this.normalizeArtistName(artistName)
    const normalizedEventName = this.normalizeArtistName(eventName)

    // Calculate Levenshtein distance
    const artistDistance = this.levenshteinDistance(
      normalizedName,
      normalizedArtistName
    )
    const eventDistance = this.levenshteinDistance(
      normalizedName,
      normalizedEventName
    )

    // Calculate similarity scores
    const artistScore =
      1 -
      artistDistance /
        Math.max(normalizedName.length, normalizedArtistName.length)
    const eventScore =
      1 -
      eventDistance /
        Math.max(normalizedName.length, normalizedEventName.length)

    // Return the higher score
    return Math.max(artistScore, eventScore)
  }

  /**
   * Calculate Levenshtein distance between two strings
   * @param {string} str1 - First string
   * @param {string} str2 - Second string
   * @returns {number} - Levenshtein distance
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length
    const n = str2.length
    const dp: number[][] = Array(m + 1)
      .fill(0)
      .map(() => Array(n + 1).fill(0))

    for (let i = 0; i <= m; i++) dp[i][0] = i
    for (let j = 0; j <= n; j++) dp[0][j] = j

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1]
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j - 1] + 1, // substitution
            dp[i - 1][j] + 1, // deletion
            dp[i][j - 1] + 1 // insertion
          )
        }
      }
    }

    return dp[m][n]
  }

  /**
   * Find or create aritst
   * @param {ScrapedEvent} scrapedEvent
   * TODO: rely on artist cache and/or figure our how to optimize
   */
  private async maybeCreateArtist(scrapedEvent: ScrapedEvent) {
    let artist = await this.prisma.artist.findUnique({
      where: {
        name: scrapedEvent.artist,
      },
    })

    if (!artist) {
      artist = await this.prisma.artist.create({
        data: {
          name: scrapedEvent.artist,
          approved: true,
        },
      })
    }

    return artist
  }

  /**
   * Update event with conflicting event
   * @param {Event} event
   */
  private async updateConflictingEvent(event: Event) {
    // we would like to add a conflicting event to the conflicting event fields
    await this.prisma.event.update({
      where: {
        id: event.id,
      },
      data: {
        conflictingEvents: {
          connect: {
            id: event.id,
          },
        },
      },
    })
  }

  /**
   * Get venue name by ID
   * @param {string} venueId
   * @returns {Promise<string>}
   */
  private async getVenueName(venueId: string): Promise<string> {
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { name: true },
    })
    return venue?.name || 'Unknown Venue'
  }
}
