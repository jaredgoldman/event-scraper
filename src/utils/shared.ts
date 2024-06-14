import { setTimeout as nodeSetTimeout } from "timers/promises";

export const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const sendWithRetries = async <T>(
  callback: () => Promise<T>,
  retries = 8,
  duration = 2000,
): Promise<T> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await callback();
    } catch (error) {
      if (attempt === retries) {
        console.error(`No retries remaining (${retries})`);
        throw error;
      } else {
        const backoff = duration * 2 ** (attempt - 1);
        console.error(error)
        console.log(
          `Retrying in ${backoff / 1000} seconds (${
            retries - attempt
          }/${retries} attempts remaining)`,
        );
        await nodeSetTimeout(backoff);
      }
    }
  }
  throw new Error("No retries remaining");
}
