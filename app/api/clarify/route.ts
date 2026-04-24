import { NextRequest, NextResponse } from "next/server";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const runtime = "edge";

type ClarifyRequest = {
  prompt?: unknown;
};

export type ClarifyingQuestion = {
  id: string;
  question: string;
  options: string[];
};

// Multi-provider fallback chain for high-speed clarifying questions.
type ProviderConfig = {
  name: string;
  url: string;
  model: string;
  apiKey: string | undefined;
};

const PROVIDER_CHAIN: ProviderConfig[] = [
  {
    name: "Groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.1-8b-instant",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "Gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "meta-llama/llama-3.1-8b-instruct:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  }
];

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(3, "1 m"),
  analytics: true,
  prefix: "@prompt-dispatcher/clarify",
});

const SYSTEM_PROMPT = `You are an expert Prompt Engineer. The user has provided a vague idea. Your job is to generate exactly 3 multiple-choice questions that will help extract the missing context needed to write a world-class AI prompt.

CRITICAL RULES:
1. The first question MUST ask which expert role/persona the AI should assume.
2. Generate the role/persona options dynamically from the user's idea. Do NOT use a generic hardcoded role list.
3. Do NOT ask what the user's acronyms or words mean.
4. The remaining questions must define Context, Format, or Constraints.
5. Examples of good questions: 'What tone should the AI use?', 'What is your current skill level?', 'How long should the output be?', 'Who is the target audience for this output?'
6. Keep questions and options extremely short and punchy.

Output Format: You MUST return a valid JSON object containing a single key called "questions". This key must hold an array of exactly 3 objects. Do NOT use markdown formatting.
Schema: { "questions": [ { "question": "...", "options": ["...", "...", "..."] } ] }`;

export async function POST(request: NextRequest) {
  const identifier = getClientIdentifier(request);
  const limit = await ratelimit.limit(identifier);

  if (!limit.success) {
    const retryAfter = Math.max(
      1,
      Math.ceil((limit.reset - Date.now()) / 1000),
    );

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

  let body: ClarifyRequest;

  try {
    body = (await request.json()) as ClarifyRequest;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const userPrompt = normalizePrompt(body.prompt);

  if (!userPrompt) {
    return NextResponse.json(
      { error: "A non-empty prompt is required." },
      { status: 400 },
    );
  }

  try {
    const userContent = `Create guided-mode clarification questions for this rough prompt:\n${userPrompt}`;
    let content = await callLLMWithFallback(SYSTEM_PROMPT, userContent, PROVIDER_CHAIN);

    // Aggressive regex to strip any markdown hallucinations before parsing
    content = content
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const questions = parseQuestions(content);

    return NextResponse.json(questions, {
      headers: {
        "X-RateLimit-Limit": String(limit.limit),
        "X-RateLimit-Remaining": String(limit.remaining),
        "X-RateLimit-Reset": String(limit.reset),
      },
    });
  } catch (error) {
    console.error("Clarification failed", error);

    return NextResponse.json(
      { error: "Unable to generate clarification questions right now." },
      { status: 500 },
    );
  }
}

function getClientIdentifier(request: NextRequest) {
  const forwardedFor = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const realIp = request.headers.get("x-real-ip");
  const cloudflareIp = request.headers.get("cf-connecting-ip");

  return forwardedFor || realIp || cloudflareIp || "anonymous";
}

async function callLLMWithFallback(systemPrompt: string, userContent: string, chain: ProviderConfig[]): Promise<string> {
  let lastError: unknown = new Error("No API keys configured or all providers failed.");

  for (const provider of chain) {
    if (!provider.apiKey) continue;

    try {
      const response = await fetch(provider.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          temperature: 0.35,
          max_completion_tokens: 700,
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          throw new Error(`Provider ${provider.name} failed with status ${response.status}`);
        }
        const errorText = await response.text();
        throw new Error(`Fatal error from ${provider.name}: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) throw new Error(`${provider.name} returned an empty completion.`);
      return content;
      
    } catch (error) {
      lastError = error;
      console.warn(`Clarify Fallback triggered: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw lastError;
}

function normalizePrompt(prompt: unknown) {
  if (typeof prompt !== "string") {
    return "";
  }

  return prompt.trim().slice(0, 2000);
}

function parseQuestions(content: string): ClarifyingQuestion[] {
  const parsed = JSON.parse(content) as unknown;

  // Handle both `{ questions: [...] }` and `[...]` in case the LLM ignores JSON mode shape.
  const questions = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.questions)
      ? parsed.questions
      : [];

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("Groq returned an empty or invalid array.");
  }

  const normalized = questions
    .slice(0, 3)
    .map(normalizeQuestion)
    .filter((question): question is ClarifyingQuestion => Boolean(question));

  if (normalized.length === 0) {
    throw new Error("Could not parse any valid questions from the response.");
  }

  return normalized;
}

function normalizeQuestion(value: unknown): ClarifyingQuestion | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const question =
    typeof value.question === "string" ? value.question.trim() : "";
  let options = Array.isArray(value.options)
    ? value.options
        .filter((option): option is string => typeof option === "string")
        .map((option) => option.trim())
        .filter(Boolean)
    : [];

  if (!question || options.length < 2) {
    return null;
  }

  options = options.slice(0, 4);

  return {
    id: (id || question)
      .replace(/[^a-z0-9_]/gi, "_")
      .toLowerCase()
      .slice(0, 40),
    question,
    options,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
