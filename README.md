# Bhai Thik Kor

Live: https://bhaithikkor.vercel.app/

Bhai Thik Kor turns a rough idea into a structured prompt and recommends a model for three tiers (open source, freemium, premium). Input can be English, Bangla or romanized Bangla; the prompt comes back in English.

## Features

- Streaming generation: `/api/generate` streams a structured JSON result with `streamObject` from the Vercel AI SDK, and the page renders it as it arrives.
- Guide Me: `/api/clarify` asks three multiple-choice questions to fill gaps before generating.
- Tweak It: `/api/refine` streams an edited version of the prompt with `streamText`.
- URL context: paste a link and `/api/extract` reads the page through Jina Reader. Private and internal addresses are rejected (`lib/url-safety.ts`).
- Share and history: share links compress the prompt into the URL `#` fragment with lz-string, so it is never sent to the server; the last 10 prompts are kept in the browser's localStorage and can be cleared from the history drawer.
- Admin page (`/admin`): password login with a signed cookie, daily usage counters, provider ping and a cooldown reset that clears the shared cooldown state. It is marked `noindex`, and the session token is never sent in a response body or a `?key=` query.

## How requests are routed

`lib/provider-pool.ts` spreads requests across Groq, Gemini and OpenRouter models with a round-robin counter. A model that fails twice is cooled down for two minutes, and cooldowns (and the admin reset) are shared between instances through Upstash Redis. The generate pool only uses models that support structured JSON output.

The pinned pools are Groq GPT-OSS 120B and 20B plus the current Gemini Flash and Flash Lite models; OpenRouter free models are discovered at request time. Providers retire model IDs without notice, so `.github/workflows/model-check.yml` runs `npm run test:live` every Monday (and on demand). It asks Groq and Gemini which models they list and fails if a pinned model is gone. A provider without a key is skipped.

`lib/openrouter-free.ts` fetches the current list of free OpenRouter models and falls back to a known list if the catalogue is unreachable.

`lib/stream-guard.ts` waits for the first token before sending the response, so a provider that fails early can still fall over to the next one.

## Limits

| Route | Per minute | Per day |
|---|---|---|
| `/api/generate` | none | 50 |
| `/api/clarify` | 3 | 60 |
| `/api/refine` | 5 | 100 |
| `/api/extract` | 5 | 60 |
| `/api/admin/login` | 5 per 15 minutes | none |

Limits are per client. IPv4 clients are keyed by address and IPv6 clients by their /64 network, so rotating addresses inside one network does not reset the count. Requests rejected as invalid (bad body, over-long prompt, blocked URL) are not counted. Prompts are capped at 4,000 characters (`lib/api-schemas.ts`). If the Upstash variables are missing, the public API routes allow requests and log them as unmetered; admin login does the opposite and fails closed. All API routes run on the Node.js runtime.

## Security

- URL fetching (`lib/url-safety.ts`): private, loopback, link-local and other internal IPv4 and IPv6 ranges are rejected, DNS names are resolved and every address is checked, and the connection is pinned to the checked address through undici so a name cannot resolve to something different at connect time. Every redirect hop is re-validated.
- Security headers (`lib/security-headers.ts`, applied in `next.config.ts`): Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` and `Permissions-Policy`.
- Admin auth: the session cookie is HMAC-signed with `ADMIN_SESSION_SECRET`, and login is limited to 5 attempts per 15 minutes per client.
- Error logs record the error type and status only, never prompt text or provider response bodies.

## Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, Vercel AI SDK 6, Upstash Redis and Ratelimit, Zod 4, Framer Motion, Vitest, Playwright.

## Run locally

Copy `.env.example` to `.env.local` and fill in what you need:

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | Model providers. One key is enough to start; each extra key adds models to the pool. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Rate limits, usage counters and shared cooldowns. |
| `ADMIN_PASSWORD` | Password for `/admin`. |
| `ADMIN_SESSION_SECRET` | Signs admin cookies. Required in production, at least 32 characters, never derived from the password or a provider key. Generate one with `openssl rand -base64 48`. |

`ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` are only needed for the `/admin` page.

Deployment notes:

- `ADMIN_SESSION_SECRET` must be set in Vercel before deploying. Without it `/admin` login returns 503, and old admin cookies stop working.
- In production, admin login fails closed (503) when Upstash is not configured or unreachable.
- The weekly model-check workflow needs the `GROQ_API_KEY` and `GEMINI_API_KEY` repository secrets.
- Node.js 22.19 or newer is required (`engines` in `package.json`).

```bash
npm install
npm run dev
```

## Scripts

- `npm run dev`: start the dev server
- `npm run build`: production build
- `npm run start`: serve the production build
- `npm run lint`: ESLint
- `npm run typecheck`: TypeScript check
- `npm test`: Vitest unit tests
- `npm run test:live`: check that every pinned Groq and Gemini model still exists (needs provider keys; runs weekly in CI)
- `npm run test:e2e`: Playwright tests with mocked API routes

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, build and the Playwright tests on every push to main and every pull request.

## Project structure

```
app/            pages (home, admin, privacy), icons and OG image, API routes
components/     home page client components and hooks
app/api/        generate, clarify, refine, extract, health, admin
lib/            provider pool, rate limit, schemas, URL safety, stream guard, admin auth, security headers, share links, history
tests/unit/     Vitest tests
tests/e2e/      Playwright tests
tests/live/     live model availability check
```

## Browser extension

A Chrome extension that uses this API lives at https://github.com/Nidan73/bhai-thik-kor-extension.
