import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { RefineRequestSchema, parseRequestBody } from "@/lib/api-schemas";
import { type ProviderConfig, REFINE_POOL, getRotatedChain } from "@/lib/provider-pool";
import { streamText } from "ai";

export const runtime = "edge";

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
  const userContent = `EXISTING PROMPT:\n${currentPrompt.slice(0, 2000)}\n\nMODIFICATION REQUESTED:\n${instruction.slice(0, 500)}`;

  try {
    const chain = getRotatedChain("refine", REFINE_POOL);
    let lastError: unknown = new Error("No API keys configured or all providers failed.");

    for (const provider of chain) {
      try {
        const result = await streamText({
          model: provider.sdkModel,
          system: SYSTEM_PROMPT,
          prompt: userContent,
          maxRetries: 0, // Disable internal retries to fail-fast on 429s
        });

        return result.toTextStreamResponse({
          headers: {
            "X-RateLimit-Limit": String(limit.limit),
            "X-RateLimit-Remaining": String(limit.remaining),
            "X-RateLimit-Reset": String(limit.reset),
            "X-Provider-Name": provider.name,
          }
        });
      } catch (error) {
        lastError = error;
        console.warn(`Fallback triggered for ${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw lastError;
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
