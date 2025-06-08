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
        embeddings: new OpenAIEmbeddings(),
        chunkSize: 12500,
      }
    case 'GROQ':
      return {
        ai: new ChatGroq({
          temperature: 0.1,
          modelName: 'mixtral-8x7b-32768',
        }),
        embeddings: new MistralAIEmbeddings(),
        chunkSize: 2000,
      }
    case 'COHERE':
      return {
        ai: new ChatCohere({
          temperature: 0.5,
        }),
        embeddings: new CohereEmbeddings(),
        chunkSize: 500,
      }
    case 'ANTHROPIC':
      return {
        ai: new ChatAnthropic({
          temperature: 0.5,
          model: 'claude-sonnet-4-20250514',
        }),
        embeddings: new OpenAIEmbeddings(),
        chunkSize: 12500,
      }
    case 'GOOGLE':
      return {
        ai: new ChatGoogleGenerativeAI({
          model: 'gemini-1.5-pro',
          json: true,
          temperature: 0.1,
        }),
        embeddings: new OpenAIEmbeddings(),
        chunkSize: 15000,
      }
    default:
      throw new Error('Invalid AI provider')
  }
}
