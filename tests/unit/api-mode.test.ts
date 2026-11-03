import { describe, expect, it } from "vitest";
import { buildApiModeOutput } from "../../lib/api-mode";

describe("buildApiModeOutput", () => {
  it("wraps the prompt in a chat-completions style payload", () => {
    expect(buildApiModeOutput("Write a haiku.", "gpt-5")).toBe(
      JSON.stringify(
        {
          model: "gpt-5",
          messages: [
            { role: "system", content: "Write a haiku." },
            { role: "user", content: "Execute the task described above." },
          ],
        },
        null,
        2,
      ),
    );
  });

  it("falls back to a placeholder model when none is recommended", () => {
    const parsed = JSON.parse(buildApiModeOutput("Prompt", undefined));
    expect(parsed.model).toBe("recommended-model");
  });

  it("falls back to the placeholder for an empty model name", () => {
    expect(JSON.parse(buildApiModeOutput("Prompt", "")).model).toBe("recommended-model");
  });
});
