import type { ChatChunk, ChatHandle, ChatResult } from "./types";

/**
 * Run a chat job once, exposing both streamed chunks and the final result.
 */
export function createChatHandle(
  work: (emit: (chunk: ChatChunk) => void) => Promise<ChatResult>
): ChatHandle {
  type Waiter = {
    resolve: () => void;
    reject: (err: unknown) => void;
  };
  const chunks: ChatChunk[] = [];
  const waiters: Waiter[] = [];
  let finished = false;
  let error: unknown;

  const notify = (err?: unknown) => {
    const pending = waiters.splice(0);
    for (const w of pending) {
      if (err) w.reject(err);
      else w.resolve();
    }
  };

  const promise = work((chunk) => {
    chunks.push(chunk);
    notify();
  }).then(
    (result) => {
      finished = true;
      notify();
      return result;
    },
    (err: unknown) => {
      finished = true;
      error = err;
      notify(err);
      throw err;
    }
  );

  const iterator = async function* (): AsyncGenerator<ChatChunk> {
    let i = 0;
    while (true) {
      if (i < chunks.length) {
        yield chunks[i++];
        continue;
      }
      if (finished) {
        if (error) throw error;
        return;
      }
      await new Promise<void>((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    }
  };

  return {
    [Symbol.asyncIterator]: iterator,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
    [Symbol.toStringTag]: "Promise",
  } as ChatHandle;
}
