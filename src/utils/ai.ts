import env from "../config/env";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ChatCohere, CohereEmbeddings } from "@langchain/cohere";
import { MistralAIEmbeddings } from "@langchain/mistralai";

export type Embeddings =
  | OpenAIEmbeddings
  | CohereEmbeddings
  | MistralAIEmbeddings;
export type Ai = ChatGroq | ChatOpenAI | ChatCohere;

export const getAiStuff = (): {
  ai: Ai;
  embeddings: Embeddings;
  chunkSize: number;
} => {
  switch (env.AI_PROVIDER) {
    case "OPENAI":
      return {
        ai: new ChatOpenAI({
          temperature: 0.1,
          modelName: "gpt-4o",
        }),
        embeddings: new OpenAIEmbeddings(),
        chunkSize: 12500,
      };
    case "GROQ":
      return {
        ai: new ChatGroq({
          temperature: 0.1,
          modelName: "mixtral-8x7b-32768",
        }),
        embeddings: new MistralAIEmbeddings(),
        chunkSize: 2000,
      };
    case "COHERE":
      return {
        ai: new ChatCohere({
          temperature: 0.5,
        }),
        embeddings: new CohereEmbeddings(),
        chunkSize: 500,
      };
    default:
      throw new Error("Invalid AI provider");
  }
};
