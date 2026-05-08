import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { streamText } from "ai";
import { RefineRequestSchema, parseRequestBody } from "@/lib/api-schemas";
import {
  classifyError,
  getClientIdentifier,
  rateLimitHeaders,
  retryAfterSeconds,
  trackApiEvent,
} from "@/lib/api-observability";
import {
  REFINE_POOL,
  getRotatedChain,
  recordProviderFailure,
  recordProviderSuccess,
} from "@/lib/provider-pool";

export const runtime = "edge";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "1 m"),
  analytics: true,
  prefix: "@prompt-generator/refine",
});

const SYSTEM_PROMPT = `Edit the existing prompt according to the request.
Preserve its structure: XML tags stay XML, comma-separated visual prompts stay comma-separated, RTCFC/AIDA/PAS headers stay intact.
Change only what the user asks. Return only the modified prompt text; no JSON, fences, or commentary.`;

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const identifier = getClientIdentifier(request);
  const limit = await ratelimit.limit(identifier);

  if (!limit.success) {
    const retryAfter = retryAfterSeconds(limit.reset);
    await trackApiEvent({
      route: "refine",
      event: "rate_limited",
      status: 429,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait before trying again.", retryAfter },
      {
        status: 429,
        headers: {
          ...rateLimitHeaders(limit),
          "Retry-After": String(retryAfter),
        },
      },
    );
  }

  const parsed = await parseRequestBody(request, RefineRequestSchema);
  if (parsed.error) {
    await trackApiEvent({
      route: "refine",
      event: "validation_failed",
      status: parsed.error.status,
      durationMs: Date.now() - startedAt,
    });
    return parsed.error;
  }

  const { currentPrompt, instruction } = parsed.data;
  const userContent = `PROMPT:\n${currentPrompt.slice(0, 2000)}\n\nEDIT:\n${instruction.slice(0, 500)}`;

  try {
    const chain = getRotatedChain("refine", REFINE_POOL);
    let lastError: unknown = new Error("No API keys configured or all providers failed.");
    let fallbackCount = 0;

    for (const provider of chain) {
      const providerStartedAt = Date.now();

      try {
        const result = await streamText({
          model: provider.sdkModel,
          system: SYSTEM_PROMPT,
          prompt: userContent,
          maxRetries: 0,
        });

        recordProviderSuccess("refine", provider.name, Date.now() - providerStartedAt);
        await trackApiEvent({
          route: "refine",
          event: "provider_accepted",
          status: 200,
          provider: provider.name,
          durationMs: Date.now() - startedAt,
          inputChars: currentPrompt.length + instruction.length,
          fallbackCount,
        });

        return result.toTextStreamResponse({
          headers: {
            ...rateLimitHeaders(limit),
            "X-Provider-Name": provider.name,
          },
        });
      } catch (error) {
        lastError = error;
        fallbackCount += 1;
        recordProviderFailure("refine", provider.name);
        await trackApiEvent({
          route: "refine",
          event: "provider_fallback",
          status: 502,
          provider: provider.name,
          durationMs: Date.now() - providerStartedAt,
          errorType: classifyError(error),
          fallbackCount,
        });
        console.warn(
          `Fallback triggered for ${provider.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    throw lastError;
  } catch (error) {
    await trackApiEvent({
      route: "refine",
      event: "failed",
      status: 500,
      durationMs: Date.now() - startedAt,
      errorType: classifyError(error),
    });
    console.error("Prompt refinement failed", error);
    return NextResponse.json(
      { error: "Refinement is temporarily unavailable. Please retry in a moment." },
      { status: 503 },
    );
  }
}
