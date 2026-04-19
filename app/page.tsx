"use client";

import Image from "next/image";
import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Clipboard,
  ExternalLink,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  RefreshCw,
  Search,
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
    eyebrow: "Run it your way",
    icon: Search,
  },
  {
    id: "freemium",
    label: "Freemium",
    eyebrow: "Start free",
    icon: Wand2,
  },
  {
    id: "premium",
    label: "Premium",
    eyebrow: "Best firepower",
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
    <main className="min-h-screen bg-[#f5f7f6] text-[#151817]">
      <section className="border-b border-[#d9dfdc] bg-white">
        <div className="mx-auto grid min-h-[calc(100vh-1px)] max-w-7xl gap-8 px-5 py-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] lg:px-8">
          <div className="flex min-h-[620px] flex-col justify-between gap-6">
            <div>
              <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-[#136f63]">
                <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#b7ddd5] bg-[#edf9f6] px-3">
                  <MessageSquareText className="h-4 w-4" />
                  AI Prompt Dispatcher
                </span>
                {isCoolingDown ? (
                  <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#f0b8c3] bg-[#fff0f3] px-3 text-[#9f1f3d]">
                    <AlertCircle className="h-4 w-4" />
                    {cooldownTimer}s cooldown
                  </span>
                ) : null}
              </div>

              <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_210px]">
                <div>
                  <h1 className="max-w-3xl text-4xl font-bold leading-tight text-[#151817]">
                    Give it the lazy version. Get the battle-ready version.
                  </h1>
                  <p className="mt-4 max-w-2xl text-lg leading-8 text-[#4c5551]">
                    Start with a rough thought, answer quick buttons if useful, then send a
                    master prompt to the model that fits the job.
                  </p>
                </div>
                <Image
                  src="https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=640&q=80"
                  alt="Desk with a laptop and notes"
                  width={420}
                  height={220}
                  className="hidden h-[150px] w-full rounded-lg border border-[#d9dfdc] object-cover lg:block"
                />
              </div>
            </div>

            <div className="rounded-lg border border-[#cfd8d4] bg-[#fbfcfc] p-4 shadow-sm">
              <label htmlFor="prompt" className="text-sm font-semibold text-[#151817]">
                Rough prompt
              </label>
              <textarea
                id="prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Example: write code for my SaaS landing page"
                className="mt-3 min-h-[160px] w-full resize-none rounded-lg border border-[#c6d0cc] bg-white p-4 text-base leading-7 text-[#151817] outline-none transition focus:border-[#159a82] focus:ring-2 focus:ring-[#b7eee4]"
              />

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={requestClarifications}
                  disabled={!hasPrompt || isClarifying || isLoading || isCoolingDown}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#151817] px-4 text-sm font-bold text-white transition hover:bg-[#2a302d] disabled:cursor-not-allowed disabled:bg-[#aeb8b3]"
                >
                  {isClarifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Guided Mode
                </button>
                <button
                  type="button"
                  onClick={generatePrompt}
                  disabled={!hasPrompt || isClarifying || isLoading || isCoolingDown}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#13a085] px-4 text-sm font-bold text-white transition hover:bg-[#0d7e69] disabled:cursor-not-allowed disabled:bg-[#aeb8b3]"
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  {isCoolingDown ? `Wait ${cooldownTimer}s` : "Generate Prompt"}
                </button>
              </div>

              {error ? (
                <div className="mt-4 rounded-lg border border-[#efb3bf] bg-[#fff0f3] p-3 text-sm font-semibold text-[#9f1f3d]">
                  {error}
                </div>
              ) : null}
            </div>

            {questions.length ? (
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-lg font-bold text-[#151817]">Clarify with buttons</h2>
                  <span className="text-sm font-semibold text-[#4c5551]">
                    {selectedCount}/{questions.length} selected
                  </span>
                </div>

                {questions.map((question) => (
                  <div key={question.id} className="rounded-lg border border-[#cfd8d4] bg-white p-4">
                    <p className="font-semibold text-[#151817]">{question.question}</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      {question.options.map((option) => {
                        const isSelected = answers[question.id] === option;

                        return (
                          <button
                            type="button"
                            key={option}
                            onClick={() => chooseAnswer(question.id, option)}
                            className={`min-h-12 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${
                              isSelected
                                ? "border-[#13a085] bg-[#e7f8f4] text-[#0f6255]"
                                : "border-[#cfd8d4] bg-[#fbfcfc] text-[#37413d] hover:border-[#13a085]"
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
            ) : null}
          </div>

          <aside className="flex min-h-[620px] flex-col gap-4 rounded-lg border border-[#cfd8d4] bg-[#151817] p-4 text-white">
            <div className="flex items-center justify-between gap-4 border-b border-white/15 pb-4">
              <div>
                <p className="text-sm font-semibold text-[#80e4d4]">Dispatcher output</p>
                <h2 className="mt-1 text-2xl font-bold">Master prompt</h2>
              </div>
              <button
                type="button"
                onClick={() => result && copyText("prompt", result.optimized_prompt)}
                disabled={!result}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/20 px-3 text-sm font-bold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/40"
              >
                <Clipboard className="h-4 w-4" />
                {copied === "prompt" ? "Copied" : "Copy"}
              </button>
            </div>

            <div className="min-h-[300px] flex-1 overflow-auto rounded-lg border border-white/10 bg-white/[0.04] p-4">
              {isLoading ? (
                <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-3 text-center text-white/75">
                  <RefreshCw className="h-7 w-7 animate-spin text-[#80e4d4]" />
                  Building the prompt and routing the model picks.
                </div>
              ) : result ? (
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-[#eef7f4]">
                  {result.optimized_prompt}
                </pre>
              ) : (
                <div className="flex h-full min-h-[260px] flex-col justify-center gap-3 text-white/65">
                  <p className="text-lg font-semibold text-white">Nothing generated yet.</p>
                  <p className="leading-7">
                    Add a rough prompt, use Guided Mode if the goal is mushy, then generate.
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
              <div className="grid grid-cols-3 gap-2">
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;

                  return (
                    <button
                      type="button"
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      disabled={!result}
                      className={`min-h-16 rounded-lg border p-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        isActive
                          ? "border-[#80e4d4] bg-[#0f6255]"
                          : "border-white/10 bg-transparent hover:bg-white/10"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="mt-2 block text-sm font-bold">{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 min-h-[150px] rounded-lg border border-white/10 bg-[#fbfcfc] p-4 text-[#151817]">
                {activeRecommendation ? (
                  <div className="flex h-full flex-col justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-[#136f63]">
                        {TABS.find((tab) => tab.id === activeTab)?.eyebrow}
                      </p>
                      <h3 className="mt-1 text-xl font-bold">{activeRecommendation.model_name}</h3>
                      <p className="mt-2 break-words text-sm leading-6 text-[#4c5551]">
                        {activeRecommendation.platform_url}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyAndOpen(activeRecommendation)}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#151817] px-4 text-sm font-bold text-white transition hover:bg-[#2a302d]"
                    >
                      {copied === activeRecommendation.model_name ? "Copied Prompt" : "Copy & Open"}
                      <ExternalLink className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex h-full min-h-[118px] items-center text-sm font-semibold text-[#66716c]">
                    Recommendations will land here.
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="border-b border-[#d9dfdc] bg-[#ebf4f1]">
        <div className="mx-auto grid max-w-7xl gap-4 px-5 py-5 text-sm font-semibold text-[#37413d] md:grid-cols-3 lg:px-8">
          <p className="inline-flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-[#13a085]" />
            3 requests per minute per IP
          </p>
          <p className="inline-flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-[#13a085]" />
            Live search expires after one second
          </p>
          <p className="inline-flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-[#13a085]" />
            Groq fallback models stay ready
          </p>
        </div>
      </section>
    </main>
  );
}
