import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { search, SafeSearchType } from "duck-duck-scrape";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";

type Recommendation = {
  model_name: string;
  platform_url: string;
};

type DispatcherResponse = {
  optimized_prompt: string;
  recommendations: {
    open_source: Recommendation;
    freemium: Recommendation;
    premium: Recommendation;
  };
};

type GenerateRequest = {
  prompt?: unknown;
  clarifications?: unknown;
};

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(3, "1 m"),
  analytics: true,
  prefix: "@prompt-dispatcher/generate",
});

const MODEL_CHAIN = [
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-120b",
  "qwen/qwen3-32b",
] as const;

const SYSTEM_PROMPT = `You are the AI Prompt Dispatcher.

You turn vague user goals into master-level prompts and recommend where the user should execute them.

Return one valid JSON object only. Do not include markdown, prose, comments, code fences, or extra keys.

The JSON object must exactly match this TypeScript shape:
{
  "optimized_prompt": "string",
  "recommendations": {
    "open_source": {
      "model_name": "string",
      "platform_url": "string"
    },
    "freemium": {
      "model_name": "string",
      "platform_url": "string"
    },
    "premium": {
      "model_name": "string",
      "platform_url": "string"
    }
  }
}

Rules:
- Use the live search snippets as current context, but do not cite or expose raw snippets.
- The optimized_prompt must be detailed, execution-ready, and directly usable in another AI system.
- Recommend one open source option, one freemium option, and one premium option.
- Each platform_url must be a real platform, model page, provider page, or product page URL.
- If live search context is thin, make a conservative recommendation from generally known AI platforms.`;

export async function POST(request: NextRequest) {
  const identifier = getClientIdentifier(request);
  const limit = await ratelimit.limit(identifier);

  if (!limit.success) {
    const retryAfter = Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000));

    return NextResponse.json(
      {
        error: "Rate limit exceeded. Please wait before trying again.",
        retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(limit.limit),
          "X-RateLimit-Remaining": String(limit.remaining),
          "X-RateLimit-Reset": String(limit.reset),
        },
      },
    );
  }

  let body: GenerateRequest;

  try {
    body = (await request.json()) as GenerateRequest;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const userPrompt = normalizePrompt(body.prompt);

  if (!userPrompt) {
    return NextResponse.json({ error: "A non-empty prompt is required." }, { status: 400 });
  }

  try {
    const snippets = await getSearchSnippets(userPrompt);
    const llmContent = await createDispatcherCompletion(userPrompt, body.clarifications, snippets);
    const parsed = parseDispatcherResponse(llmContent);

    return NextResponse.json(parsed, {
      headers: {
        "X-RateLimit-Limit": String(limit.limit),
        "X-RateLimit-Remaining": String(limit.remaining),
        "X-RateLimit-Reset": String(limit.reset),
      },
    });
  } catch (error) {
    console.error("Prompt generation failed", error);

    return NextResponse.json(
      { error: "Unable to generate a dispatcher prompt right now." },
      { status: 500 },
    );
  }
}

function getClientIdentifier(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip");
  const cloudflareIp = request.headers.get("cf-connecting-ip");

  return forwardedFor || realIp || cloudflareIp || "anonymous";
}

function normalizePrompt(prompt: unknown) {
  if (typeof prompt !== "string") {
    return "";
  }

  return prompt.trim().slice(0, 4000);
}

function serializeClarifications(clarifications: unknown) {
  if (!clarifications) {
    return "None provided.";
  }

  if (typeof clarifications === "string") {
    return clarifications.trim().slice(0, 2000) || "None provided.";
  }

  try {
    return JSON.stringify(clarifications).slice(0, 2000);
  } catch {
    return "None provided.";
  }
}

async function getSearchSnippets(userPrompt: string) {
  const searchQuery = `top open source AND paid AI models for ${userPrompt} April 2026`;
  const results = await search(searchQuery, {
    safeSearch: SafeSearchType.STRICT,
    marketRegion: "US",
    region: "us-en",
  });

  return results.results
    .slice(0, 3)
    .map((result) => stripHtml(result.rawDescription || result.description))
    .filter(Boolean);
}

async function createDispatcherCompletion(
  userPrompt: string,
  clarifications: unknown,
  snippets: string[],
) {
  const userContent = `User task:
${userPrompt}

Guided mode clarifications:
${serializeClarifications(clarifications)}

Live search body snippets from the top 3 DuckDuckGo results:
${snippets.length ? snippets.map((snippet, index) => `${index + 1}. ${snippet}`).join("\n") : "No useful snippets found."}`;

  try {
    return await callGroq(MODEL_CHAIN[0], userContent);
  } catch (error) {
    if (!isRateLimitError(error)) {
      throw error;
    }

    let lastError: unknown = error;

    for (const model of MODEL_CHAIN.slice(1)) {
      try {
        return await callGroq(model, userContent);
      } catch (fallbackError) {
        lastError = fallbackError;

        if (!isRateLimitError(fallbackError)) {
          throw fallbackError;
        }
      }
    }

    throw lastError;
  }
}

async function callGroq(model: (typeof MODEL_CHAIN)[number], userContent: string) {
  const completion = await groq.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: userContent,
      },
    ],
    temperature: 0.3,
    max_completion_tokens: 1800,
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message.content;

  if (!content) {
    throw new Error("Groq returned an empty completion.");
  }

  return content;
}

function isRateLimitError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 429
  );
}

function parseDispatcherResponse(content: string): DispatcherResponse {
  const parsed = JSON.parse(content) as unknown;

  if (!isDispatcherResponse(parsed)) {
    throw new Error("Groq returned JSON that does not match the dispatcher schema.");
  }

  return parsed;
}

function isDispatcherResponse(value: unknown): value is DispatcherResponse {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.optimized_prompt !== "string" || !value.optimized_prompt.trim()) {
    return false;
  }

  const recommendations = value.recommendations;

  if (!isRecord(recommendations)) {
    return false;
  }

  return ["open_source", "freemium", "premium"].every((key) =>
    isRecommendation(recommendations[key]),
  );
}

function isRecommendation(value: unknown): value is Recommendation {
  return (
    isRecord(value) &&
    typeof value.model_name === "string" &&
    Boolean(value.model_name.trim()) &&
    typeof value.platform_url === "string" &&
    isValidHttpUrl(value.platform_url)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
}
