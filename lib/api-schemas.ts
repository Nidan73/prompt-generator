/**
 * Zod Schemas for API Request Validation
 *
 * Single source of truth for request shapes across all Edge API routes.
 * Each schema validates, trims, and caps input length automatically.
 */

import { z } from "zod";

export const PROMPT_MAX_CHARS = 4000;
export const REFINE_SOURCE_MAX_CHARS = 6000;
export const REFINE_INSTRUCTION_MAX_CHARS = 500;
export const CLARIFICATION_ANSWER_MAX_CHARS = 3000;

// ─── /api/generate ─────────────────────────────────────────────────────────────

export const GenerateSchemaObject = z.object({
  optimized_prompt: z.string().describe("Optimized expert prompt"),
  routing: z.object({
    open_source: z.object({
      platform_id: z.string(),
      model_name: z.string(),
      reasoning: z.string(),
    }),
    freemium: z.object({
      platform_id: z.string(),
      model_name: z.string(),
      reasoning: z.string(),
    }),
    premium: z.object({
      platform_id: z.string(),
      model_name: z.string(),
      reasoning: z.string(),
    }),
  }).describe("Best model/platform by tier")
});

export const GenerateRequestSchema = z.object({
  prompt: z
    .string({ message: "A non-empty prompt is required." })
    .trim()
    .min(1, "A non-empty prompt is required.")
    .max(PROMPT_MAX_CHARS, `Prompt must be ${PROMPT_MAX_CHARS} characters or fewer.`),
  clarifications: z
    .array(
      z.object({
        question: z.string().trim().transform((v) => v.slice(0, 160)),
        answer: z.string().trim().transform((v) => v.slice(0, CLARIFICATION_ANSWER_MAX_CHARS)),
      }),
    )
    .max(6)
    .optional()
    .default([]),
});

export type GenerateInput = z.infer<typeof GenerateRequestSchema>;

// ─── /api/clarify ──────────────────────────────────────────────────────────────

export const ClarifyRequestSchema = z.object({
  prompt: z
    .string({ message: "A non-empty prompt is required." })
    .trim()
    .min(1, "A non-empty prompt is required.")
    .max(PROMPT_MAX_CHARS, `Prompt must be ${PROMPT_MAX_CHARS} characters or fewer.`),
});

export type ClarifyInput = z.infer<typeof ClarifyRequestSchema>;

// ─── /api/refine ───────────────────────────────────────────────────────────────

export const RefineRequestSchema = z.object({
  currentPrompt: z
    .string({ message: "A non-empty currentPrompt is required." })
    .trim()
    .min(1, "A non-empty currentPrompt is required.")
    .transform((v) => v.slice(0, REFINE_SOURCE_MAX_CHARS)),
  instruction: z
    .string({ message: "A non-empty instruction is required." })
    .trim()
    .min(1, "A non-empty instruction is required.")
    .max(
      REFINE_INSTRUCTION_MAX_CHARS,
      `Instruction must be ${REFINE_INSTRUCTION_MAX_CHARS} characters or fewer.`,
    ),
});

export type RefineInput = z.infer<typeof RefineRequestSchema>;

// ─── /api/extract ──────────────────────────────────────────────────────────────

export const ExtractRequestSchema = z.object({
  url: z
    .string({ message: "A non-empty URL is required." })
    .trim()
    .min(1, "A non-empty URL is required.")
    .url("Invalid URL format.")
    .refine(
      (v) => v.startsWith("http://") || v.startsWith("https://"),
      "URL must use http or https protocol.",
    ),
});

export type ExtractInput = z.infer<typeof ExtractRequestSchema>;

// ─── Shared Helpers ────────────────────────────────────────────────────────────

/**
 * Parse and validate a request body against a Zod schema.
 * Returns the validated data or a formatted error response.
 */
export async function parseRequestBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<{ data: z.infer<T>; error?: never } | { data?: never; error: Response }> {
  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return {
      error: Response.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      ),
    };
  }

  const result = schema.safeParse(raw);

  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const message = firstIssue
      ? `${firstIssue.path.join(".")}: ${firstIssue.message}`.replace(/^: /, "")
      : "Invalid request.";

    return {
      error: Response.json({ error: message }, { status: 400 }),
    };
  }

  return { data: result.data };
}
