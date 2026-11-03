import { REFINE_INSTRUCTION_MAX_CHARS, REFINE_SOURCE_MAX_CHARS } from "@/lib/api-schemas";

// Opening or closing envelope tags, tolerant of case, spacing and attributes.
const ENVELOPE_TAG = /<(\s*\/?\s*(?:user_prompt|clarifications)(?:[\s/][^>]*)?)>/gi;
const REFINE_MARKER = /\[((?:END )?(?:CURRENT PROMPT|EDIT REQUEST))\]/gi;

/** Defuses envelope tags so user text cannot close the block it sits in. */
function neutralizeTags(text: string): string {
  return text.replace(ENVELOPE_TAG, "&lt;$1&gt;");
}

function neutralizeRefine(text: string): string {
  return neutralizeTags(text).replace(REFINE_MARKER, "($1)");
}

export function buildGenerateUserContent(
  prompt: string,
  clarifications: Array<{ question: string; answer: string }>,
): string {
  // Delimited so pasted web content cannot pose as instructions.
  let content = `<user_prompt>\n${neutralizeTags(prompt)}\n</user_prompt>\n`;

  const answered = clarifications.filter((c) => c.answer && c.answer.trim().length > 0);
  if (answered.length > 0) {
    content += "\n<clarifications>\n";
    for (const c of answered) {
      content += `- ${neutralizeTags(c.question.trim())}: ${neutralizeTags(c.answer.trim())}\n`;
    }
    content += "</clarifications>\n";
  }

  return content;
}

export function buildClarifyUserContent(prompt: string): string {
  return `<user_prompt>\n${neutralizeTags(prompt)}\n</user_prompt>`;
}

// Markers, not XML tags: the model reproduced <prompt>/<edit> wrappers in its
// output, which shipped the scaffolding to users as part of the refined prompt.
export function buildRefineUserContent(currentPrompt: string, instruction: string): string {
  const source = neutralizeRefine(currentPrompt.slice(0, REFINE_SOURCE_MAX_CHARS));
  const edit = neutralizeRefine(instruction.slice(0, REFINE_INSTRUCTION_MAX_CHARS));
  return `[CURRENT PROMPT]\n${source}\n[END CURRENT PROMPT]\n\n[EDIT REQUEST]\n${edit}\n[END EDIT REQUEST]`;
}
