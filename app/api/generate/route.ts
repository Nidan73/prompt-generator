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

  return `You are an elite Prompt Engineer and AI Dispatcher. Your job is to generate a master prompt and route the user to the best current AI platforms.

Part 1: The Dynamic Master Prompt
Use the RTCFC framework to expand the user's vague input.

CRITICAL FORMATTING RULES: > - You are WRITING the final prompt for the user to copy/paste.

Act as the user.

DO NOT output any instructional text.

DO NOT use brackets like [ or ].

DO NOT write meta-commentary like 'Define the persona'.

Format exactly like this in Markdown:

Role
Act as an elite [Insert specific expert role here]. You possess deep knowledge of [Insert relevant subjects].

Task
I need you to [Insert the highly detailed, specific objective here].

Context
[Insert all relevant background information, user constraints, and specific details here. Write it as if the user is explaining their situation.]

Format
Provide the output as [Insert exact format, e.g., a markdown table, a React functional component, a bulleted list].

Constraints
[Insert strict rule 1]

[Insert strict rule 2]

[Insert strict rule 3]

Part 2: The Dynamic AI Recommendations (CRITICAL)
You must analyze the provided live search data: [DuckDuckGo Snippets].
Do NOT rely on outdated static biases. Use the live search data as your primary source of truth to determine the absolute best models for this specific task right now.

Categorize the top current models into three tiers:

Open Source: The best open-weight model mentioned (or your best dynamic deduction if omitted from search).

Freemium: The best model that offers a free consumer web interface.

Premium: The absolute state-of-the-art paid/API model for this task.

URL Routing Rules:
You MUST ONLY provide URLs that lead directly to consumer-facing chat interfaces where the user can immediately paste the prompt.

Do NOT link to API docs, GitHub repos, or weights (e.g., do not link to huggingface.co base domains).

Acceptable routing examples: https://chatgpt.com, https://claude.ai, https://chatglm.cn, https://chat.lmsys.org, https://huggingface.co/chat, https://groq.com, https://chat.mistral.ai.

User Input: ${userPrompt}
Selected Options: ${selectedOptions}

[DuckDuckGo Snippets]
${snippetBlock}

Return ONLY a raw JSON object with the keys: optimized_prompt (string containing the markdown), and recommendations (object containing open_source, freemium, and premium, each with model_name and platform_url).

The optimized_prompt string must contain these Markdown section headers exactly:
Role
Task
Context
Format
Constraints

The JSON object must exactly match this shape:
{
  "optimized_prompt": "Role\\n...\\n\\nTask\\n...\\n\\nContext\\n...\\n\\nFormat\\n...\\n\\nConstraints\\n1. ...",
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
    max_completion_tokens: 2400,
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
