import { logger } from '../services'

/**
 * Clean and parse a JSON response from an AI model.
 * Handles markdown code blocks and provides detailed error logging.
 *
 * @param content - The raw content from the AI response
 * @returns The parsed JSON data
 * @throws Error if parsing fails
 */
export const cleanAndParseJson = <T>(content: string): T => {
  // Clean up markdown code blocks
  const cleanedContent = content
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim()

  try {
    return JSON.parse(cleanedContent) as T
  } catch (e) {
    logger.error('Failed to parse JSON response:', e)
    logger.debug('Raw content:', content)
    logger.debug('Cleaned content:', cleanedContent)
    throw e
  }
}
