export type RawClarifyQuestions = {
  questions: Array<{ question: string; options: string[] }>;
};

const MAX_OPTIONS = 4;
const MAX_QUESTIONS = 3;

/** Weak models drift on count and option quality, so enforce it here. Null means unusable. */
export function normalizeClarifyQuestions(
  raw: RawClarifyQuestions,
): Array<{ question: string; options: string[] }> | null {
  const valid: Array<{ question: string; options: string[] }> = [];

  for (const item of raw.questions) {
    const question = item.question.trim();
    if (!question) continue;

    const seen = new Set<string>();
    const options: string[] = [];
    for (const option of item.options) {
      const text = option.trim();
      const key = text.toLowerCase();
      if (!text || /^other\b/i.test(text) || seen.has(key)) continue;
      seen.add(key);
      options.push(text);
      if (options.length === MAX_OPTIONS) break;
    }

    if (options.length >= 2) valid.push({ question, options });
  }

  return valid.length >= MAX_QUESTIONS ? valid.slice(0, MAX_QUESTIONS) : null;
}
