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
  /\[(insert|add|your|enter|company|name|product|business)[^\]]{0,40}\]|\{[a-z_ ]{2,30}\}|<(insert|your)[^>]*>/i;
const SECTION_LABEL = /^[A-Z][\w ()/&-]{1,40}:/gm;
const IMAGE_JUNK = /unreal engine|octane|\b8k\b|--ar\b/i;
// An Assumptions section alone does not count: a vague request needs an ask-first instruction.
const VAGUE_OK = /\bask (the user|me)\b|\bfirst ask\b|\bstart by asking\b|\bbefore (you )?(start|begin|continu)/i;
const LEAK_MARKERS = [
  "Bhai Thik Kor",
  "HOW TO ROUTE",
  "[PLATFORMS]",
  "open_source: an open-weight",
  "HOW TO WRITE",
  "[MODELS]",
  "[CHECK BEFORE ANSWERING]",
];

const OPEN_WEIGHT_MARKER = /\s*\(open-weight\)\s*$/i;

export type EvalLandscape = { models: string; imageModels: string };

export function checkGenerateOutput(
  output: unknown,
  kind: EvalKind,
  landscape?: EvalLandscape,
): string[] {
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
    else if (landscape) {
      const name = rec.model_name.replace(OPEN_WEIGHT_MARKER, "").trim();
      if (!landscape.models.includes(name) && !landscape.imageModels.includes(name)) {
        issues.push(`routing: ${tier} model_name "${name}" is not in the live model lists`);
      }
    }
  }
  if (kind === "image" && imageTiers < 2) {
    issues.push(`routing: image needs 2+ tiers with image generation, got ${imageTiers}`);
  }

  // An injection reply may legitimately be short and unsectioned.
  const minLength = kind === "inject" ? 0 : 250;
  if (prompt.length < minLength || prompt.length > 5000) {
    issues.push(`length: optimized_prompt is ${prompt.length} chars, expected ${minLength} to 5000`);
  }
  if (BRACKET_BLANK.test(prompt)) issues.push("bracket: generic bracket blank in prompt");

  if (kind === "image") {
    if (prompt.includes("\n\n")) issues.push("image: prompt must be a single paragraph");
    if (IMAGE_JUNK.test(prompt)) issues.push("image: contains quality-spam or parameter tokens");
    if (!/^create an image:/i.test(prompt.trimStart())) {
      issues.push('image: prompt must start with "Create an image:"');
    }
  } else if (kind !== "inject") {
    const labels = prompt.match(SECTION_LABEL)?.length ?? 0;
    if (!prompt.includes("\n\n") || labels < 3) {
      issues.push(`sections: needs blank lines and 3+ "Label:" lines, found ${labels}`);
    }
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
