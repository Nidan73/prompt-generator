# Bhai Thik Kor

Live: https://bhaithikkor.vercel.app/

Bhai Thik Kor turns a rough idea into a structured prompt and recommends a model for three tiers (open source, freemium, premium). Input can be English, Bangla or romanized Bangla; the prompt comes back in English.

## Features

- Streaming generation: `/api/generate` streams a structured JSON result with `streamObject` from the Vercel AI SDK, and the page renders it as it arrives.
- Guide Me: `/api/clarify` asks three multiple-choice questions to fill gaps before generating.
- Tweak It: `/api/refine` streams an edited version of the prompt with `streamText`.
- URL context: paste a link and `/api/extract` reads the page through Jina Reader. Private and internal addresses are rejected (`lib/url-safety.ts`).
- Share and history: share links compress the prompt into the URL with lz-string; the last 10 prompts are kept in localStorage.
- Admin page (`/admin`): password login with a signed cookie, daily usage counters, provider ping and cooldown reset.

## How requests are routed

`lib/provider-pool.ts` spreads requests across Groq, Gemini and OpenRouter models with a round-robin counter. A model that fails twice is cooled down for two minutes, and cooldowns are shared between instances through Upstash Redis. The generate pool only uses models that support structured JSON output.

`lib/openrouter-free.ts` fetches the current list of free OpenRouter models and falls back to a known list if the catalogue is unreachable.

`lib/stream-guard.ts` waits for the first token before sending the response, so a provider that fails early can still fall over to the next one.

## Limits

| Route | Limit |
|---|---|
| `/api/generate` | 50 per user per day |
| `/api/clarify` | 3 per minute |
| `/api/refine` | 5 per minute |
| `/api/extract` | 5 per minute |

Prompts are capped at 4,000 characters (`lib/api-schemas.ts`). If the Upstash variables are missing, requests are allowed and logged as unmetered. All API routes run on the Node.js runtime.

## Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, Vercel AI SDK 6, Upstash Redis and Ratelimit, Zod 4, Framer Motion, Vitest, Playwright.

## Run locally

Create `.env.local`:

```
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
GROQ_API_KEY=
GEMINI_API_KEY=
OPENROUTER_API_KEY=
ADMIN_PASSWORD=
ADMIN_SESSION_SECRET=
```

One provider key is enough to start; each extra key adds models to the pool. `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` are only needed for the `/admin` page. The session secret signs admin cookies and must be at least 32 random characters in production (for example `openssl rand -base64 48`); it is never derived from the password or a provider key.

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
- `npm run test:e2e`: Playwright tests with mocked API routes

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, build and the Playwright tests on every push to main and every pull request.

## Project structure

```
app/            pages (home, admin, privacy) and API routes
app/api/        generate, clarify, refine, extract, health, admin
lib/            provider pool, rate limit, schemas, URL safety, stream guard, share links, history
tests/unit/     Vitest tests
tests/e2e/      Playwright tests
```

## Browser extension

A Chrome extension that uses this API lives at https://github.com/Nidan73/bhai-thik-kor-extension.
