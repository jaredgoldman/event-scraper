import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";

export class Ai {
  private model: ChatOpenAI;

  constructor() {
    this.model = new ChatOpenAI({
      model: "gpt-4o",
    });
    console.log("Ai constructor");
  }

  sendMessage = async (message: string) => {
    const messages = [
      ["system", "context"],
      ["user", "{input}"],
    ] as [string, string][];

    const prompt = ChatPromptTemplate.fromMessages(messages);
    const chain = prompt.pipe(this.model);
    chain.invoke({
      input: message,
    });
  };
}
