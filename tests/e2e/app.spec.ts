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
