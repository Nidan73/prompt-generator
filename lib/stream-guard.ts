import { createTextStreamResponse } from "ai";

/**
 * Streaming Fallback Guard
 *
 * `toTextStreamResponse()` returns a 200 the moment the model call resolves,
 * before the model has produced a single token. If the provider then dies —
 * which free-tier models do routinely, e.g. "ResourceExhausted: Worker local
 * total request limit reached (32/32)" — the headers are already sent, the
 * route cannot try the next provider, and the client waits out the request for
 * a zero-byte 200.
 *
 * This waits for the first real chunk before committing to a response. Failing
 * that, it throws, so the caller's normal provider-fallback loop handles it as
 * an ordinary failure. Once a first chunk exists, the rest streams as usual.
 */

const DEFAULT_FIRST_CHUNK_TIMEOUT_MS = 20_000;

export class EmptyStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmptyStreamError";
  }
}

async function readFirstChunk(
  reader: ReadableStreamDefaultReader<string>,
  timeoutMs: number,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new EmptyStreamError(`provider produced no output within ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  try {
    // Providers may emit empty deltas before real content; those are not output.
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) throw new EmptyStreamError("provider returned an empty stream");
      if (value) return value;
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function createGuardedTextStreamResponse(options: {
  textStream: ReadableStream<string>;
  headers?: HeadersInit;
  firstChunkTimeoutMs?: number;
  /** Called when the stream dies after the response has already been committed. */
  onLateFailure?: (error: unknown) => void;
}): Promise<Response> {
  const {
    textStream,
    headers,
    firstChunkTimeoutMs = DEFAULT_FIRST_CHUNK_TIMEOUT_MS,
    onLateFailure,
  } = options;

  const reader = textStream.getReader();
  const firstChunk = await readFirstChunk(reader, firstChunkTimeoutMs);

  const guarded = new ReadableStream<string>({
    start(controller) {
      controller.enqueue(firstChunk);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        if (value) controller.enqueue(value);
      } catch (error) {
        // Past this point the client already has a 200 and partial content.
        // Closing cleanly beats hanging; there is no provider fallback left.
        onLateFailure?.(error);
        controller.close();
      }
    },
    cancel(reason) {
      void reader.cancel(reason).catch(() => undefined);
    },
  });

  return createTextStreamResponse({ headers, textStream: guarded });
}
