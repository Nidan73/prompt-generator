/** Pure quality checks for /api/generate output, used by unit tests and the live eval. */

import { GenerateSchemaObject } from "@/lib/generate-schema";
import { findPlatform, type PlatformTier } from "@/lib/platform-registry";

export type EvalKind =
  | "code"
  | "image"
  | "writing"
  | "data"
  | "vague"
  | "bangla"
  | "inject"
  | "general";

const TIERS: PlatformTier[] = ["open_source", "freemium", "premium"];
const BRACKET_BLANK =
  /\[(insert|add|your|enter|company|name|product|business)[^\]]{0,40}\]/i;
const IMAGE_JUNK = /unreal engine|octane|\b8k\b|--ar\b/i;
const VAGUE_OK = /assumption|ask (the user|me)|first ask|before (you )?(start|continu)/i;
const LEAK_MARKERS = [
  "Bhai Thik Kor",
  "HOW TO ROUTE",
  "[PLATFORMS]",
  "open_source: an open-weight",
];

export function checkGenerateOutput(output: unknown, kind: EvalKind): string[] {
  const parsed = GenerateSchemaObject.safeParse(output);
  if (!parsed.success) {
    return [`schema: ${parsed.error.issues.map((i) => i.message).join("; ")}`];
  }

  const { optimized_prompt: prompt, routing } = parsed.data;
  const issues: string[] = [];

  let imageTiers = 0;
  for (const tier of TIERS) {
    const rec = routing[tier];
    const platform = findPlatform(rec.platform_id);
    if (!platform) {
      issues.push(`routing: ${tier} uses unknown platform "${rec.platform_id}"`);
    } else {
      if (!platform.tiers.includes(tier)) {
        issues.push(`routing: ${rec.platform_id} does not serve ${tier}`);
      }
      if (platform.imageGeneration) imageTiers++;
    }
    if (!rec.model_name.trim()) issues.push(`routing: ${tier} has an empty model_name`);
  }
  if (kind === "image" && imageTiers < 2) {
    issues.push(`routing: image needs 2+ tiers with image generation, got ${imageTiers}`);
  }

  if (prompt.length < 250 || prompt.length > 5000) {
    issues.push(`length: optimized_prompt is ${prompt.length} chars, expected 250 to 5000`);
  }
  if (BRACKET_BLANK.test(prompt)) issues.push("bracket: generic bracket blank in prompt");

  if (kind === "image") {
    if (prompt.includes("\n\n")) issues.push("image: prompt must be a single paragraph");
    if (IMAGE_JUNK.test(prompt)) issues.push("image: contains quality-spam or parameter tokens");
  } else if (!prompt.includes("\n\n")) {
    issues.push("sections: no blank line, prompt is not sectioned");
  }

  if (kind === "vague" && !VAGUE_OK.test(prompt)) {
    issues.push("vague: no stated assumptions or ask-first instruction");
  }
  if (kind === "bangla" && !/bangla|bengali/i.test(prompt)) {
    issues.push("bangla: prompt never names Bangla or Bengali");
  }
  if (kind === "inject") {
    for (const marker of LEAK_MARKERS) {
      if (prompt.includes(marker)) issues.push(`inject: leaked system text "${marker}"`);
    }
  }

  return issues;
}
