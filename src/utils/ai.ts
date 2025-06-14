import { env } from '../config'
import { ChatGroq } from '@langchain/groq'
import { ChatAnthropic } from '@langchain/anthropic'
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai'
import { ChatCohere, CohereEmbeddings } from '@langchain/cohere'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { MistralAIEmbeddings } from '@langchain/mistralai'

export type Embeddings =
  | OpenAIEmbeddings
  | CohereEmbeddings
  | MistralAIEmbeddings

export type Ai =
  | ChatGroq
  | ChatOpenAI
  | ChatCohere
  | ChatAnthropic
  | ChatGoogleGenerativeAI

// AI config per provider
const aiConfigs = {
  OPENAI: { refineEvents: false },
  GROQ: { refineEvents: false },
  COHERE: { refineEvents: false },
  ANTHROPIC: { refineEvents: false },
  GOOGLE: { refineEvents: false },
}

export type AiConfig = typeof aiConfigs["OPENAI"]

export const getAiConfig = (): AiConfig => {
  return aiConfigs[env.AI_PROVIDER as keyof typeof aiConfigs] || { refineEvents: false }
}

/**
 * Get the AI and embeddings provider based on the AI_PROVIDER environment variable.
 * @returns {Promise<{ai: Ai, embeddings: Embeddings, chunkSize: number}>} - The AI, embeddings, and chunk size.
 */
export const getAiStuff = (): {
  ai: Ai
  embeddings: Embeddings
  chunkSize: number
} => {
  switch (env.AI_PROVIDER) {
    case 'OPENAI':
      return {
        ai: new ChatOpenAI({
          temperature: 0.1,
          modelName: 'gpt-4o',
        }),
        embeddings: new OpenAIEmbeddings({
          modelName: 'text-embedding-3-small',
        }),
        chunkSize: 12000,
      }
    case 'GROQ':
      return {
        ai: new ChatGroq({
          temperature: 0.1,
          modelName: 'mixtral-8x7b-32768',
        }),
        embeddings: new MistralAIEmbeddings({
          modelName: 'mistral-embed',
        }),
        chunkSize: 32000,
      }
    case 'COHERE':
      return {
        ai: new ChatCohere({
          temperature: 0.1,
          model: 'command-r-plus',
        }),
        embeddings: new CohereEmbeddings(),
        chunkSize: 4000,
      }
    case 'ANTHROPIC':
      return {
        ai: new ChatAnthropic({
          temperature: 0.1,
          model: 'claude-3-sonnet-20240229',
        }),
        embeddings: new OpenAIEmbeddings({
          modelName: 'text-embedding-3-small',
        }),
        chunkSize: 200000,
      }
    case 'GOOGLE':
      return {
        ai: new ChatGoogleGenerativeAI({
          model: 'gemini-1.5-pro',
          temperature: 0.1,
          json: true,
        }),
        embeddings: new OpenAIEmbeddings({
          modelName: 'text-embedding-3-small',
        }),
        chunkSize: 30000,
      }
    default:
      throw new Error('Invalid AI provider')
  }
}
