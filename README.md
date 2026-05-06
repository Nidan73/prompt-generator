# Bhai Thik Kor (Production Architecture)

Live : https://bhaithikkor.vercel.app/`

**Turn a vague idea into an expert-grade AI prompt — and know exactly where to run it.**

![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38BDF8?logo=tailwindcss&logoColor=white)
![Vercel Edge](https://img.shields.io/badge/Vercel-Edge-000000)

The AI Prompt Dispatcher is a production-grade prompt engineering workspace. It transforms rough, low-effort input into structured, execution-ready prompts using a **7-Category Dynamic Switchboard**. It then routes each prompt to the best AI platform for the job using **ranking-based model analysis** — zero hardcoded bias, no static model lists.

---

## 🏛️ System Architecture & Workflow

### 1. Context Extraction (`/api/extract`)
Users can paste URLs directly into their prompts. The system detects the URL and extracts its content to use as grounding context.
- **Primary Engine:** Uses Jina Reader API to execute JavaScript and parse SPAs/React sites into clean Markdown.
- **Fallback:** Direct `fetch` with aggressive regex HTML stripping for static sites if Jina times out.

### 2. Intent Detection & Guided Mode (`/api/clarify`)
If the user clicks "Guide Me", the engine detects their intent across 7 categories (Code, Video, Image, Copywriting, Data, Meta-Prompting, Generic).
- It dynamically generates 3 highly specific multiple-choice questions (e.g., asking about *Camera Angles* for Video tasks, or *Tech Stack* for Coding tasks).

### 3. The Switchboard Prompt Engine (`/api/generate`)
The orchestration layer no longer relies on a one-size-fits-all framework. It acts as a routing switchboard:
- **Code:** Generates XML `<file>` and `<thinking>` blocks optimized for Claude 3.5 Sonnet / GPT-4o.
- **Copywriting:** Enforces AIDA (Attention, Interest, Desire, Action) or PAS frameworks.
- **Data/Math:** Enforces strict Chain-of-Thought (CoT) reasoning.
- **Video:** Outputs dense, comma-separated physics, motion, and camera tags.
- **Images:** Outputs a 12-dimension visual matrix.
- **Generic:** Falls back to the RTCFC framework (Role, Task, Context, Format, Constraints).

### 4. Zero-Bias Model Routing
The LLM acts as an expert AI analyst. It identifies task demands (coding, writing, math, research, etc.), considers benchmark standings (LMSYS ELO, MMLU, HumanEval, MATH), and recommends the latest model version on the best platform across 3 tiers (Open Source, Freemium, Premium).
- **Platform Registry:** `lib/ai-catalog.ts` stores verified chat URLs. The LLM is forbidden from inventing URLs.

### 5. Adaptive Refinement (`/api/refine`)
The "Tweak It" chat bar allows users to adjust the generated prompt in-place. The refinement engine automatically analyzes the prompt's *current structural format* (XML, comma tags, AIDA, RTCFC) and seamlessly preserves that exact layout while applying the tweak.

---

## 🛡️ Reliability & Security Layer

- **Zod Type Safety:** All 4 Edge API routes enforce strict `zod` schema validation (`lib/api-schemas.ts`) to prevent malformed JSON and cap input lengths.
- **Multi-Provider Fallback Pipeline:** The backend automatically cascades through LLM providers if one fails or rate-limits: `Groq (Primary) → Gemini (Fallback 1) → OpenRouter (Fallback 2)`.
- **Upstash Redis Rate Limiting:** Sliding-window rate limiting on all API routes (e.g., 5 req / 1 min / IP).
- **Vercel Edge Runtime:** All APIs run on the Vercel Edge for sub-millisecond cold starts globally.

---

## ⚡ Power User Features

The UI is optimized for prompt engineers who want to move fast:
- `Cmd/Ctrl + Enter` → Generate prompt instantly.
- `Cmd/Ctrl + Shift + C` → Copy generated prompt.
- `Cmd/Ctrl + H` → Toggle local-first Prompt History drawer.
- **API Mode:** Toggle to view the final payload as a structured JSON message array for developers.
- **LZ-String Sharing:** The URL automatically compresses the app state so you can share exact prompts/workflows via links.

---

## 🛠️ Developer Setup & Contribution Guide

### Environment Variables
Create a `.env.local` file. The app requires Upstash Redis, but you only need one LLM API key to run it (adding more enables the fallback cascade).

```env
# Required: Rate Limiting
UPSTASH_REDIS_REST_URL="https://..."
UPSTASH_REDIS_REST_TOKEN="..."

# LLM Providers (Need at least one)
GROQ_API_KEY="gsk_..."
GEMINI_API_KEY="AIza..."
OPENROUTER_API_KEY="sk-or-v1-..."
```

### Future Improvement Roadmap
If you are looking to contribute to the platform, here are the highest-impact areas for optimization:
1. **AI SDK Streaming:** The `/api/generate` route currently blocks until the full response is ready. Migrating to the Vercel AI SDK (`streamText`) would massively reduce perceived latency.
2. **Parallel LLM Execution:** The generation route currently handles *both* Prompt Formatting and Model Routing in a single LLM call. Splitting these into `Promise.all()` parallel executions would halve the generation time.
3. **Advanced Web Scraping:** The `/api/extract` Jina Reader fallback could be upgraded to integrate with Firecrawl or a dedicated headless browser service for scraping behind logins.
4. **Account Sync:** The current history uses `localStorage`. Migrating to a lightweight Postgres DB (e.g., Neon or Turso) with Auth.js would allow cross-device sync.
