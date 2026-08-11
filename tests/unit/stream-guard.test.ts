import { describe, expect, it, vi } from "vitest";
import { EmptyStreamError, createGuardedTextStreamResponse } from "../../lib/stream-guard";

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
