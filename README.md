# Bhai Thik Kor

Live: https://bhaithikkor.vercel.app/

Bhai Thik Kor turns a rough idea into a structured prompt and recommends a model for three tiers (open source, freemium, premium). Input can be English, Bangla or romanized Bangla; the prompt comes back in English.

## Features

- Streaming generation: `/api/generate` streams a structured JSON result with `streamObject` from the Vercel AI SDK, and the page renders it as it arrives.
- Guide Me: `/api/clarify` asks three multiple-choice questions to fill gaps before generating.
- Tweak It: `/api/refine` streams an edited version of the prompt with `streamText`.
- URL context: paste a link and `/api/extract` reads the page through Jina Reader. Private and internal addresses are rejected (`lib/url-safety.ts`).
- Share and history: share links compress the prompt into the URL `#` fragment with lz-string, so it is never sent to the server; the last 10 prompts are kept in the browser's localStorage and can be cleared from the history drawer.
- Admin page (`/admin`): password login with a signed cookie, daily usage counters, provider ping, a cooldown reset that clears the shared cooldown state, and pool status that marks models a provider no longer lists as "Retired". It is marked `noindex`, and the session token is never sent in a response body or a `?key=` query.

## How requests are routed

`lib/provider-pool.ts` keeps a separate pool for generate, clarify and refine. For generate, requests rotate across the three strongest models (Groq GPT-OSS 120B, Groq GPT-OSS 20B, Gemini 3.6 Flash); the Gemini Flash Lite models come next as fallback, then OpenRouter free models. Clarify and refine rotate across their whole pool. A model that fails twice is cooled down for two minutes, and cooldowns (and the admin reset) are shared between instances through Upstash Redis. The generate pool only uses models that support structured JSON output.

The pinned pools hold Groq GPT-OSS 120B and 20B plus the current Gemini Flash and Flash Lite models; OpenRouter free models are discovered at request time. Providers retire model IDs without notice, so this is handled twice:

- At runtime the app reads each provider's live model list in the background (never in front of a request) and stops using pinned models that are no longer listed.
- `.github/workflows/model-check.yml` runs `npm run test:live` every Monday at 06:00 UTC (and on demand). It fails if a pinned model is gone, which is your signal to update the pool. Locally a provider without a key is skipped; in CI a missing secret fails the run.

`lib/openrouter-free.ts` fetches the current list of free OpenRouter models and falls back to a known list if the catalogue is unreachable.

`lib/stream-guard.ts` waits for the first token before sending the response, so a provider that fails early can still fall over to the next one.

## How prompts are generated

The system prompt (`lib/prompts/generate-system-prompt.ts`) picks a structure per task type, keeps sections readable and sizes the length to the task. It does not invent facts: anything the user did not say goes under an "Assumptions:" section, and if one key fact is missing the prompt asks for it. The deliverable language rules and the three routing tiers are defined in the prompt. Image prompts are one plain-language paragraph that starts with "Create an image:", so a chat assistant renders the image instead of describing it. A short checklist at the end of the system prompt repeats the formatting and routing rules, because smaller models follow the end of a prompt most reliably. Guide Me questions come from `lib/prompts/clarify-system-prompt.ts` and are normalized to exactly three in `lib/clarify-questions.ts`.

Model recommendations use live data. The OpenRouter catalogue supplies model names, with an "(open-weight)" marker taken from `hugging_face_id` and a separate `[IMAGE MODELS]` block for image-output models. The platform registry also flags which platforms can generate images. The catalogue is cached for 6 hours; when it expires the cached copy keeps serving while a refresh runs in the background. The last good catalogue is also kept in Redis under `btq:model-landscape:last-good` and is used before the static fallback text, which only appears if OpenRouter and Redis are both unavailable.

Provider order: Groq and Gemini pools first, OpenRouter free models only as a fallback after them, and free models under 8B parameters are never used. Groq and Gemini pool entries missing from the provider's live model list are dropped in the background, so a retired model stops being tried.

## Limits

| Route | Per minute | Per day |
|---|---|---|
| `/api/generate` | none | 50 |
| `/api/clarify` | 3 | 60 |
| `/api/refine` | 5 | 100 |
| `/api/extract` | 5 | 60 |
| `/api/admin/login` | 5 per 15 minutes | none |

Limits are per client. IPv4 clients are keyed by address and IPv6 clients by their /64 network, so rotating addresses inside one network does not reset the count. Requests rejected as invalid (bad body, over-long prompt, a URL that fails the syntax-level checks) are not counted. URLs blocked only after DNS resolution are rejected after metering, so they do count. Prompts are capped at 4,000 characters (`lib/api-schemas.ts`). If no Redis variables are set (the Upstash names or Vercel's `KV_REST_API_URL` and `KV_REST_API_TOKEN`), the public API routes allow requests and log them as unmetered; admin login does the opposite and fails closed. Empty values count as missing. All API routes run on the Node.js runtime.

## Security

- URL fetching (`lib/url-safety.ts`): private, loopback, link-local and other internal IPv4 and IPv6 ranges are rejected, DNS names are resolved and every address is checked, and the connection is pinned to the checked address through undici so a name cannot resolve to something different at connect time. Every redirect hop is re-validated.
- Security headers (`lib/security-headers.ts`, applied in `next.config.ts`): Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` and `Permissions-Policy`.
- Admin auth: the session cookie is HMAC-signed with `ADMIN_SESSION_SECRET`, and login is limited to 5 attempts per 15 minutes per client.
- Logging (`lib/api-observability.ts`): each API call writes one JSON line with the route, event, status, provider, duration, input length in characters, and error type, and adds daily counters in Redis that expire after 14 days. Caught errors are logged through `describeError`, and streaming provider errors through `providerErrorLogger`; both keep only the error name, status code, and error type. The AI SDK's default error output includes request and response bodies, which hold user prompts, so streaming calls always pass `providerErrorLogger` instead. No prompt text, request body, or provider response body is logged.

## Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, Vercel AI SDK 6, Upstash Redis and Ratelimit, Zod 4, Framer Motion, Vitest, Playwright.

## Run locally

Copy `.env.example` to `.env.local` and fill in what you need:

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | Model providers. One key is enough to start; each extra key adds models to the pool. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Rate limits, usage counters, shared cooldowns and the model catalogue snapshot. Vercel's `KV_REST_API_URL` and `KV_REST_API_TOKEN` are accepted as alternatives. |
| `ADMIN_PASSWORD` | Password for `/admin`. |
| `ADMIN_SESSION_SECRET` | Signs admin cookies. Required in production, at least 32 characters, never derived from the password or a provider key. Generate one with `openssl rand -base64 48`. |

`ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` are only needed for the `/admin` page. Node.js 22.19 or newer is required (`engines` in `package.json`).

```bash
npm install
npm run dev
```

## Deploy

Deploys are manual. `vercel.json` turns off Git deployments from `main`, so pushing does not ship anything. Deploy from a clean checkout of `main` with the Vercel CLI:

```bash
npx vercel deploy          # preview
npx vercel deploy --prod   # production (bhaithikkor.vercel.app)
```

- `.vercelignore` keeps local-only files (maintainer notes, test output, `.superpowers/`) out of the upload. The CLI reads `.vercelignore`, not `.gitignore`.
- Vercel environment variables: Production needs the three provider keys, the Upstash pair, `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET`. Preview has the same variables except two provider keys: of the three it only has `GROQ_API_KEY`, so preview builds run on Groq alone.
- `ADMIN_SESSION_SECRET` must exist before deploying. Without it `/admin` login returns 503. Changing it logs out every admin session. Production and Preview use different values.
- In production, admin login fails closed (503) when Redis is not configured or unreachable.
- After deploying, `/api/health` should report `"status":"ok"` and the footer shows the version from `lib/version.ts`.

GitHub Actions needs `GROQ_API_KEY` and `GEMINI_API_KEY` as **repository** secrets (Settings, Secrets and variables, Actions, Repository secrets) for the weekly model check. Environment secrets are not visible to that workflow.

## Scripts

- `npm run dev`: start the dev server
- `npm run build`: production build
- `npm run start`: serve the production build
- `npm run lint`: ESLint
- `npm run typecheck`: TypeScript check
- `npm test`: Vitest unit tests
- `npm run test:live`: check that every pinned Groq and Gemini model still exists (needs provider keys; runs weekly in CI)
- `npm run test:eval`: generate real prompts for a set of ideas and score them against the quality checks (needs `GROQ_API_KEY` and/or `GEMINI_API_KEY`; writes `/tmp/prompt-eval-report.md`; blanks the Upstash variables so it never touches Redis)
- `npm run test:e2e`: Playwright tests with mocked API routes

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, build and the Playwright tests on every push to main and every pull request.

## Project structure

```
app/            pages (home, admin, privacy), icons and OG image, API routes
components/     home page client components and hooks
app/api/        generate, clarify, refine, extract, health, admin
lib/            provider pool, rate limit, schemas, URL safety, stream guard, admin auth, security headers, share links, history
lib/prompts/    generate and Guide Me system prompts
tests/unit/     Vitest tests
tests/e2e/      Playwright tests
tests/live/     live model availability check (weekly in CI)
tests/eval/     live prompt quality eval (manual, needs provider keys)
```

## Browser extension

A Chrome extension that uses this API lives at https://github.com/Nidan73/bhai-thik-kor-extension. Version 1.1.4 calls `/api/generate`, `/api/clarify`, and `/api/refine` from its background service worker. It does not use `/api/extract` or `/api/health`. It is not on the Chrome Web Store yet.

The `/privacy` page covers what the extension sends: the text you ask it to improve, your Guided Mode answers, the quality guidance the extension adds, a count and kind of attached files (never names or contents), and, with Adaptive Style on, the style you typed or a short summary from your local history. Nothing is sent until the user asks. The extension's limits are mirrored by hand in its `src/shared/constants.ts`, so a change to a limit or to the clarification cap (`MAX_CLARIFICATIONS`, currently 10; the extension sends up to 7) here needs a matching check there.
