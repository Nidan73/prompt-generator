# Bhai Thik Kor (Real-Time AI Dispatcher)

Live : [https://bhaithikkor.vercel.app/](https://bhaithikkor.vercel.app/)

**Turn a vague idea into an expert-grade AI prompt with zero-latency streaming and elite model routing.**

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111)
![Vercel AI SDK](https://img.shields.io/badge/Vercel_AI_SDK-Streaming-blue)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38BDF8?logo=tailwindcss&logoColor=white)

Bhai Thik Kor is a high-performance prompt engineering workspace designed for the "Zero Latency" era. It transforms low-effort user input into structured, professional prompts using real-time JSON streaming and elastic provider pools across Groq, Gemini, and OpenRouter.

---

## 🚀 High-Performance Architecture

### 1. Zero-Latency Streaming (`useObject` & `useCompletion`)

The application has been fully migrated to the **Vercel AI SDK**.

- **Real-Time JSON:** The `/api/generate` route uses `streamObject` to stream structured JSON token-by-token. The UI renders the "Optimized Prompt" and "Model Recommendations" as they are being typed by the AI.
- **Fluid Refinement:** The `/api/refine` route uses `streamText` for instant "Tweak It" responses, providing a smooth, typewriter-like experience.

### 2. Multiplexed Provider Pool (The "Free-Tier Cloud")

To overcome the strict rate limits of free AI APIs, we built a **Round-Robin Load Balancer** (`lib/provider-pool.ts`).

- **Task-Specific Pools:** Clarification and refinement use broad speed-first pools; generation is constrained to models/endpoints that support strict structured JSON output.
- **Live-Smoke Verified Generation:** The generation pool currently includes Groq GPT-OSS structured-output models plus Gemini/OpenRouter structured-output fallbacks.
- **Fail-Fast Resilience:** If a provider returns a `429 (Rate Limit)` or `500` error, the backend instantly (within 50ms) cascades to the next model in the pool.
- **Provider Health Cooldown:** Repeated provider failures temporarily cool that provider down inside the active runtime so traffic does not keep hitting a known-bad endpoint first.
- **Capacity:** Adding more provider keys increases available free-tier capacity without changing application code.

### 3. Live Model-Aware Routing

The routing layer combines a verified platform registry with a cached OpenRouter model landscape.

- **Verified URLs:** The LLM returns `platform_id` values, and the client resolves them against local platform URLs.
- **Fresh Recommendations:** `/api/generate` injects the current model landscape so routing can prefer newer suitable models instead of stale hardcoded picks.
- **Low-Latency Cache:** The landscape uses a short in-memory cache plus Vercel/Next fetch caching to avoid calling OpenRouter on every generation request.
- **Safe Fallbacks:** If live model data is unavailable, the app falls back to a static model landscape.

---

## 🏛️ Core Workflow

### 1. URL Context Extraction

Paste a URL (e.g., a documentation page or a GitHub repo) and the system automatically grounds the AI in that content using **Jina Reader** and aggressive HTML stripping.

### 2. Intelligent Guided Mode

Don't know what's missing? Click "Guide Me". The AI dynamically deduces your task's domain (Code, Video, Image, etc.) and generates 3 high-impact multiple-choice questions to fill the gaps.

### 3. Switchboard Prompt Logic

The engine detects your intent and selects the perfect framework:

- **Code:** XML-tagged structured reasoning.
- **Marketing:** AIDA / PAS frameworks.
- **Creative:** Premise/Tone/Style matrices.
- **General:** The elite RTCFC (Role, Task, Context, Format, Constraints) framework.

### 4. Tweak, Share, and Reuse

Generated prompts can be refined with the streaming "Tweak It" editor, copied as chat/API-ready output, shared through compressed URL hashes, and restored from local browser history.

---

## 🛡️ Reliability & Security

- **Upstash Redis Rate Limiting:** Enforces a sliding-window limit (50 generations per user per day) to prevent API abuse.
- **Input Defense:** Generation inputs are capped at 4,000 characters, clarification payloads are bounded, and refinement inputs are capped separately to protect quotas.
- **Safe URL Extraction:** URL reads block private/internal hosts, enforce fetch timeouts, reject oversized responses, and only process text-like content.
- **Production Telemetry:** API routes emit structured logs and daily Upstash counters for route events, statuses, fallback pressure, provider usage, and safe input-size totals without logging full prompts.
- **Health Endpoint:** `/api/health` returns a sanitized public readiness summary only; it does not expose provider names, key presence, model inventory, or cache internals.
- **CI Smoke Checks:** GitHub Actions run lint, build, and mocked Playwright E2E on pushes and pull requests.
- **Vercel Edge Runtime:** All API routes run on the Edge for global low-latency and zero cold starts.

---

## 🛠️ Developer Setup

### Environment Variables

Create a `.env.local` file with the following keys. You only need one LLM key to start; adding more enables the load balancer.

```env
# Required: Rate Limiting
UPSTASH_REDIS_REST_URL="https://..."
UPSTASH_REDIS_REST_TOKEN="..."

# LLM Providers (Add any to enable them in the pool)
GROQ_API_KEY="gsk_..."
GEMINI_API_KEY="AIza..."
OPENROUTER_API_KEY="sk-or-v1-..."
```

### Installation

```bash
npm install
npm run dev
```

### Verification

```bash
npm run lint
npm run build
npm run test:e2e
```

Operational counters are stored in Upstash Redis with daily keys like `btq:metrics:YYYY-MM-DD:<route>:...` and a 14-day TTL.

---

## 🗺️ Roadmap

- [x] **Streaming UI:** Full migration to Vercel AI SDK for real-time feedback.
- [x] **Provider Multiplexing:** Round-Robin load balancing with task-specific provider pools.
- [x] **Live Model Routing:** Cached model landscape plus verified platform resolution.
- [x] **Local History & Sharing:** Browser-local prompt history and compressed share links.
- [ ] **Multi-Modal Support:** Visual prompting for GPT-4o-vision/Gemini Pro Vision.
- [ ] **Advanced Prompt Versioning:** Diffing between "Version A" and "Version B" of an optimized prompt.
- [ ] **Community Hub:** Share optimized prompts to a public gallery.
