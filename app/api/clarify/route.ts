import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";

type ClarifyRequest = {
  prompt?: unknown;
};

export type ClarifyingQuestion = {
  id: string;
  question: string;
  options: string[];
};

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(3, "1 m"),
  analytics: true,
  prefix: "@prompt-dispatcher/clarify",
});

const SYSTEM_PROMPT = `You create lightweight guided-mode clarification questions for an AI prompt dispatcher.

Return one valid JSON object only. Do not include markdown, prose, comments, code fences, or extra keys.

The JSON object must exactly match this shape:
{
  "questions": [
    {
      "id": "short_snake_case",
      "question": "A concise multiple-choice question",
      "options": ["option one", "option two", "option three"]
    }
  ]
}

Rules:
- Return exactly 3 questions.
- Each question must have exactly 3 options.
- Options should require zero typing from the user.
- Questions must clarify outcome, audience/context, and constraints or format.
- Keep every question under 110 characters.
- Keep every option under 70 characters.`;

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

  let body: ClarifyRequest;

  try {
    body = (await request.json()) as ClarifyRequest;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const userPrompt = normalizePrompt(body.prompt);

  if (!userPrompt) {
    return NextResponse.json({ error: "A non-empty prompt is required." }, { status: 400 });
  }

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: `Create guided-mode clarification questions for this rough prompt:\n${userPrompt}`,
        },
      ],
      temperature: 0.35,
      max_completion_tokens: 700,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message.content;

    if (!content) {
      throw new Error("Groq returned an empty clarification response.");
    }

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
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip");
  const cloudflareIp = request.headers.get("cf-connecting-ip");

  return forwardedFor || realIp || cloudflareIp || "anonymous";
}

function normalizePrompt(prompt: unknown) {
  if (typeof prompt !== "string") {
    return "";
  }

  return prompt.trim().slice(0, 2000);
}

function parseQuestions(content: string): ClarifyingQuestion[] {
  const parsed = JSON.parse(content) as unknown;
  const questions = isRecord(parsed) ? parsed.questions : parsed;

  if (!Array.isArray(questions) || questions.length !== 3) {
    throw new Error("Groq returned an invalid clarification schema.");
  }

  const normalized = questions.map(normalizeQuestion);

  if (normalized.some((question) => !question)) {
    throw new Error("Groq returned malformed clarification questions.");
  }

  return normalized as ClarifyingQuestion[];
}

function normalizeQuestion(value: unknown): ClarifyingQuestion | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const question = typeof value.question === "string" ? value.question.trim() : "";
  const options = Array.isArray(value.options)
    ? value.options.filter((option): option is string => typeof option === "string")
    : [];

  if (!id || !question || options.length !== 3) {
    return null;
  }

  const cleanedOptions = options.map((option) => option.trim()).filter(Boolean);

  if (cleanedOptions.length !== 3) {
    return null;
  }

  return {
    id: id.replace(/[^a-z0-9_]/gi, "_").toLowerCase().slice(0, 40),
    question,
    options: cleanedOptions,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
