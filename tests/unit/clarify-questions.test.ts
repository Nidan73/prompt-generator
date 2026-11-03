import { describe, expect, it } from "vitest";
import { InvalidOutputError, normalizeClarifyQuestions } from "../../lib/clarify-questions";

const q = (question: string, options: string[]) => ({ question, options });
const valid = (n: number) => q(`Question ${n}?`, [`A${n}`, `B${n}`, `C${n}`]);

describe("normalizeClarifyQuestions", () => {
  it("trims questions and options and drops empty ones", () => {
    const out = normalizeClarifyQuestions({
      questions: [q("  Which stack?  ", [" Next.js ", "", "  ", "Rails"]), valid(2), valid(3)],
    });
    expect(out?.[0]).toEqual({ question: "Which stack?", options: ["Next.js", "Rails"] });
  });

  it("dedupes options case-insensitively", () => {
    const out = normalizeClarifyQuestions({
      questions: [q("Tone?", ["Formal", "formal", "FORMAL", "Casual"]), valid(2), valid(3)],
    });
    expect(out?.[0].options).toEqual(["Formal", "Casual"]);
  });

  it("drops Other options", () => {
    const out = normalizeClarifyQuestions({
      questions: [q("Tone?", ["Formal", "Other", "other (please specify)", "Casual"]), valid(2), valid(3)],
    });
    expect(out?.[0].options).toEqual(["Formal", "Casual"]);
  });

  it("keeps options that merely start with the letters of other", () => {
    const out = normalizeClarifyQuestions({
      questions: [q("Who?", ["Others", "Otherwise", "Team"]), valid(2), valid(3)],
    });
    expect(out?.[0].options).toEqual(["Others", "Otherwise", "Team"]);
  });

  it("caps options at 4", () => {
    const out = normalizeClarifyQuestions({
      questions: [q("Pick?", ["a", "b", "c", "d", "e", "f"]), valid(2), valid(3)],
    });
    expect(out?.[0].options).toEqual(["a", "b", "c", "d"]);
  });

  it("rejects a question with fewer than 2 options", () => {
    const out = normalizeClarifyQuestions({
      questions: [q("Lonely?", ["only"]), valid(1), valid(2), valid(3)],
    });
    expect(out).toHaveLength(3);
    expect(out?.map((x) => x.question)).toEqual(["Question 1?", "Question 2?", "Question 3?"]);
  });

  it("rejects an empty question", () => {
    expect(
      normalizeClarifyQuestions({ questions: [q("   ", ["a", "b"]), valid(1), valid(2)] }),
    ).toBeNull();
  });

  it("returns exactly 3 when 4 valid exist", () => {
    const out = normalizeClarifyQuestions({ questions: [valid(1), valid(2), valid(3), valid(4)] });
    expect(out).toHaveLength(3);
    expect(out?.[2].question).toBe("Question 3?");
  });

  it("returns null when only 2 are valid", () => {
    expect(normalizeClarifyQuestions({ questions: [valid(1), valid(2)] })).toBeNull();
  });
});

describe("InvalidOutputError", () => {
  it("is an Error with its own name", () => {
    const e = new InvalidOutputError("bad");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("InvalidOutputError");
    expect(e.message).toBe("bad");
  });
});
