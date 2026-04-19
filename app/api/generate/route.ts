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
  const results = await withTimeout(
    search(searchQuery, {
      safeSearch: SafeSearchType.STRICT,
      marketRegion: "US",
      region: "us-en",
    }),
    1000,
  ).catch(() => null);

  if (!results) {
    return [];
  }

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
  const selectedOptions = serializeClarifications(clarifications);
  const systemPrompt = buildSystemPrompt(userPrompt, selectedOptions, snippets);
  const userContent = "Return the strict JSON response now.";

  try {
    return await callGroq(MODEL_CHAIN[0], systemPrompt, userContent);
  } catch (error) {
    if (!isRateLimitError(error)) {
      throw error;
    }

    let lastError: unknown = error;

    for (const model of MODEL_CHAIN.slice(1)) {
      try {
        return await callGroq(model, systemPrompt, userContent);
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

function buildSystemPrompt(userPrompt: string, selectedOptions: string, snippets: string[]) {
  const snippetBlock = snippets.length
    ? snippets.map((snippet, index) => `${index + 1}. ${snippet}`).join("\n")
    : "No useful snippets found. Use internal training data conservatively.";

  return `You are an elite Prompt Engineer. Your objective is to take the user's vague input and transform it into a highly detailed, professional prompt using the RTCFC framework.

Framework Requirements:

Role: Define a specific, expert persona.

Task: Clearly state the exact objective.

Context: Inject all relevant background information and user constraints.

Format: Specify exactly how the output should look (e.g., Markdown, code blocks, specific structure).

Constraints: List strict rules the AI must follow (e.g., 'Do not use filler language', 'Use React functional components').

User Input: ${userPrompt}
Selected Options (if any): ${selectedOptions}

You MUST return this formatted as a single, highly detailed prompt string inside your JSON output.

Based on the live search data [DuckDuckGo Snippets], recommend the best AI platforms.
CRITICAL RULE FOR URLs: You MUST ONLY provide URLs that lead directly to consumer-facing chat interfaces where the user can immediately paste a prompt.

Do NOT link to API documentation, GitHub repos, or company homepages.

Acceptable examples: https://chatgpt.com, https://claude.ai, https://chatglm.cn, https://chat.lmsys.org, https://huggingface.co/chat, https://groq.com.

If an open-source model is recommended (e.g., Llama 3), link to a free interface that hosts it (like Groq or HuggingChat), NOT the model weights.

[DuckDuckGo Snippets]
${snippetBlock}

Return one valid JSON object only. Do not include markdown fences, commentary, or extra keys.

The JSON object must exactly match this shape:
{
  "optimized_prompt": "A single, detailed RTCFC prompt string",
  "recommendations": {
    "open_source": {
      "model_name": "string",
      "platform_url": "consumer chat URL"
    },
    "freemium": {
      "model_name": "string",
      "platform_url": "consumer chat URL"
    },
    "premium": {
      "model_name": "string",
      "platform_url": "consumer chat URL"
    }
  }
}`;
}

async function callGroq(
  model: (typeof MODEL_CHAIN)[number],
  systemPrompt: string,
  userContent: string,
) {
  const completion = await groq.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: systemPrompt,
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

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return false;
    }

    return isConsumerChatUrl(url);
  } catch {
    return false;
  }
}

function isConsumerChatUrl(url: URL) {
  const hostname = url.hostname.replace(/^www\./, "");
  const path = url.pathname.toLowerCase();
  const href = url.href.toLowerCase();

  if (
    hostname === "github.com" ||
    hostname.endsWith(".github.com") ||
    href.includes("/docs") ||
    href.includes("/documentation") ||
    href.includes("/api") ||
    href.includes("/reference") ||
    href.includes("/models/") ||
    href.includes("/papers/")
  ) {
    return false;
  }

  if (hostname === "huggingface.co") {
    return path === "/chat" || path.startsWith("/chat/");
  }

  return true;
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Search timed out.")), timeoutMs);
    }),
  ]);
}
