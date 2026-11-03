import { expect, test, type Page } from "@playwright/test";

const generateResponse = {
  optimized_prompt:
    "Role: Senior product engineer\nTask: Build a production-ready test prompt\nContext: E2E mocked generation\nFormat: Implementation checklist\nConstraints: Keep it deterministic.",
  routing: {
    open_source: {
      platform_id: "groq",
      model_name: "Llama 4 Scout",
      reasoning: "Fast open model for implementation planning.",
    },
    freemium: {
      platform_id: "chatgpt",
      model_name: "GPT-5.5",
      reasoning: "Strong general reasoning with low-friction access.",
    },
    premium: {
      platform_id: "claude",
      model_name: "Claude Opus 4.7",
      reasoning: "Best fit for long-form software planning.",
    },
  },
};

const guidedQuestions = [
  {
    id: "role",
    question: "Which expert role should the AI assume?",
    options: ["Senior engineer", "Product strategist", "QA lead"],
  },
  {
    id: "depth",
    question: "How detailed should the output be?",
    options: ["Production-ready", "Brief", "Exploratory"],
  },
  {
    id: "format",
    question: "What format do you want?",
    options: ["Checklist", "PRD", "Code plan"],
  },
];

async function mockApiRoutes(page: Page) {
  await page.route("**/api/clarify", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(guidedQuestions),
    });
  });

  await page.route("**/api/extract", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        title: "Example Docs",
        content: "Extracted deterministic documentation context for E2E.",
      }),
    });
  });

  await page.route("**/api/generate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      headers: { "X-Provider-Name": "E2E Mock Provider" },
      body: JSON.stringify(generateResponse),
    });
  });

  await page.route("**/api/refine", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      headers: { "X-Provider-Name": "E2E Mock Provider" },
      body: "Role: Senior product engineer\nTask: Build a shorter refined production-ready test prompt.",
    });
  });
}

test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockApiRoutes(page);
});

test("direct generation, routing, API mode, refinement, share, and history", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /turn a rough idea/i })).toBeVisible();
  await page
    .getByPlaceholder("Example: Build a chrome extension that will help me to track my time")
    .fill("Create a production readiness checklist for a prompt generation app");
  await page.getByRole("button", { name: /generate prompt/i }).click();

  await expect(page.getByText("Build a production-ready test prompt")).toBeVisible();
  await expect(page.getByText("Llama 4 Scout")).toBeVisible();
  await expect(page.getByText("https://chat.groq.com")).toBeVisible();

  await page.getByRole("button", { name: /premium/i }).click();
  await expect(page.getByText("Claude Opus 4.7")).toBeVisible();
  await expect(page.getByText("https://claude.ai")).toBeVisible();

  await page.getByRole("button", { name: /api mode/i }).click();
  await expect(page.getByText('"model": "Claude Opus 4.7"')).toBeVisible();
  await page.getByRole("button", { name: /chat mode/i }).click();

  await page
    .getByPlaceholder("Refine: e.g., make it shorter, add error handling...")
    .fill("Make it shorter");
  await page.keyboard.press("Enter");
  await expect(page.getByText("shorter refined production-ready test prompt")).toBeVisible();

  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("button", { name: "Link copied!" })).toBeVisible();

  await page.getByLabel("Prompt history").click();
  await expect(page.getByRole("heading", { name: "Past Generations" })).toBeVisible();
  await expect(
    page
      .getByRole("button")
      .filter({ hasText: "Create a production readiness checklist" })
      .first(),
  ).toBeVisible();
});

test("guided mode asks questions, injects URL context, and submits enriched clarifications", async ({
  page,
}) => {
  const generateRequests: Array<{
    prompt?: string;
    clarifications?: Array<{ question: string; answer: string }>;
  }> = [];

  await page.route("**/api/generate", async (route) => {
    generateRequests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      body: JSON.stringify(generateResponse),
    });
  });

  await page.goto("/");
  await page
    .getByPlaceholder("Example: Build a chrome extension that will help me to track my time")
    .fill("Summarize this product documentation https://example.com/docs for launch QA");
  await expect(page.getByText(/url detected/i)).toBeVisible();

  await page.getByRole("button", { name: "Guided Mode" }).click();
  await page.getByRole("button", { name: "Start Guided Mode" }).click();

  await expect(page.getByText("Which expert role should the AI assume?")).toBeVisible();
  await page.getByRole("button", { name: "Senior engineer" }).click();
  await page.getByRole("button", { name: "Production-ready" }).click();
  await page.getByRole("button", { name: "Checklist" }).click();

  await page.locator("#action-buttons").getByRole("button", { name: "Generate Prompt" }).click();
  await expect(page.getByText("Build a production-ready test prompt")).toBeVisible();

  const generatePayload = generateRequests[0];
  expect(generatePayload?.prompt).toContain("Summarize this product documentation");
  expect(generatePayload?.clarifications).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        question: "URL Context (auto-extracted)",
        answer: expect.stringContaining("Extracted deterministic documentation context"),
      }),
      expect.objectContaining({
        question: "Which expert role should the AI assume?",
        answer: "Senior engineer",
      }),
    ]),
  );
});

test("theme toggle persists dark mode class and mobile layout renders core workflow", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");

  await page.getByLabel("Toggle theme").click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page
    .getByPlaceholder("Example: Build a chrome extension that will help me to track my time")
    .fill("Create a concise mobile smoke test for production release");
  await page.getByRole("button", { name: /generate prompt/i }).click();

  await expect(page.getByText("Build a production-ready test prompt")).toBeVisible();
  await expect(page.getByText("Chat platforms")).toBeVisible();

  if (isMobile) {
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(horizontalOverflow).toBe(false);
  }
});

test("Ctrl+Enter sends exactly the prompt typed key by key", async ({ page }) => {
  const generateRequests: Array<{ prompt?: string }> = [];

  await page.route("**/api/generate", async (route) => {
    generateRequests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      body: JSON.stringify(generateResponse),
    });
  });

  await page.goto("/");
  const textarea = page.getByPlaceholder(
    "Example: Build a chrome extension that will help me to track my time",
  );
  await textarea.click();
  await textarea.pressSequentially("build a portfolio site with dark mode");
  await page.keyboard.press("Control+Enter");

  await expect(page.getByText("Build a production-ready test prompt")).toBeVisible();
  expect(generateRequests).toHaveLength(1);
  expect(generateRequests[0]?.prompt).toBe("build a portfolio site with dark mode");
});

test("a 429 from generate starts the cooldown and shows the cooldown message", async ({ page }) => {
  await page.route("**/api/generate", async (route) => {
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Daily prompt generation limit reached. Please try again tomorrow.",
        retryAfter: 30,
      }),
    });
  });

  await page.goto("/");
  await page
    .getByPlaceholder("Example: Build a chrome extension that will help me to track my time")
    .fill("Create a production readiness checklist for a prompt generation app");
  await page.getByRole("button", { name: /generate prompt/i }).click();

  await expect(page.getByText(/\d+s cooldown/)).toBeVisible();
  await expect(page.getByText("Cooling down this IP before the next request.")).toBeVisible();
});

test("an empty refine response keeps the existing prompt and says so", async ({ page }) => {
  await page.route("**/api/refine", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      body: "",
    });
  });

  await page.goto("/");
  await page
    .getByPlaceholder("Example: Build a chrome extension that will help me to track my time")
    .fill("Create a production readiness checklist for a prompt generation app");
  await page.getByRole("button", { name: /generate prompt/i }).click();
  await expect(page.getByText("Build a production-ready test prompt")).toBeVisible();

  await page
    .getByPlaceholder("Refine: e.g., make it shorter, add error handling...")
    .fill("Make it shorter");
  await page.keyboard.press("Enter");

  await expect(
    page.getByText("Refinement returned nothing. Your prompt is unchanged."),
  ).toBeVisible();
  await expect(page.getByText("Build a production-ready test prompt")).toBeVisible();
});

test("Stop cancels a running generation and says so", async ({ page }) => {
  await page.route("**/api/generate", async (route) => {
    // Hold the response so the request is still in flight when Stop is clicked.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.fulfill({ status: 200, body: JSON.stringify(generateResponse) }).catch(() => {});
  });

  await page.goto("/");
  await page
    .getByPlaceholder("Example: Build a chrome extension that will help me to track my time")
    .fill("Create a production readiness checklist for a prompt generation app");
  await page.getByRole("button", { name: /generate prompt/i }).click();

  await page.getByRole("button", { name: "Stop" }).click();

  await expect(page.getByText("Generation stopped.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toBeHidden();
  await expect(page.getByText("Build a production-ready test prompt")).toBeHidden();
});

test("a failed clipboard write shows the manual copy message", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
  });

  await page.goto("/");
  await page
    .getByPlaceholder("Example: Build a chrome extension that will help me to track my time")
    .fill("Create a production readiness checklist for a prompt generation app");
  await page.getByRole("button", { name: /generate prompt/i }).click();
  await expect(page.getByText("Build a production-ready test prompt")).toBeVisible();

  await page.getByRole("button", { name: "Copy", exact: true }).click();

  await expect(
    page.getByText("Could not copy to the clipboard. Select the text and copy it manually."),
  ).toBeVisible();
});

test("history drawer has a named close button, Escape closes it and restores focus", async ({ page }) => {
  await page.goto("/");
  const historyButton = page.getByRole("button", { name: "Prompt history" });
  await historyButton.click();

  await expect(page.getByRole("button", { name: "Close history" })).toBeVisible();
  await expect(historyButton).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Close history" })).toBeHidden();
  await expect(historyButton).toBeFocused();
  await expect(historyButton).toHaveAttribute("aria-expanded", "false");
});

test("mode toggles expose aria-pressed", async ({ page }) => {
  await page.goto("/");
  const guided = page.getByRole("button", { name: "Guided Mode", exact: true });
  await expect(guided).toHaveAttribute("aria-pressed", "false");
  await guided.click();
  await expect(guided).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Fast Generation" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("a failed generate is announced through an alert", async ({ page }) => {
  await page.route("**/api/generate", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Boom" }),
    });
  });

  await page.goto("/");
  await page
    .getByPlaceholder("Example: Build a chrome extension that will help me to track my time")
    .fill("Create a production readiness checklist for a prompt generation app");
  await page.getByRole("button", { name: /generate prompt/i }).click();

  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toBeVisible();
});

test("status region announces generation and copy", async ({ page }) => {
  await page.goto("/");
  await page
    .getByPlaceholder("Example: Build a chrome extension that will help me to track my time")
    .fill("Create a production readiness checklist for a prompt generation app");
  await page.getByRole("button", { name: /generate prompt/i }).click();

  const status = page.getByRole("status");
  await expect(status).toHaveText("Prompt ready");
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(status).toHaveText("Copied");
});

test("guided questions take focus and custom inputs have names", async ({ page }) => {
  await page.goto("/");
  await page
    .getByPlaceholder("Example: Build a chrome extension that will help me to track my time")
    .fill("Create a production readiness checklist for a prompt generation app");
  await page.getByRole("button", { name: "Guided Mode" }).click();
  await page.getByRole("button", { name: "Start Guided Mode" }).click();

  await expect(page.getByText("Which expert role should the AI assume?")).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "Custom answer for: Which expert role should the AI assume?" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Senior engineer" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
