import { NextRequest, NextResponse } from "next/server";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { buildRegistryBlock, resolveRecommendations, getLiveModelLandscape } from "@/lib/ai-catalog";
import { GenerateRequestSchema, parseRequestBody } from "@/lib/api-schemas";

export const runtime = "edge";

type DispatcherResponse = {
  optimized_prompt: string;
  recommendations: {
    open_source: { model_name: string; platform_url: string; reasoning: string };
    freemium: { model_name: string; platform_url: string; reasoning: string };
    premium: { model_name: string; platform_url: string; reasoning: string };
  };
};

// Multi-provider fallback chain. System tries these in order.
// If a key is missing or a 429/500 occurs, it automatically falls back to the next provider.
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
  }
];

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(3, "1 m"),
  analytics: true,
  prefix: "@prompt-generator/generate",
});

const REGISTRY_BLOCK = buildRegistryBlock();

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

  const parsed = await parseRequestBody(request, GenerateRequestSchema);
  if (parsed.error) return parsed.error;

  const { prompt: userPrompt, clarifications } = parsed.data;

  try {
    const liveLandscape = await getLiveModelLandscape();
    const llmContent = await createDispatcherCompletion(userPrompt, clarifications, liveLandscape);
    const parsed = parseAndResolve(llmContent);

    return NextResponse.json(parsed, {
      headers: {
        "X-RateLimit-Limit": String(limit.limit),
        "X-RateLimit-Remaining": String(limit.remaining),
        "X-RateLimit-Reset": String(limit.reset),
      },
    });
  } catch (error) {
    console.error("Prompt generation failed", error);
    return NextResponse.json({ error: "Unable to generate a prompt right now." }, { status: 500 });
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getClientIdentifier(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip");
  const cloudflareIp = request.headers.get("cf-connecting-ip");
  return forwardedFor || realIp || cloudflareIp || "anonymous";
}

function serializeClarifications(clarifications: Array<{ question: string; answer: string }>) {
  if (clarifications.length === 0) return "None provided.";
  return JSON.stringify(clarifications).slice(0, 2000);
}

// ─── LLM Orchestration ────────────────────────────────────────────────────────

async function createDispatcherCompletion(userPrompt: string, clarifications: Array<{ question: string; answer: string }>, liveLandscape: string) {
  const selectedOptions = serializeClarifications(clarifications);
  const systemPrompt = buildSystemPrompt(userPrompt, selectedOptions, liveLandscape);
  const userContent = "Return the strict JSON response now.";

  return await callLLMWithFallback(systemPrompt, userContent, PROVIDER_CHAIN);
}

function buildSystemPrompt(userPrompt: string, selectedOptions: string, liveLandscape: string) {
  return `You are an elite Prompt Engineer and an expert AI Model Analyst. You follow AI benchmarks, leaderboards (LMSYS Chatbot Arena ELO, LiveBench, MMLU, HumanEval, MATH, GPQA), and industry developments closely. You have no loyalty to any company or model.

Your job has two parts.

PART 1 — MASTER PROMPT
First, determine the task type: is this a TEXT/LOGIC task or an IMAGE GENERATION task?

Signals of an image task: the user mentions "image", "picture", "photo", "illustration", "poster", "logo", "wallpaper", "generate an image", "draw", "design", "visual", "render", "graphic", or similar visual creation words.

═══════════════════════════════════════
IF TEXT/LOGIC PROMPT:
═══════════════════════════════════════
Expand the user's rough input into a structured, expert-grade prompt using the RTCFC framework.
Rules:
- You are writing the final prompt the user will copy/paste. Act as the user.
- Do NOT add meta-commentary, preamble, or instructions about the prompt itself.
- Use these exact section headers:

Role
Act as an elite SPECIFIC_EXPERT_ROLE. You possess deep knowledge of RELEVANT_SUBJECTS.

Task
I need you to HIGHLY_DETAILED_OBJECTIVE.

Context
RELEVANT_BACKGROUND_AND_CONSTRAINTS.

Format
Provide the output as EXACT_FORMAT_REQUIREMENT.

Constraints
1. STRICT_RULE_1
2. STRICT_RULE_2
3. STRICT_RULE_3
4. Ask me any clarifying questions if you need more context to understand my intent better.

- Always append the above exact sentence (about asking clarifying questions) as the final constraint.

═══════════════════════════════════════
IF IMAGE GENERATION PROMPT:
═══════════════════════════════════════
Your goal is to transform the user's vague visual idea into an EXTREMELY detailed, rich image prompt. The user will paste this prompt directly into an AI image generator (Gemini, ChatGPT, Grok, etc.). A lazy, short prompt is a FAILURE.

You MUST cover ALL of the following 12 dimensions. Invent specific details that elevate the image:

1. SUBJECT — What is the main subject? Describe it with extreme specificity (species, age, clothing fabric, material, texture, expression, posture).
2. ACTION/POSE — What is the subject doing? Static pose, mid-motion, interaction with environment?
3. SETTING/ENVIRONMENT — Where is this? Interior/exterior? Time period? Weather? Describe the ground, walls, sky, surrounding objects.
4. LIGHTING — What kind of light? Golden hour, neon glow, rim lighting, volumetric fog, studio three-point, bioluminescent? Specify direction and intensity.
5. COLOR PALETTE — Name 3-5 specific colors or a palette mood (e.g., "muted earth tones with pops of burnt sienna and teal").
6. ART STYLE/MEDIUM — Photorealistic? Oil painting? Watercolor? Anime cel-shaded? Cyberpunk concept art? 3D render? Specify the medium clearly.
7. CAMERA/COMPOSITION — Wide shot, close-up, overhead, Dutch angle, shallow depth of field, 85mm portrait lens, rule of thirds?
8. MOOD/ATMOSPHERE — Serene, ominous, whimsical, melancholic, epic, intimate? What emotion should a viewer feel?
9. TEXTURE/DETAIL LEVEL — Hyper-detailed skin pores? Smooth vector? Rough brush strokes? Grain? Specify the surface quality.
10. REFERENCE ARTISTS/AESTHETICS — "In the style of Studio Ghibli", "reminiscent of Greg Rutkowski", "Wes Anderson color grading", etc. Pick 1-2 relevant references.
11. TECHNICAL QUALITY — 8K, ultra HD, ray tracing, octane render, photographic quality, etc.
12. NEGATIVE SPACE / WHAT TO AVOID — "No text", "no watermarks", "avoid cluttered backgrounds", etc.

Output format:
- Write it as ONE continuous, richly detailed paragraph. No headers, no bullet points, no numbering.
- Separate visual descriptors with commas.
- End with technical quality tags and negative instructions.
- The prompt MUST be at least 80 words. Anything shorter is unacceptable.

Example of EXCELLENT output:
"A weathered elderly Japanese fisherman mending a traditional fishing net on a wooden dock at dawn, surrounded by calm harbor water reflecting soft pink and gold sky, fishing boats anchored in the background with mist rolling off distant mountains, warm golden hour light casting long shadows with gentle rim lighting on his hands, muted palette of slate blue, warm amber, faded indigo, and soft cream, photorealistic digital painting inspired by the atmospheric realism of Gregory Crewdson and the warmth of Hayao Miyazaki's environmental storytelling, shot from a low three-quarter angle with shallow depth of field focusing on the fisherman's weathered hands, serene and contemplative mood evoking quiet dignity and routine, hyper-detailed textures on the rope fibers and wood grain, 8K resolution, cinematic composition, no text, no watermarks, no modern objects"

PART 2 — MODEL ROUTING (Ranking-Based)
You must recommend the best AI model for this specific task across three tiers.
For image generation tasks, prioritize platforms with BUILT-IN image generation (ChatGPT with DALL-E, Gemini with Imagen, Grok with Aurora). Do NOT route to standalone image tools.

Step 1 — Task analysis.
Identify what this task demands: long-context understanding, code generation, creative writing, mathematical reasoning, factual research, image generation, image understanding, instruction-following, speed, etc.

Step 2 — Model ranking.
Use the model landscape reference below to know which models currently exist. Then determine which of those current models is best for each cognitive demand.

${liveLandscape}

Step 3 — Platform selection.
Match your top-ranked models to the platforms below where users can access them. Pick by platform_id.

Available platforms (use these IDs only):
${REGISTRY_BLOCK}

Step 4 — Output your picks.
For each tier, provide:
- platform_id: the ID from the list above
- model_name: the SPECIFIC current model name and version from the landscape above (e.g. "GPT-5.5", "Claude Opus 4.7", "DeepSeek-R1", "Llama 4 Maverick")
- reasoning: 1-2 sentences explaining WHY this model is the best choice for this specific task. Reference specific capabilities or benchmark strengths.

Tier definitions:
- open_source: The best open-weight model (publicly released weights) accessible via a free platform
- freemium: The best model accessible via a free-tier consumer chat interface
- premium: The absolute best model regardless of cost — the state-of-the-art pick

Rules:
- Rank by task-fit. A specialized model that excels at this task beats a famous all-rounder.
- You may recommend the same model for multiple tiers ONLY if the platform supports both tiers.
- CRITICAL: You can ONLY assign a platform to a tier if that tier is listed in the platform's "tiers" array! (e.g. Do not pick 'groq' for 'premium').
- ONLY recommend model versions that appear in the landscape above. Older versions are deprecated.
- ONLY use platform IDs from the list above. Do NOT invent IDs.

User Input: ${userPrompt}
Selected Options: ${selectedOptions}

Return ONLY a raw JSON object. No markdown. No commentary.

{
  "optimized_prompt": "Role\\n...\\n\\nTask\\n...\\n\\nContext\\n...\\n\\nFormat\\n...\\n\\nConstraints\\n1. ...",
  "routing": {
    "open_source": { "platform_id": "id", "model_name": "specific model name", "reasoning": "why this model" },
    "freemium": { "platform_id": "id", "model_name": "specific model name", "reasoning": "why this model" },
    "premium": { "platform_id": "id", "model_name": "specific model name", "reasoning": "why this model" }
  }
}`;
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
          temperature: 0.3,
          max_completion_tokens: 3200,
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        // Fallback on Rate Limits (429) or Server Errors (5xx)
        if (response.status === 429 || response.status >= 500) {
          throw new Error(`Provider ${provider.name} failed with status ${response.status}`);
        }
        // Throw fatal error for 400 Bad Request, 401 Unauthorized, etc.
        const errorText = await response.text();
        throw new Error(`Fatal error from ${provider.name}: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) throw new Error(`${provider.name} returned an empty completion.`);
      return content;
      
    } catch (error) {
      lastError = error;
      // If it's a fatal client error, don't keep retrying with other models from the same code if they'd fail identically
      // But since we are switching providers entirely, retrying is safe.
      console.warn(`Fallback triggered: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw lastError;
}

// ─── Response Parsing ──────────────────────────────────────────────────────────

function parseAndResolve(content: string): DispatcherResponse {
  const cleanContent = content.replace(/```json/gi, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(cleanContent) as unknown;

  if (!isRecord(parsed) || typeof parsed.optimized_prompt !== "string" || !parsed.optimized_prompt.trim()) {
    throw new Error("LLM response missing optimized_prompt.");
  }

  const routing = isRecord(parsed.routing) ? parsed.routing : {};
  const picks: Record<string, { platform_id: string; model_name: string; reasoning: string }> = {};

  for (const tier of ["open_source", "freemium", "premium"]) {
    const entry = isRecord(routing[tier]) ? routing[tier] : {};
    picks[tier] = {
      platform_id: typeof entry.platform_id === "string" ? entry.platform_id : "",
      model_name: typeof entry.model_name === "string" ? entry.model_name : "",
      reasoning: typeof entry.reasoning === "string" ? entry.reasoning : "",
    };
  }

  const recommendations = resolveRecommendations(picks);

  return {
    optimized_prompt: parsed.optimized_prompt as string,
    recommendations,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
