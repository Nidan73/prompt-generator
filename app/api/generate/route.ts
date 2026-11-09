import { NextResponse, type NextRequest } from "next/server";
import { streamObject } from "ai";
import { createGuardedTextStreamResponse, textStreamFromFullStream } from "@/lib/stream-guard";
import {
  GenerateRequestSchema,
  GenerateSchemaObject,
  parseRequestBody,
} from "@/lib/api-schemas";
import { buildRegistryBlock, getLiveModelLandscape } from "@/lib/ai-catalog";
import {
  classifyError,
  describeError,
  getClientIdentifier,
  providerErrorLogger,
  rateLimitHeaders,
  retryAfterSeconds,
  trackApiEvent,
} from "@/lib/api-observability";
import { buildGenerateSystemPrompt } from "@/lib/prompts/generate-system-prompt";
import { buildGenerateUserContent } from "@/lib/prompt-envelope";
import { createRateLimit } from "@/lib/rate-limit";
import {
  GENERATE_POOL,
  GENERATE_PRIMARY_COUNT,
  getChain,
  recordProviderFailure,
  recordProviderSuccess,
} from "@/lib/provider-pool";

export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * Short enough that a stalled provider does not eat the whole request budget.
 * At 60s total this leaves room for roughly five attempts down the chain.
 */
const FIRST_CHUNK_TIMEOUT_MS = 10_000;

const generateRateLimit = createRateLimit({
  tokens: 50,
  window: "1 d",
  prefix: "prompt-gen-api",
  scope: "day",
});

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  try {
    // Validate before metering: a malformed body should not cost the user one of
    // their 50 daily generations.
    const parsed = await parseRequestBody(request, GenerateRequestSchema);
    if (parsed.error) {
      trackApiEvent({
        route: "generate",
        event: "validation_failed",
        status: parsed.error.status,
        durationMs: Date.now() - startedAt,
      }, { persist: false });
      return parsed.error;
    }

    const ip = getClientIdentifier(request);
    const limitResult = await generateRateLimit.check(ip);

    if (!limitResult.success) {
      const retryAfter = retryAfterSeconds(limitResult.reset);
      trackApiEvent({
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

    const { prompt: userPrompt, clarifications } = parsed.data;
    const userContent = buildGenerateUserContent(userPrompt, clarifications);

    const landscape = await getLiveModelLandscape();
    const systemPrompt = buildGenerateSystemPrompt({
      registryBlock: buildRegistryBlock(),
      models: landscape.models,
      imageModels: landscape.imageModels,
    });
    const chain = await getChain("generate", GENERATE_POOL, {
      structured: true,
      primaryCount: GENERATE_PRIMARY_COUNT,
    });
    let lastError: unknown = new Error("No API keys configured or all providers failed.");
    let fallbackCount = 0;

    for (const provider of chain) {
      // A disconnected client should not keep burning provider calls.
      if (request.signal.aborted) {
        trackApiEvent({
          route: "generate",
          event: "client_aborted",
          status: 499,
          durationMs: Date.now() - startedAt,
          fallbackCount,
        }, { persist: false });
        return new Response(null, { status: 499 });
      }

      const providerStartedAt = Date.now();

      try {
        const result = streamObject({
          model: provider.sdkModel,
          system: systemPrompt,
          prompt: userContent,
          schema: GenerateSchemaObject,
          maxRetries: 0,
          abortSignal: request.signal,
          onError: providerErrorLogger("generate", provider.name),
        });

        // Wait for real output before committing to a 200, otherwise a provider
        // that dies mid-stream leaves the client with an empty body and no
        // fallback, because the headers have already gone out.
        const response = await createGuardedTextStreamResponse({
          textStream: textStreamFromFullStream(result.fullStream),
          firstChunkTimeoutMs: FIRST_CHUNK_TIMEOUT_MS,
          headers: {
            ...rateLimitHeaders(limitResult),
            "X-Provider-Name": provider.name,
          },
          onLateFailure: (error) => {
            trackApiEvent({
              route: "generate",
              event: "stream_truncated",
              status: 200,
              provider: provider.name,
              errorType: classifyError(error),
            });
          },
        });

        recordProviderSuccess("generate", provider.name, Date.now() - providerStartedAt);
        trackApiEvent({
          route: "generate",
          event: "provider_accepted",
          status: 200,
          provider: provider.name,
          durationMs: Date.now() - startedAt,
          inputChars: userPrompt.length,
          clarificationCount: clarifications.length,
          fallbackCount,
        });

        return response;
      } catch (error) {
        // The client left: not the provider's fault, so do not count a failure.
        if (request.signal.aborted) {
          trackApiEvent({
            route: "generate",
            event: "client_aborted",
            status: 499,
            durationMs: Date.now() - startedAt,
            fallbackCount,
          }, { persist: false });
          return new Response(null, { status: 499 });
        }

        lastError = error;
        fallbackCount += 1;
        recordProviderFailure("generate", provider.name);
        trackApiEvent({
          route: "generate",
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
            route: "generate",
            provider: provider.name,
            ...describeError(error),
          }),
        );
      }
    }

    throw lastError;
  } catch (error) {
    trackApiEvent({
      route: "generate",
      event: "failed",
      status: 503,
      durationMs: Date.now() - startedAt,
      errorType: classifyError(error),
    });
    console.error(
      JSON.stringify({
        scope: "bhai-thik-kor",
        event: "route_failed",
        route: "generate",
        ...describeError(error),
      }),
    );
    return NextResponse.json(
      { error: "All AI providers are busy or unavailable. Please try again in a moment." },
      { status: 503 },
    );
  }
}
