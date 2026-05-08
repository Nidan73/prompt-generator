import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { ClarifyRequestSchema, parseRequestBody } from "@/lib/api-schemas";
import { type ProviderConfig, CLARIFY_POOL, getRotatedChain } from "@/lib/provider-pool";
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

const SYSTEM_PROMPT = `You are an expert Prompt Engineer. The user has provided a vague idea. Your job is to generate exactly 3 multiple-choice questions that will help extract the missing context needed to write a world-class AI prompt.

Rule: Identify the user's implicit domain (Image, Code, Copywriting, Video, Data, etc.) and generate 3 questions targeting its most critical missing dimensions.
Anchor Examples:
- If Image: Ask about Art Style, Mood, Composition.
- If Code: Ask about Tech Stack, Core Goal, Output Detail.
- If Copywriting: Ask about Target Audience, Primary CTA, Tone of Voice.
- If Video: Ask about Camera Movement, Pacing, Temporal Changes.

GENERAL RULES:
1. Deduce the 3 dimensions dynamically based on the user's specific idea. Do NOT just copy the examples above if the domain is different (e.g., for Meta-Prompting ask about Agent Role and Personality).
2. Generate ALL options dynamically. Do NOT use generic hardcoded lists.
3. Keep questions and options extremely short and punchy.`;

const questionSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
    })
  ).max(3),
});

export async function POST(request: NextRequest) {
  const identifier = getClientIdentifier(request);
  const limit = await ratelimit.limit(identifier);

  if (!limit.success) {
    const retryAfter = Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait before trying again.", retryAfter },
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

  const parsed = await parseRequestBody(request, ClarifyRequestSchema);
  if (parsed.error) return parsed.error;

  const { prompt: userPrompt } = parsed.data;

  try {
    const userContent = `Create guided-mode clarification questions for this rough prompt:\n${userPrompt}`;
    const chain = getRotatedChain("clarify", CLARIFY_POOL);
    let lastError: unknown = new Error("No API keys configured or all providers failed.");

    for (const provider of chain) {
      try {
        const result = await generateObject({
          model: provider.sdkModel,
          system: SYSTEM_PROMPT,
          prompt: userContent,
          schema: questionSchema,
          maxRetries: 0,
        });

        // AI SDK gives us a strongly typed object back automatically
        const questions: ClarifyingQuestion[] = result.object.questions.map(q => ({
          id: crypto.randomUUID(),
          question: q.question,
          options: q.options.slice(0, 4) // cap at 4 options
        }));

        return NextResponse.json(questions, {
          headers: {
            "X-RateLimit-Limit": String(limit.limit),
            "X-RateLimit-Remaining": String(limit.remaining),
            "X-RateLimit-Reset": String(limit.reset),
            "X-Provider-Name": provider.name,
          },
        });
      } catch (error) {
        lastError = error;
        console.warn(`Fallback triggered for ${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw lastError;
  } catch (error) {
    console.error("Clarification failed", error);
    return NextResponse.json({ error: "Unable to generate clarification questions right now." }, { status: 500 });
  }
}

function getClientIdentifier(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip");
  const cloudflareIp = request.headers.get("cf-connecting-ip");
  return forwardedFor || realIp || cloudflareIp || "anonymous";
}
