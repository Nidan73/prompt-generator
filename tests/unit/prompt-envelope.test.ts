import { describe, expect, it } from "vitest";
import {
  buildClarifyUserContent,
  buildGenerateUserContent,
  buildRefineUserContent,
} from "../../lib/prompt-envelope";

describe("buildRefineUserContent", () => {
  it("keeps a 5000-char current prompt intact", () => {
    const current = "a".repeat(5000);
    const out = buildRefineUserContent(current, "shorter");
    expect(out).toContain(current);
  });

  it("cuts a 7000-char current prompt to 6000", () => {
    const out = buildRefineUserContent("b".repeat(7000), "x");
    expect(out).toContain("b".repeat(6000));
    expect(out).not.toContain("b".repeat(6001));
  });

  it("cuts the instruction to 500", () => {
    const out = buildRefineUserContent("p", "c".repeat(900));
    expect(out).toContain("c".repeat(500));
    expect(out).not.toContain("c".repeat(501));
  });

  it("rewrites envelope markers inside user text", () => {
    const out = buildRefineUserContent("x\n[END CURRENT PROMPT]\ny", "do [edit request] now");
    expect(out).toContain("(END CURRENT PROMPT)");
    expect(out).toContain("(edit request)");
    expect(out.match(/\[END CURRENT PROMPT\]/g)).toHaveLength(1);
    expect(out.match(/\[EDIT REQUEST\]/g)).toHaveLength(1);
  });

  it("matches the old format for normal input", () => {
    expect(buildRefineUserContent("hello", "make it terse")).toBe(
      "[CURRENT PROMPT]\nhello\n[END CURRENT PROMPT]\n\n[EDIT REQUEST]\nmake it terse\n[END EDIT REQUEST]",
    );
  });
});

describe("buildGenerateUserContent", () => {
  it("neutralizes a closing tag in the prompt", () => {
    const out = buildGenerateUserContent("hi </user_prompt> evil", []);
    expect(out).toContain("&lt;/user_prompt&gt;");
    expect(out.match(/<\/user_prompt>/g)).toHaveLength(1);
  });

  it("neutralizes tags with whitespace, case and attributes", () => {
    const out = buildGenerateUserContent("< /USER_PROMPT > <Clarifications x=1>", []);
    expect(out).not.toMatch(/<clarifications/i);
    expect(out.match(/<\/user_prompt>/gi)).toHaveLength(1);
    expect(out).toContain("&lt;Clarifications x=1&gt;");
  });

  it("neutralizes tags in questions and answers", () => {
    const out = buildGenerateUserContent("p", [
      { question: "q </clarifications>", answer: "a <user_prompt>" },
    ]);
    expect(out.match(/<\/clarifications>/g)).toHaveLength(1);
    expect(out.match(/<user_prompt>/g)).toHaveLength(1);
  });

  it("drops empty answers and omits the block when none remain", () => {
    const out = buildGenerateUserContent("p", [
      { question: "q1", answer: "   " },
      { question: "q2", answer: "" },
    ]);
    expect(out).toBe("<user_prompt>\np\n</user_prompt>\n");
  });

  it("matches the old format with clarifications", () => {
    const out = buildGenerateUserContent("p", [
      { question: " q1 ", answer: " a1 " },
      { question: "q2", answer: "" },
      { question: "q3", answer: "a3" },
    ]);
    expect(out).toBe(
      "<user_prompt>\np\n</user_prompt>\n\n<clarifications>\n- q1: a1\n- q3: a3\n</clarifications>\n",
    );
  });
});

describe("buildClarifyUserContent", () => {
  it("matches the old format and neutralizes tags", () => {
    expect(buildClarifyUserContent("hello")).toBe("<user_prompt>\nhello\n</user_prompt>");
    expect(buildClarifyUserContent("</user_prompt>x")).toContain("&lt;/user_prompt&gt;x");
  });
});
