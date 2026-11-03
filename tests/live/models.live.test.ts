import { describe, expect, it } from "vitest";
import { FALLBACK_FREE_MODELS } from "../../lib/openrouter-free";
import { findMissingModels } from "../../lib/model-availability";
import { PINNED_POOLS } from "../../lib/provider-pool";

function expectNoneMissing(provider: string, ids: Set<string>) {
  const missing = findMissingModels(PINNED_POOLS, { [provider]: ids });
  const report = missing.map((m) => `${m.pool}/${m.name}/${m.modelId}`).join("\n");
  expect(missing, `Missing ${provider} models:\n${report}`).toEqual([]);
}

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json();
}

// In CI a missing secret must fail loudly, otherwise the check silently passes.
// Locally the provider suites simply skip.
function requireSecretInCi(name: string) {
  if (process.env.CI && !process.env[name]) {
    throw new Error(`${name} secret is not configured for the model-check workflow`);
  }
}

describe("Required secrets", () => {
  it("are present in CI", () => {
    requireSecretInCi("GROQ_API_KEY");
    requireSecretInCi("GEMINI_API_KEY");
  });
});

describe.skipIf(!process.env.GROQ_API_KEY)("Groq pinned models", () => {
  it("are all listed by Groq", async () => {
    const body = await getJson("https://api.groq.com/openai/v1/models", {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    });
    expectNoneMissing("groq", new Set((body.data as { id: string }[]).map((m) => m.id)));
  });
});

describe.skipIf(!process.env.GEMINI_API_KEY)("Gemini pinned models", () => {
  it("are all listed by Gemini", async () => {
    const ids = new Set<string>();
    let pageToken = "";

    do {
      const url =
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000" +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
      const body = await getJson(url, { "x-goog-api-key": process.env.GEMINI_API_KEY! });
      for (const m of body.models as { name: string }[]) ids.add(m.name.replace(/^models\//, ""));
      pageToken = body.nextPageToken ?? "";
    } while (pageToken);

    expectNoneMissing("gemini", ids);
  });
});

describe("OpenRouter fallback models", () => {
  it("all exist in the public catalogue", async () => {
    const body = await getJson("https://openrouter.ai/api/v1/models");
    const ids = new Set((body.data as { id: string }[]).map((m) => m.id));
    const missing = FALLBACK_FREE_MODELS.map((m) => m.id).filter((id) => !ids.has(id));
    expect(missing, `Missing OpenRouter models:\n${missing.join("\n")}`).toEqual([]);
  });
});
