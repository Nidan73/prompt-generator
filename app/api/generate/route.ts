import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse, type NextRequest } from "next/server";
import { streamObject } from "ai";
import {
  GenerateRequestSchema,
  GenerateSchemaObject,
  parseRequestBody,
} from "@/lib/api-schemas";
import { buildRegistryBlock, getLiveModelLandscape } from "@/lib/ai-catalog";
import {
  classifyError,
  getClientIdentifier,
  rateLimitHeaders,
  retryAfterSeconds,
  trackApiEvent,
} from "@/lib/api-observability";
import {
  GENERATE_POOL,
  getRotatedChain,
  recordProviderFailure,
  recordProviderSuccess,
} from "@/lib/provider-pool";

export const maxDuration = 60;
export const runtime = "edge";

const generateRateLimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(50, "1 d"),
  analytics: true,
  prefix: "prompt-gen-api",
});

const BASE_SYSTEM_PROMPT = `You are Bhai Thik Kor: prompt optimizer + AI platform router.
Return only schema-valid JSON. No markdown fences or hidden reasoning.

Optimize the rough prompt into a complete, executable expert prompt. Pick framework by intent: code=Context/Objective/Constraints/Output; creative=Premise/Tone/Elements/Format; data=Data/Goal/Steps/Output; marketing=AIDA or PAS; default=Role/Task/Context/Format/Constraints.

Route to one best model/platform for each tier: open_source, freemium, premium. Use only platform_id values from PLATFORMS and current model names from MODELS when suitable. Reasoning: one concise fit sentence.`;

function buildSystemPrompt(modelLandscape: string) {
  return `${BASE_SYSTEM_PROMPT}

[PLATFORMS]
${buildRegistryBlock()}

[MODELS]
${modelLandscape}

If a latest model is not valid for a tier, choose the strongest valid platform/model pair.`;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  try {
    const ip = getClientIdentifier(request);
    const limitResult = await generateRateLimit.limit(ip);
    const { success, limit, remaining, reset } = limitResult;

    if (!success) {
      const retryAfter = retryAfterSeconds(reset);
      await trackApiEvent({
        route: "generate",
        event: "rate_limited",
        status: 429,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json(
        {
          error: "Daily prompt generation limit reached. Please try again tomorrow.",
          retryAfter,
        },
        {
          status: 429,
          headers: {
            ...rateLimitHeaders(limitResult),
            "Retry-After": String(retryAfter),
          },
        },
      );
    }

    const parsed = await parseRequestBody(request, GenerateRequestSchema);
    if (parsed.error) {
      await trackApiEvent({
        route: "generate",
        event: "validation_failed",
        status: parsed.error.status,
        durationMs: Date.now() - startedAt,
      });
      return parsed.error;
    }

    const { prompt: userPrompt, clarifications } = parsed.data;
    let userContent = `PROMPT:\n${userPrompt}\n`;

    if (clarifications.length > 0) {
      userContent += "\nCLARIFICATIONS:\n";
      clarifications.forEach((clarification) => {
        userContent += `- ${clarification.question}: ${clarification.answer}\n`;
      });
    }

    const systemPrompt = buildSystemPrompt(await getLiveModelLandscape());
    const chain = getRotatedChain("generate", GENERATE_POOL);
    let lastError: unknown = new Error("No API keys configured or all providers failed.");
    let fallbackCount = 0;

    for (const provider of chain) {
      const providerStartedAt = Date.now();

      try {
        const result = await streamObject({
          model: provider.sdkModel,
          system: systemPrompt,
          prompt: userContent,
          schema: GenerateSchemaObject,
          maxRetries: 0,
        });

        recordProviderSuccess("generate", provider.name, Date.now() - providerStartedAt);
        await trackApiEvent({
          route: "generate",
          event: "provider_accepted",
          status: 200,
          provider: provider.name,
          durationMs: Date.now() - startedAt,
          inputChars: userPrompt.length,
          clarificationCount: clarifications.length,
          fallbackCount,
        });

        return result.toTextStreamResponse({
          headers: {
            "X-RateLimit-Limit": String(limit),
            "X-RateLimit-Remaining": String(remaining),
            "X-RateLimit-Reset": String(reset),
            "X-Provider-Name": provider.name,
          },
        });
      } catch (error) {
        lastError = error;
        fallbackCount += 1;
        recordProviderFailure("generate", provider.name);
        await trackApiEvent({
          route: "generate",
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
      route: "generate",
      event: "failed",
      status: 500,
      durationMs: Date.now() - startedAt,
      errorType: classifyError(error),
    });
    console.error("Prompt generation failed", error);
    return NextResponse.json(
      { error: "All AI providers are busy or unavailable. Please try again in a moment." },
      { status: 503 },
    );
  }
}
