/** Streamed /api/generate result shape, safe to import from client code. */

import { z } from "zod";

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
