import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { ClarifyRequestSchema, parseRequestBody } from "@/lib/api-schemas";
import {
  classifyError,
  getClientIdentifier,
  rateLimitHeaders,
  retryAfterSeconds,
  trackApiEvent,
} from "@/lib/api-observability";
import {
  CLARIFY_POOL,
  getRotatedChain,
  recordProviderFailure,
  recordProviderSuccess,
} from "@/lib/provider-pool";
import { generateObject } from "ai";
import { z } from "zod";

export const runtime = "edge";

export type ClarifyingQuestion = {
  id: string;
  question: string;
  options: string[];
};

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(3, "1 m"),
  analytics: true,
  prefix: "@prompt-dispatcher/clarify",
});

const SYSTEM_PROMPT = `Generate exactly 3 short multiple-choice clarification questions for a vague prompt.
Infer the domain and ask about its highest-impact missing dimensions: role/persona, core goal/scope, constraints/style/output. For image/video/code/copy/data, adapt those dimensions naturally.
Use dynamic, non-generic options. Keep every question and option punchy. Return only the schema object.`;

const questionSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
    })
  ).max(3),
});

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const identifier = getClientIdentifier(request);
  const limit = await ratelimit.limit(identifier);

  if (!limit.success) {
    const retryAfter = retryAfterSeconds(limit.reset);
    await trackApiEvent({
      route: "clarify",
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

  const parsed = await parseRequestBody(request, ClarifyRequestSchema);
  if (parsed.error) {
    await trackApiEvent({
      route: "clarify",
      event: "validation_failed",
      status: parsed.error.status,
      durationMs: Date.now() - startedAt,
    });
    return parsed.error;
  }

  const { prompt: userPrompt } = parsed.data;

  try {
    const userContent = `PROMPT:\n${userPrompt}`;
    const chain = getRotatedChain("clarify", CLARIFY_POOL);
    let lastError: unknown = new Error("No API keys configured or all providers failed.");
    let fallbackCount = 0;

    for (const provider of chain) {
      const providerStartedAt = Date.now();

      try {
        const result = await generateObject({
          model: provider.sdkModel,
          system: SYSTEM_PROMPT,
          prompt: userContent,
          schema: questionSchema,
          maxRetries: 0,
        });

        recordProviderSuccess("clarify", provider.name, Date.now() - providerStartedAt);
        await trackApiEvent({
          route: "clarify",
          event: "provider_succeeded",
          status: 200,
          provider: provider.name,
          durationMs: Date.now() - startedAt,
          inputChars: userPrompt.length,
          fallbackCount,
        });

        // AI SDK gives us a strongly typed object back automatically
        const questions: ClarifyingQuestion[] = result.object.questions.map(q => ({
          id: crypto.randomUUID(),
          question: q.question,
          options: q.options.slice(0, 4) // cap at 4 options
        }));

        return NextResponse.json(questions, {
          headers: {
            ...rateLimitHeaders(limit),
            "X-Provider-Name": provider.name,
          },
        });
      } catch (error) {
        lastError = error;
        fallbackCount += 1;
        recordProviderFailure("clarify", provider.name);
        await trackApiEvent({
          route: "clarify",
          event: "provider_fallback",
          status: 502,
          provider: provider.name,
          durationMs: Date.now() - providerStartedAt,
          errorType: classifyError(error),
          fallbackCount,
        });
        console.warn(`Fallback triggered for ${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw lastError;
  } catch (error) {
    await trackApiEvent({
      route: "clarify",
      event: "failed",
      status: 500,
      durationMs: Date.now() - startedAt,
      errorType: classifyError(error),
    });
    console.error("Clarification failed", error);
    return NextResponse.json(
      { error: "Guided Mode is temporarily unavailable. Try direct generation or retry shortly." },
      { status: 503 },
    );
  }
}
