"use client";

import Image from "next/image";
import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Clipboard,
  ExternalLink,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  RefreshCw,
  Search,
  Sparkles,
  Wand2,
} from "lucide-react";

type ClarifyingQuestion = {
  id: string;
  question: string;
  options: string[];
};

type RecommendationTier = "open_source" | "freemium" | "premium";

type Recommendation = {
  model_name: string;
  platform_url: string;
};

type DispatcherResponse = {
  optimized_prompt: string;
  recommendations: Record<RecommendationTier, Recommendation>;
};

type ApiError = {
  error?: string;
  retryAfter?: number;
};

const TABS: Array<{
  id: RecommendationTier;
  label: string;
  eyebrow: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  {
    id: "open_source",
    label: "Open Source",
    eyebrow: "Free hosted model",
    icon: Search,
  },
  {
    id: "freemium",
    label: "Freemium",
    eyebrow: "Start fast",
    icon: Wand2,
  },
  {
    id: "premium",
    label: "Premium",
    eyebrow: "Highest leverage",
    icon: LockKeyhole,
  },
];

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [questions, setQuestions] = useState<ClarifyingQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<DispatcherResponse | null>(null);
  const [activeTab, setActiveTab] = useState<RecommendationTier>("open_source");
  const [isClarifying, setIsClarifying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [cooldownTimer, setCooldownTimer] = useState(0);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const trimmedPrompt = prompt.trim();
  const hasPrompt = trimmedPrompt.length > 0;
  const isCoolingDown = cooldownTimer > 0;
  const selectedCount = Object.keys(answers).length;

  const clarifications = useMemo(
    () =>
      questions.map((question) => ({
        question: question.question,
        answer: answers[question.id] ?? "No preference selected.",
      })),
    [answers, questions],
  );

  useEffect(() => {
    if (!isCoolingDown) {
      return;
    }

    const interval = window.setInterval(() => {
      setCooldownTimer((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [isCoolingDown]);

  async function requestClarifications() {
    if (!hasPrompt || isCoolingDown) {
      return;
    }

    setIsClarifying(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmedPrompt }),
      });

      const payload = await response.json();

      if (!response.ok) {
        handleApiError(response.status, payload);
        return;
      }

      setQuestions(payload as ClarifyingQuestion[]);
      setAnswers({});
    } catch {
      setError("Guided mode could not start. Try direct generation.");
    } finally {
      setIsClarifying(false);
    }
  }

  async function generatePrompt() {
    if (!hasPrompt || isCoolingDown) {
      return;
    }

    setIsLoading(true);
    setError("");
    setCopied("");

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          clarifications,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        handleApiError(response.status, payload);
        return;
      }

      setResult(payload as DispatcherResponse);
      setActiveTab("open_source");
    } catch {
      setError("Generation failed. Give it another run in a moment.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleApiError(status: number, payload: ApiError) {
    if (status === 429 && typeof payload.retryAfter === "number") {
      setCooldownTimer(Math.max(1, Math.ceil(payload.retryAfter)));
      setError("Cooling down this IP before the next request.");
      return;
    }

    setError(payload.error ?? "The dispatcher could not complete that request.");
  }

  function chooseAnswer(questionId: string, option: string) {
    setAnswers((current) => ({
      ...current,
      [questionId]: option,
    }));
  }

  async function copyText(label: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1600);
  }

  async function copyAndOpen(recommendation: Recommendation) {
    if (result) {
      await copyText(recommendation.model_name, result.optimized_prompt);
    }

    window.open(recommendation.platform_url, "_blank", "noopener,noreferrer");
  }

  const activeRecommendation = result?.recommendations[activeTab];

  return (
    <main className="min-h-screen bg-[#f2f6f4] px-4 py-8 text-[#171b1a] sm:px-6">
      <div className="mx-auto max-w-4xl">
        <header className="overflow-hidden rounded-lg border border-[#cbd8d2] bg-white shadow-sm">
          <div className="relative h-44 w-full border-b border-[#cbd8d2]">
            <Image
              src="https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80"
              alt="Focused workspace with a laptop and planning notes"
              fill
              priority
              sizes="(max-width: 896px) 100vw, 896px"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-[#171b1a]/35" />
            <div className="absolute left-6 top-6 inline-flex h-10 items-center gap-2 rounded-lg border border-white/35 bg-white/90 px-3 text-sm font-bold text-[#171b1a]">
              <MessageSquareText className="h-4 w-4 text-[#0f8f7b]" />
              AI Prompt Dispatcher
            </div>
            {isCoolingDown ? (
              <div className="absolute right-6 top-6 inline-flex h-10 items-center gap-2 rounded-lg border border-[#f4b3c2] bg-[#fff3f6] px-3 text-sm font-bold text-[#9a1f3d]">
                <AlertCircle className="h-4 w-4" />
                {cooldownTimer}s cooldown
              </div>
            ) : null}
          </div>

          <div className="p-6 sm:p-8">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#0f8f7b]">
              RTCFC prompt architect
            </p>
            <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight text-[#171b1a] sm:text-5xl">
              Turn a lazy idea into a prompt that can actually work.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#515d59] sm:text-lg">
              Add the rough version, answer quick clarification buttons when useful, then
              generate a structured prompt and route it to chat interfaces where you can paste
              it immediately.
            </p>
          </div>
        </header>

        <section className="mt-6 rounded-lg border border-[#cbd8d2] bg-white p-6 shadow-sm sm:p-8">
          <label htmlFor="prompt" className="text-sm font-bold uppercase tracking-[0.14em] text-[#515d59]">
            Rough prompt
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Example: write code for my SaaS landing page"
            className="mt-3 min-h-[180px] w-full resize-none rounded-lg border border-[#b9c7c1] bg-[#fbfdfc] p-4 text-base leading-relaxed text-[#171b1a] outline-none transition placeholder:text-[#8a9691] focus:border-[#0f8f7b] focus:ring-2 focus:ring-[#a7eee1]"
          />

          <div className="mt-5 grid gap-3 sm:grid-cols-[0.85fr_1.15fr]">
            <button
              type="button"
              onClick={requestClarifications}
              disabled={!hasPrompt || isClarifying || isLoading || isCoolingDown}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-[#9fb1a9] bg-white px-4 text-sm font-bold text-[#26302c] transition hover:border-[#0f8f7b] hover:bg-[#edf9f6] disabled:cursor-not-allowed disabled:border-[#d7dfdc] disabled:text-[#9aa6a1]"
            >
              {isClarifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Guided Mode
            </button>
            <button
              type="button"
              onClick={generatePrompt}
              disabled={!hasPrompt || isClarifying || isLoading || isCoolingDown}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#0f8f7b] px-4 text-sm font-black text-white shadow-sm transition hover:bg-[#0a725f] disabled:cursor-not-allowed disabled:bg-[#aebbb5]"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {isCoolingDown ? `Wait ${cooldownTimer}s` : "Generate Prompt"}
            </button>
          </div>

          {error ? (
            <div className="mt-5 rounded-lg border border-[#efb3bf] bg-[#fff3f6] p-4 text-sm font-bold leading-relaxed text-[#9a1f3d]">
              {error}
            </div>
          ) : null}
        </section>

        {questions.length ? (
          <section className="mt-6 rounded-lg border border-[#cbd8d2] bg-white p-6 shadow-sm sm:p-8">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f8f7b]">
                  Guided Mode
                </p>
                <h2 className="mt-1 text-2xl font-black tracking-tight text-[#171b1a]">
                  Clarify with buttons
                </h2>
              </div>
              <span className="rounded-lg border border-[#cbd8d2] bg-[#f5f9f7] px-3 py-2 text-sm font-bold text-[#515d59]">
                {selectedCount}/{questions.length}
              </span>
            </div>

            <div className="mt-5 grid gap-4">
              {questions.map((question) => (
                <div key={question.id} className="rounded-lg border border-[#d7e1dd] bg-[#fbfdfc] p-4">
                  <p className="font-bold leading-relaxed text-[#171b1a]">{question.question}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {question.options.map((option) => {
                      const isSelected = answers[question.id] === option;

                      return (
                        <button
                          type="button"
                          key={option}
                          onClick={() => chooseAnswer(question.id, option)}
                          className={`min-h-12 rounded-lg border px-3 py-2 text-left text-sm font-bold leading-relaxed transition ${
                            isSelected
                              ? "border-[#0f8f7b] bg-[#e4f8f3] text-[#075f51]"
                              : "border-[#cbd8d2] bg-white text-[#3e4945] hover:border-[#0f8f7b]"
                          }`}
                        >
                          <span className="inline-flex items-center gap-2">
                            {isSelected ? <Check className="h-4 w-4" /> : null}
                            {option}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-6 rounded-lg border border-[#cbd8d2] bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f8f7b]">
                Dispatcher output
              </p>
              <h2 className="mt-1 text-3xl font-black tracking-tight text-[#171b1a]">
                Master prompt
              </h2>
            </div>
            <button
              type="button"
              onClick={() => result && copyText("prompt", result.optimized_prompt)}
              disabled={!result}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#9fb1a9] bg-white px-4 text-sm font-bold text-[#26302c] transition hover:border-[#0f8f7b] hover:bg-[#edf9f6] disabled:cursor-not-allowed disabled:border-[#d7dfdc] disabled:text-[#9aa6a1]"
            >
              <Clipboard className="h-4 w-4" />
              {copied === "prompt" ? "Copied" : "Copy Prompt"}
            </button>
          </div>

          <div className="mt-5 min-h-[300px] overflow-auto rounded-lg border border-[#d7e1dd] bg-[#fbfdfc] p-5">
            {isLoading ? (
              <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center text-[#515d59]">
                <RefreshCw className="h-7 w-7 animate-spin text-[#0f8f7b]" />
                <p className="font-bold">Building the RTCFC prompt and routing chat platforms.</p>
              </div>
            ) : result ? (
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-[#26302c]">
                {result.optimized_prompt}
              </pre>
            ) : (
              <div className="flex min-h-[260px] flex-col justify-center gap-3 text-[#6b7772]">
                <p className="text-lg font-black tracking-tight text-[#171b1a]">
                  Your generated prompt will appear here.
                </p>
                <p className="max-w-xl leading-relaxed">
                  The backend now forces Role, Task, Context, Format, and Constraints, then
                  recommends direct chat interfaces instead of docs or repositories.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-[#cbd8d2] bg-white p-6 shadow-sm sm:p-8">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f8f7b]">
              Platform routing
            </p>
            <h2 className="mt-1 text-3xl font-black tracking-tight text-[#171b1a]">
              Direct chat recommendations
            </h2>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  type="button"
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  disabled={!result}
                  className={`min-h-16 rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${
                    isActive
                      ? "border-[#0f8f7b] bg-[#e4f8f3] text-[#075f51]"
                      : "border-[#cbd8d2] bg-[#fbfdfc] text-[#3e4945] hover:border-[#0f8f7b]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="mt-2 block text-sm font-black">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 min-h-[160px] rounded-lg border border-[#d7e1dd] bg-[#fbfdfc] p-5">
            {activeRecommendation ? (
              <div className="flex h-full flex-col justify-between gap-5">
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#b02a49]">
                    {TABS.find((tab) => tab.id === activeTab)?.eyebrow}
                  </p>
                  <h3 className="mt-2 text-2xl font-black tracking-tight text-[#171b1a]">
                    {activeRecommendation.model_name}
                  </h3>
                  <p className="mt-2 break-words text-sm leading-relaxed text-[#515d59]">
                    {activeRecommendation.platform_url}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copyAndOpen(activeRecommendation)}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#171b1a] px-4 text-sm font-black text-white transition hover:bg-[#303735]"
                >
                  {copied === activeRecommendation.model_name ? "Copied Prompt" : "Copy & Open Chat"}
                  <ExternalLink className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex min-h-[118px] items-center text-sm font-bold leading-relaxed text-[#6b7772]">
                Direct chat links will appear after generation.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
