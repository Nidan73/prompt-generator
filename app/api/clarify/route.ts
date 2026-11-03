import { NextRequest, NextResponse } from "next/server";
import { buildClarifyUserContent } from "@/lib/prompt-envelope";
import { checkRateLimits, createRateLimit } from "@/lib/rate-limit";
import { ClarifyRequestSchema, parseRequestBody } from "@/lib/api-schemas";
import {
  classifyError,
  describeError,
  getClientIdentifier,
  rateLimitHeaders,
  retryAfterSeconds,
  trackApiEvent,
} from "@/lib/api-observability";
import {
  CLARIFY_POOL,
  getChain,
  recordProviderFailure,
  recordProviderSuccess,
} from "@/lib/provider-pool";
import { CLARIFY_SYSTEM_PROMPT } from "@/lib/prompts/clarify-system-prompt";
import { InvalidOutputError, normalizeClarifyQuestions } from "@/lib/clarify-questions";
import { generateObject } from "ai";
import { z } from "zod";

export const maxDuration = 60;
export const runtime = "nodejs";

/** Clarify is a quick side call; a slow provider should fall through, not stall the UI. */
const CLARIFY_PROVIDER_TIMEOUT_MS = 10_000;

export type ClarifyingQuestion = {
  id: string;
  question: string;
  options: string[];
};

const ratelimit = createRateLimit({
  tokens: 3,
  window: "1 m",
  prefix: "@prompt-dispatcher/clarify",
  scope: "minute",
});

const dailyRatelimit = createRateLimit({
  tokens: 60,
  window: "1 d",
  prefix: "@prompt-dispatcher/clarify-daily",
  scope: "day",
});

const questionSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
    })
  ),
});

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  // Validate first so a malformed body cannot consume the caller's window.
  const parsed = await parseRequestBody(request, ClarifyRequestSchema);
  if (parsed.error) {
    trackApiEvent({
      route: "clarify",
      event: "validation_failed",
      status: parsed.error.status,
      durationMs: Date.now() - startedAt,
    }, { persist: false });
    return parsed.error;
  }

  const identifier = getClientIdentifier(request);
  const limit = await checkRateLimits(identifier, [ratelimit, dailyRatelimit]);

  if (!limit.success) {
    const retryAfter = retryAfterSeconds(limit.reset);
    trackApiEvent({
      route: "clarify",
      event: "rate_limited",
      status: 429,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        error:
          limit.scope === "day"
            ? "Daily limit reached for this feature. Please try again tomorrow."
            : "Rate limit exceeded. Please wait before trying again.",
        retryAfter,
      },
      {
        status: 429,
        headers: {
          ...rateLimitHeaders(limit),
          "Retry-After": String(retryAfter),
        },
      },
    );
  }

  const { prompt: userPrompt } = parsed.data;

  try {
    const userContent = buildClarifyUserContent(userPrompt);
    const chain = await getChain("clarify", CLARIFY_POOL, { structured: true });
    let lastError: unknown = new Error("No API keys configured or all providers failed.");
    let fallbackCount = 0;

    for (const provider of chain) {
      // A disconnected client should not keep burning provider calls.
      if (request.signal.aborted) {
        trackApiEvent({
          route: "clarify",
          event: "client_aborted",
          status: 499,
          durationMs: Date.now() - startedAt,
          fallbackCount,
        }, { persist: false });
        return new Response(null, { status: 499 });
      }

      const providerStartedAt = Date.now();

      try {
        const result = await generateObject({
          model: provider.sdkModel,
          system: CLARIFY_SYSTEM_PROMPT,
          prompt: userContent,
          schema: questionSchema,
          maxRetries: 0,
          abortSignal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(CLARIFY_PROVIDER_TIMEOUT_MS),
          ]),
        });

        const normalized = normalizeClarifyQuestions(result.object);
        // An unusable answer counts as a provider failure so the next one is tried.
        if (!normalized) throw new InvalidOutputError("Provider returned fewer than 3 usable questions.");

        recordProviderSuccess("clarify", provider.name, Date.now() - providerStartedAt);
        trackApiEvent({
          route: "clarify",
          event: "provider_succeeded",
          status: 200,
          provider: provider.name,
          durationMs: Date.now() - startedAt,
          inputChars: userPrompt.length,
          fallbackCount,
        });

        const questions: ClarifyingQuestion[] = normalized.map((q) => ({
          id: crypto.randomUUID(),
          question: q.question,
          options: q.options,
        }));

        return NextResponse.json(questions, {
          headers: {
            ...rateLimitHeaders(limit),
            "X-Provider-Name": provider.name,
          },
        });
      } catch (error) {
        // The client left: not the provider's fault, so do not count a failure.
        if (request.signal.aborted) {
          trackApiEvent({
            route: "clarify",
            event: "client_aborted",
            status: 499,
            durationMs: Date.now() - startedAt,
            fallbackCount,
          }, { persist: false });
          return new Response(null, { status: 499 });
        }

        lastError = error;
        fallbackCount += 1;
        recordProviderFailure("clarify", provider.name);
        trackApiEvent({
          route: "clarify",
          event: "provider_fallback",
          status: 502,
          provider: provider.name,
          durationMs: Date.now() - providerStartedAt,
          errorType: classifyError(error),
          fallbackCount,
        });
        console.warn(
          JSON.stringify({
            scope: "bhai-thik-kor",
            event: "provider_attempt_failed",
            route: "clarify",
            provider: provider.name,
            ...describeError(error),
          }),
        );
      }
    }

    throw lastError;
  } catch (error) {
    trackApiEvent({
      route: "clarify",
      event: "failed",
      status: 500,
      durationMs: Date.now() - startedAt,
      errorType: classifyError(error),
    });
    console.error(
      JSON.stringify({
        scope: "bhai-thik-kor",
        event: "route_failed",
        route: "clarify",
        ...describeError(error),
      }),
    );
    return NextResponse.json(
      { error: "Guided Mode is temporarily unavailable. Try direct generation or retry shortly." },
      { status: 503 },
    );
  }
}
