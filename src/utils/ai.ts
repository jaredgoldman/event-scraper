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

export type AiConfig = {
  ai: Ai
  embeddings: Embeddings
  refineEvents?: boolean
  chunkSize?: number
}

/**
 * Get the AI and embeddings provider based on the AI_PROVIDER environment variable.
 * @returns {AiConfig} - The AI, embeddings, and chunk size.
 */
export const getAiConfig = (): AiConfig => {
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
      return {
        ai: new ChatOpenAI({
          temperature: 0.1,
          modelName: 'gpt-4o',
        }),
        embeddings: new OpenAIEmbeddings({
          modelName: 'text-embedding-3-small',
        }),
      }
  }
}
