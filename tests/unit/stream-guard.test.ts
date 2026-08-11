import { describe, expect, it, vi } from "vitest";
import {
  EmptyStreamError,
  createGuardedTextStreamResponse,
  textStreamFromFullStream,
} from "../../lib/stream-guard";

/**
 * Mirrors what the AI SDK actually puts on `fullStream`. A provider failure is a
 * normal `{type:"error"}` part followed by a clean close — never a stream error —
 * which is why reading `result.textStream` cannot detect it.
 */
function fullStreamOf(parts: Array<Record<string, unknown>>) {
  return new ReadableStream<Record<string, unknown>>({
    start(controller) {
      parts.forEach((part) => controller.enqueue(part));
      controller.close();
    },
  }) as ReadableStream<never>;
}

/** Drains a string stream; rejects if the stream errors. */
async function drain(stream: ReadableStream<string>): Promise<string> {
  const reader = stream.getReader();
  let out = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    if (value) out += value;
  }
}

function streamOf(chunks: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
}

/** A stream that yields some chunks, then fails — the mid-stream death case. */
function streamThatFailsAfter(chunks: string[], error: Error): ReadableStream<string> {
  let index = 0;
  return new ReadableStream<string>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
        return;
      }
      controller.error(error);
    },
  });
}

/** A stream that never produces anything and never closes. */
function hangingStream(): ReadableStream<string> {
  return new ReadableStream<string>({ pull() { /* never resolves a chunk */ } });
}

async function readAll(response: Response): Promise<string> {
  return await response.text();
}

describe("createGuardedTextStreamResponse", () => {
  it("passes a healthy stream through unchanged", async () => {
    const response = await createGuardedTextStreamResponse({
      textStream: streamOf(["Hello", " ", "world"]),
    });

    expect(response.status).toBe(200);
    expect(await readAll(response)).toBe("Hello world");
  });

  it("forwards headers so the provider name and rate limits survive", async () => {
    const response = await createGuardedTextStreamResponse({
      textStream: streamOf(["ok"]),
      headers: { "X-Provider-Name": "OR openai/gpt-oss-20b:free" },
    });

    expect(response.headers.get("X-Provider-Name")).toBe("OR openai/gpt-oss-20b:free");
  });

  it("throws instead of returning an empty 200 when the provider yields nothing", async () => {
    // This is the /api/refine failure: 200 with a zero-byte body after 69s.
    await expect(
      createGuardedTextStreamResponse({ textStream: streamOf([]) }),
    ).rejects.toBeInstanceOf(EmptyStreamError);
  });

  it("throws when the provider errors before any output, so the caller can fall back", async () => {
    const boom = new Error("ResourceExhausted: Worker local total request limit reached (32/32)");
    await expect(
      createGuardedTextStreamResponse({ textStream: streamThatFailsAfter([], boom) }),
    ).rejects.toThrow(/ResourceExhausted/);
  });

  it("skips empty deltas while waiting for real content", async () => {
    const response = await createGuardedTextStreamResponse({
      textStream: streamOf(["", "", "actual text"]),
    });

    expect(await readAll(response)).toBe("actual text");
  });

  it("times out a provider that never produces a first chunk", async () => {
    await expect(
      createGuardedTextStreamResponse({
        textStream: hangingStream(),
        firstChunkTimeoutMs: 30,
      }),
    ).rejects.toBeInstanceOf(EmptyStreamError);
  });

  it("keeps partial content and reports when the stream dies after committing", async () => {
    const onLateFailure = vi.fn();
    const response = await createGuardedTextStreamResponse({
      textStream: streamThatFailsAfter(["partial ", "output"], new Error("upstream died")),
      onLateFailure,
    });

    expect(await readAll(response)).toBe("partial output");
    expect(onLateFailure).toHaveBeenCalledOnce();
  });
});

describe("textStreamFromFullStream", () => {
  it("forwards streamText deltas, which spell the text `text`", async () => {
    const stream = textStreamFromFullStream(
      fullStreamOf([
        { type: "text-delta", text: "Hello" },
        { type: "text-delta", text: " world" },
        { type: "finish" },
      ]),
    );

    expect(await drain(stream)).toBe("Hello world");
  });

  it("forwards streamObject deltas, which spell it `textDelta`", async () => {
    const stream = textStreamFromFullStream(
      fullStreamOf([
        { type: "text-delta", textDelta: '{"a":' },
        { type: "text-delta", textDelta: "1}" },
        { type: "object", object: { a: 1 } },
        { type: "finish" },
      ]),
    );

    expect(await drain(stream)).toBe('{"a":1}');
  });

  it("turns an error part into a real stream error carrying the provider's message", async () => {
    const stream = textStreamFromFullStream(
      fullStreamOf([
        {
          type: "error",
          error: new Error("ResourceExhausted: Worker local total request limit reached (32/32)"),
        },
      ]),
    );

    await expect(drain(stream)).rejects.toThrow(/ResourceExhausted/);
  });

  it("surfaces the real reason before the first chunk instead of a generic empty stream", async () => {
    // Previously this arrived as `done`, so the guard reported "empty stream"
    // and the fallback loop logged a cause that was not the actual failure.
    const boom = new Error("429 rate limit exceeded");
    await expect(
      createGuardedTextStreamResponse({
        textStream: textStreamFromFullStream(fullStreamOf([{ type: "error", error: boom }])),
      }),
    ).rejects.toThrow(/429 rate limit/);
  });

  it("reports mid-stream death instead of silently truncating the body", async () => {
    const onLateFailure = vi.fn();
    const response = await createGuardedTextStreamResponse({
      textStream: textStreamFromFullStream(
        fullStreamOf([
          { type: "text-delta", textDelta: '{"optimized_prompt":"partial' },
          { type: "error", error: new Error("provider disconnected") },
        ]),
      ),
      onLateFailure,
    });

    expect(await readAll(response)).toBe('{"optimized_prompt":"partial');
    expect(onLateFailure).toHaveBeenCalledOnce();
  });
});
