import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse, type NextRequest } from "next/server";
import { getRotatedChain, GENERATE_POOL } from "@/lib/provider-pool";
import { GenerateSchemaObject } from "@/lib/api-schemas";
import { streamObject } from "ai";

export const maxDuration = 60;
export const runtime = "edge";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

const generateRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(50, "1 d"),
  analytics: true,
  prefix: "prompt-gen-api",
});

// ─── Constants & Prompts ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the core logic engine of "Bhai Thik Kor" — an elite prompt optimization router.
Your objective is to read the user's rough prompt and their selected clarifications, detect their underlying intent, and transform it into a professional, highly structured prompt.

[STRICT DIRECTIVES]
1. DO NOT return markdown blocks (like \`\`\`json). Just the raw JSON.
2. DO NOT output your internal thought process or reasoning before the JSON.
3. You must rewrite the user's prompt using the best structural framework.

[OUTPUT SCHEMA]
Return a JSON object conforming to the provided schema.

PART 1 — PROMPT OPTIMIZATION (The Switchboard)
Detect the user's intent and format the 'optimized_prompt' using standard industry frameworks.
Examples: 
- Code/Scripting -> Use 'Context, Objective, Constraints, Output Format'
- Creative Writing -> Use 'Premise, Tone/Style, Key Elements, Format'
- Data Analysis -> Use 'Data Source, Objective, Analysis Steps, Output Format'
- Marketing -> Use 'AIDA' or 'PAS'
- General (Fallback) -> Use 'Role, Task, Context, Format, Constraints'

PART 2 — MODEL ROUTING (Ranking-Based)
Recommend the best AI model for this specific task across three tiers based on recent LLM capabilities (e.g. Gemini 3.1 Pro, Claude Opus 4.6, GPT-5.5, Llama 4 Scout, DeepSeek V4).
`;

// ─── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIdentifier(request);
    const { success, limit, remaining, reset } = await generateRateLimit.limit(ip);

    if (!success) {
      return NextResponse.json(
        { error: "Daily prompt generation limit reached. Please try again tomorrow." },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(limit),
            "X-RateLimit-Remaining": String(remaining),
            "X-RateLimit-Reset": String(reset),
          },
        },
      );
    }

    const body = await request.json();
    const userPrompt = body.prompt || "";
    const clarifications = Array.isArray(body.clarifications) ? body.clarifications : [];

    if (!userPrompt.trim()) {
      return NextResponse.json({ error: "Prompt cannot be empty" }, { status: 400 });
    }

    let userContent = `ROUGH PROMPT:\n${userPrompt.slice(0, 2000)}\n\n`;
    if (clarifications.length > 0) {
      userContent += `USER CLARIFICATIONS:\n`;
      clarifications.forEach((c: any) => {
        userContent += `Q: ${c.question}\nA: ${c.answer}\n\n`;
      });
    }

    const chain = getRotatedChain("generate", GENERATE_POOL);
    let lastError: unknown = new Error("No API keys configured or all providers failed.");

    // Load Balancer Loop
    for (const provider of chain) {
      try {
        const result = await streamObject({
          model: provider.sdkModel,
          system: SYSTEM_PROMPT,
          prompt: userContent,
          schema: GenerateSchemaObject,
          maxRetries: 0, // Disable internal retries so we can fail-fast to the next provider
        });

        // If the promise resolves, the provider accepted the request and streaming begins.
        // Return the TextStreamResponse (which streams JSON patches directly to the client).
        return result.toTextStreamResponse({
          headers: {
            "X-RateLimit-Limit": String(limit),
            "X-RateLimit-Remaining": String(remaining),
            "X-RateLimit-Reset": String(reset),
            "X-Provider-Name": provider.name,
          }
        });
      } catch (error) {
        lastError = error;
        console.warn(`Fallback triggered for ${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // If we exhaust the pool
    throw lastError;

  } catch (error) {
    console.error("Prompt generation failed", error);
    return NextResponse.json({ error: "Unable to generate a prompt right now." }, { status: 500 });
  }
}

function getClientIdentifier(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip");
  const cloudflareIp = request.headers.get("cf-connecting-ip");
  return forwardedFor || realIp || cloudflareIp || "anonymous";
}
