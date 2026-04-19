# AI Prompt Dispatcher

**A Serverless, $0-Cost Prompt Engineering Engine**

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38BDF8?logo=tailwindcss&logoColor=white)
![Groq](https://img.shields.io/badge/Groq-SDK-F55036)
![Upstash](https://img.shields.io/badge/Upstash-Redis-00E9A3)
![License](https://img.shields.io/badge/License-MIT-green)

AI Prompt Dispatcher turns vague, low-effort input into structured, execution-ready prompts using the **RTCFC framework**: Role, Task, Context, Format, and Constraints. It also routes each generated prompt to current AI platform recommendations using live Reddit model discussions instead of hardcoded model bias.

The result is a fully serverless Next.js app with Guided Mode, animated premium UI, live model discovery, Redis-backed abuse protection, and a Groq free-tier fallback router.

## Overview

Most prompt tools stop at rewriting text. AI Prompt Dispatcher does three things in one flow:

1. Accepts a rough user idea like `build a dashboard`, `explain RTCFC`, or `write a landing page`.
2. Optionally asks short multiple-choice Guided Mode questions to extract missing prompt context.
3. Generates a master RTCFC prompt and recommends three AI execution targets:
   - **Open Source**
   - **Freemium**
   - **Premium**

The backend is stateless and serverless. There is no PostgreSQL, Firebase, MongoDB, or paid search API.

## The $0 Architecture

### Groq Fallback Engine

The generation route starts with Groq's `llama-3.3-70b-versatile` model. If Groq returns a `429` rate-limit response, the exact same payload is retried against a fallback chain:

```txt
llama-3.3-70b-versatile
  -> openai/gpt-oss-120b
  -> qwen/qwen3-32b
```

This daisy-chains multiple free-tier model pools so the app can keep serving requests when the primary model hits token or request ceilings. Non-rate-limit failures are not swallowed; they bubble up as API errors so real problems remain visible.

### Upstash Shield

Every API route runs through an Upstash Redis sliding-window rate limiter before touching Groq:

```txt
3 requests / 1 minute / IP
```

When the limit is exceeded, the API returns `429` with `retryAfter` seconds. The frontend reads that value, disables generation, and displays a live cooldown timer.

### Native Reddit JSON Search

The generator uses Reddit's public JSON endpoint to pull current model discussions from `r/LocalLLaMA` with a task-aware query:

```txt
best [user task] model
```

Only the latest three post titles and short body snippets are sent to Groq to reduce token usage. The request uses native `fetch()`, a custom user agent, and one-hour Next.js revalidation, so the app avoids an extra scraping dependency while still getting live community context. If Reddit search fails, the model falls back to conservative internal reasoning.

## Features

- **RTCFC Prompt Engine**: Generates prompts with explicit Role, Task, Context, Format, and Constraints sections.
- **Guided Mode**: Uses `llama-3.1-8b-instant` to create short multiple-choice questions, including a dynamic role/persona question tailored to the user's idea.
- **Anti-Fragile Parsing**: Accepts `{ questions: [...] }` or raw arrays, trims extra questions/options, and discards malformed items instead of crashing.
- **Dynamic AI Routing**: Uses live Reddit model discussions as the primary source for model/platform recommendations.
- **Consumer Chat URLs Only**: Rejects obvious API docs, GitHub repos, model-weight pages, and base Hugging Face domains.
- **Groq Free-Tier Fallbacks**: Retries on `429` across multiple Groq-hosted free-tier models.
- **Redis Abuse Protection**: Upstash sliding-window rate limiting protects both `/api/clarify` and `/api/generate`.
- **Premium Frontend**: Framer Motion transitions, glassmorphism cards, animated guided flow, and responsive layout.
- **Dark Mode**: A local React theme provider plus a Next-managed boot script powers seamless light/dark switching with an animated Sun/Moon toggle.
- **Copy & Open Flow**: Copies the generated prompt and opens the recommended chat platform.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js App Router |
| UI | React, Tailwind CSS, Framer Motion, lucide-react |
| Theme | Local class-based theme provider |
| API Runtime | Next.js serverless route handlers |
| AI | groq-sdk |
| Search | Native `fetch()` against Reddit JSON |
| Rate Limit | @upstash/redis, @upstash/ratelimit |
| Utility | clsx, tailwind-merge |

## Environment Variables

Create `.env.local` in the project root:

```env
GROQ_API_KEY="your_groq_api_key"
UPSTASH_REDIS_REST_URL="https://your-upstash-redis-url.upstash.io"
UPSTASH_REDIS_REST_TOKEN="your_upstash_redis_rest_token"
```

You can create keys here:

- Groq Console: https://console.groq.com/keys
- Upstash Console: https://console.upstash.com/

## Installation & Setup

Clone the repository:

```bash
git clone https://github.com/Nidan73/prompt-generator.git
cd prompt-generator
```

Install dependencies:

```bash
npm install
```

Add environment variables:

```bash
cp .env.local.example .env.local
```

If `.env.local.example` does not exist yet, create `.env.local` manually using the variables shown above.

Run the development server:

```bash
npm run dev
```

Open the app:

```txt
http://localhost:3000
```

## Available Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## API Flow

### `/api/clarify`

Guided Mode route.

1. Rate limits by IP with Upstash.
2. Sends the rough prompt to Groq `llama-3.1-8b-instant`.
3. Requests exactly three multiple-choice clarification questions.
4. Parses slightly imperfect LLM output defensively.
5. Returns normalized questions to the UI.

### `/api/generate`

Dispatcher route.

1. Rate limits by IP with Upstash.
2. Fetches current `r/LocalLLaMA` model discussions through Reddit JSON.
3. Compresses search payload to the latest three titles and short body snippets.
4. Builds the dynamic RTCFC system prompt.
5. Calls Groq with fallback routing:

```txt
llama-3.3-70b-versatile -> openai/gpt-oss-120b -> qwen/qwen3-32b
```

6. Parses the strict JSON response:

```ts
{
  optimized_prompt: string;
  recommendations: {
    open_source: { model_name: string; platform_url: string };
    freemium: { model_name: string; platform_url: string };
    premium: { model_name: string; platform_url: string };
  };
}
```

## Safety & Reliability

- Secrets stay in `.env.local`, which is ignored by Git.
- API routes are stateless and serverless.
- Redis rate limiting runs before Groq calls.
- Reddit lookup failures are caught and logged so generation can continue with conservative internal routing.
- URL validation blocks common non-chat destinations.
- JSON validation prevents malformed LLM responses from silently corrupting UI state.

## Local Project Context

Maintainer-only architecture notes live in `PROJECT_CONTEXT.md`. This file is intentionally listed in `.gitignore` so private implementation context, decision history, and local notes stay on your machine and are not pushed to GitHub.

## License

MIT
