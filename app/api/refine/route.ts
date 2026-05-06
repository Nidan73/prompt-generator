import { NextRequest, NextResponse } from "next/server";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { RefineRequestSchema, parseRequestBody } from "@/lib/api-schemas";

export const runtime = "edge";

// Multi-provider fallback chain for lightweight prompt refinement.
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
    model: "llama-3.3-70b-versatile",
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
    model: "google/gemini-2.5-flash:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
];

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "1 m"),
  analytics: true,
  prefix: "@prompt-generator/refine",
});

const SYSTEM_PROMPT = `You are an expert prompt editor. The user has an existing AI prompt and they want a specific modification applied to it.

CRITICAL INSTRUCTION: ADAPTIVE FRAMEWORK PRESERVATION
You must analyze the structural format of the user's existing prompt and STRICTLY preserve it. 
- If it uses XML tags (e.g. <context>, <task>), KEEP the XML tags.
- If it is a comma-separated list of visual tags (e.g. for Image/Video generation), KEEP it as a continuous comma-separated paragraph.
- If it uses the RTCFC framework (Role, Task, Context, Format, Constraints headers), KEEP those exact headers.
- If it uses AIDA or PAS headers, KEEP those exact headers.

Rules:
- Apply the user's modification precisely. Do NOT rewrite sections they didn't ask to change.
- Preserve the exact structural framework and layout of the original prompt.
- Return ONLY the modified prompt text. No JSON. No markdown code blocks. No commentary.
- If the modification is unclear, make your best interpretation and apply it.`;

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

  const parsed = await parseRequestBody(request, RefineRequestSchema);
  if (parsed.error) return parsed.error;

  const { currentPrompt, instruction } = parsed.data;

  try {
    const userContent = `EXISTING PROMPT:\n${currentPrompt.slice(0, 6000)}\n\nMODIFICATION REQUESTED:\n${instruction.slice(0, 500)}`;
    const refined = await callLLMWithFallback(SYSTEM_PROMPT, userContent, PROVIDER_CHAIN);

    // Strip any accidental markdown wrapping
    const cleanRefined = refined
      .replace(/^```(?:text|markdown)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();

    return NextResponse.json(
      { refined_prompt: cleanRefined },
      {
        headers: {
          "X-RateLimit-Limit": String(limit.limit),
          "X-RateLimit-Remaining": String(limit.remaining),
          "X-RateLimit-Reset": String(limit.reset),
        },
      },
    );
  } catch (error) {
    console.error("Prompt refinement failed", error);
    return NextResponse.json({ error: "Unable to refine the prompt right now." }, { status: 500 });
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getClientIdentifier(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip");
  const cloudflareIp = request.headers.get("cf-connecting-ip");
  return forwardedFor || realIp || cloudflareIp || "anonymous";
}

async function callLLMWithFallback(
  systemPrompt: string,
  userContent: string,
  chain: ProviderConfig[],
): Promise<string> {
  let lastError: unknown = new Error("No API keys configured or all providers failed.");

  for (const provider of chain) {
    if (!provider.apiKey) continue;

    try {
      const response = await fetch(provider.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          temperature: 0.25,
          max_completion_tokens: 3200,
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
      console.warn(`Refine Fallback triggered: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw lastError;
}
