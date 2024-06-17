import env from "../config/env";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ChatCohere, CohereEmbeddings } from "@langchain/cohere";

export type Ai = ChatGroq | ChatOpenAI | ChatCohere;

export const getAi = (): Ai => {
  switch (env.AI_PROVIDER) {
    case "OPENAI":
      return new ChatOpenAI({
        temperature: 1,
        modelName: "llama3-8b-8192",
      });
    case "GROQ":
      return new ChatGroq({
        temperature: 1,
        modelName: "llama3-8b-8192",
      });
    case "COHERE":
      return new ChatCohere({
        temperature: 1,
      });
    default:
      throw new Error("Invalid AI provider");
  }
};

export type Embeddings = OpenAIEmbeddings | CohereEmbeddings;

export const getEmbeddings = (): OpenAIEmbeddings | CohereEmbeddings => {
  switch (env.AI_PROVIDER) {
    case "OPENAI":
      return new OpenAIEmbeddings();
    case "COHERE":
      return new CohereEmbeddings();
    default:
      return new CohereEmbeddings();
  }
};
