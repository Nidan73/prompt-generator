"use client";

import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTheme } from "next-themes";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import {
  AlertCircle,
  Check,
  Clipboard,
  ExternalLink,
  Loader2,
  LockKeyhole,
  Moon,
  RefreshCw,
  Search,
  Sparkles,
  Sun,
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

const tabs: Array<{
  id: RecommendationTier;
  label: string;
  eyebrow: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  {
    id: "open_source",
    label: "Open Source",
    eyebrow: "Hosted OSS",
    icon: Search,
  },
  {
    id: "freemium",
    label: "Freemium",
    eyebrow: "Low friction",
    icon: Wand2,
  },
  {
    id: "premium",
    label: "Premium",
    eyebrow: "Best result",
    icon: LockKeyhole,
  },
];

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 10 },
};

function cn(...inputs: Array<string | false | null | undefined>) {
  return twMerge(clsx(inputs));
}

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
  const isGuided = questions.length > 0;
  const hasCompletedGuidedFlow = isGuided && selectedCount === questions.length;
  const showGenerateButton = !isGuided || hasCompletedGuidedFlow;

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
      setError("Guided Mode could not start. Try direct generation.");
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

  function resetGuidedMode() {
    setQuestions([]);
    setAnswers({});
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
    <main className="min-h-screen overflow-hidden bg-slate-50 text-slate-950 transition-colors dark:bg-gray-950 dark:text-slate-50">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.055)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.055)_1px,transparent_1px)] bg-[size:56px_56px] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.055)_1px,transparent_1px)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <motion.header
          variants={fadeUp}
          initial="initial"
          animate="animate"
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="flex items-center justify-between"
        >
          <div className="inline-flex h-10 items-center gap-2 rounded-full border border-gray-200 bg-white/80 px-4 text-sm font-semibold shadow-sm shadow-slate-200/60 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70 dark:shadow-black/20">
            <Sparkles className="h-4 w-4 text-cyan-500" />
            AI Prompt Dispatcher
          </div>
          <ThemeToggle />
        </motion.header>

        <section className="flex flex-1 flex-col justify-center py-10">
          <motion.div
            variants={fadeUp}
            initial="initial"
            animate="animate"
            transition={{ delay: 0.05, duration: 0.5, ease: "easeOut" }}
            className="mx-auto max-w-3xl text-center"
          >
            <p className="text-sm font-medium uppercase tracking-[0.28em] text-cyan-600 dark:text-cyan-400">
              Premium RTCFC prompt engine
            </p>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-950 sm:text-6xl dark:text-white">
              Turn a rough idea into an expert-grade execution prompt.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg dark:text-slate-400">
              Guided questions sharpen the intent. The dispatcher builds a structured RTCFC
              prompt and routes it to consumer chat interfaces that can run it immediately.
            </p>
          </motion.div>

          <motion.section
            variants={fadeUp}
            initial="initial"
            animate="animate"
            transition={{ delay: 0.12, duration: 0.5, ease: "easeOut" }}
            className="mx-auto mt-10 w-full max-w-4xl rounded-2xl border border-gray-200 bg-white/85 p-6 shadow-2xl shadow-slate-200/70 backdrop-blur-xl sm:p-8 dark:border-gray-800 dark:bg-gray-900/70 dark:shadow-black/30"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <label
                  htmlFor="prompt"
                  className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400"
                >
                  Intent
                </label>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                  Start deliberately vague.
                </h2>
              </div>
              {isCoolingDown ? (
                <div className="inline-flex h-10 items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-300">
                  <AlertCircle className="h-4 w-4" />
                  {cooldownTimer}s cooldown
                </div>
              ) : null}
            </div>

            <textarea
              id="prompt"
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                setResult(null);
              }}
              placeholder="Example: build a subscription dashboard for a solo founder"
              className="mt-5 min-h-[170px] w-full resize-none rounded-xl border border-gray-200 bg-slate-50/80 p-5 text-base leading-relaxed text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-500/10 dark:border-gray-800 dark:bg-gray-950/70 dark:text-white dark:placeholder:text-slate-600 dark:focus:border-cyan-500 dark:focus:bg-gray-950"
            />

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={requestClarifications}
                disabled={!hasPrompt || isClarifying || isLoading || isCoolingDown}
                className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-5 text-sm font-semibold text-slate-900 transition hover:border-cyan-300 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-slate-100 dark:hover:border-cyan-700 dark:hover:bg-cyan-950/30"
              >
                {isClarifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Guided Mode
              </button>

              <AnimatePresence mode="wait">
                {showGenerateButton ? (
                  <motion.button
                    key="generate"
                    type="button"
                    onClick={generatePrompt}
                    disabled={!hasPrompt || isClarifying || isLoading || isCoolingDown}
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.98 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    className="inline-flex h-12 flex-[1.35] items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-lg shadow-slate-950/15 transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-slate-400 dark:bg-white dark:text-slate-950 dark:shadow-white/10 dark:hover:bg-slate-200"
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {isCoolingDown ? `Wait ${cooldownTimer}s` : "Generate Prompt"}
                  </motion.button>
                ) : null}
              </AnimatePresence>
            </div>

            <AnimatePresence>
              {isGuided && !hasCompletedGuidedFlow ? (
                <motion.p
                  variants={fadeUp}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="mt-4 text-sm leading-relaxed text-slate-500 dark:text-slate-400"
                >
                  Answer all guided options to reveal the Generate Prompt action.
                </motion.p>
              ) : null}
            </AnimatePresence>

            <AnimatePresence>
              {error ? (
                <motion.div
                  variants={fadeUp}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium leading-relaxed text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-300"
                >
                  {error}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.section>

          <AnimatePresence>
            {questions.length ? (
              <motion.section
                variants={fadeUp}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.32, ease: "easeOut" }}
                className="mx-auto mt-5 w-full max-w-4xl overflow-hidden rounded-2xl border border-gray-200 bg-white/75 p-6 shadow-xl shadow-slate-200/50 backdrop-blur-xl sm:p-8 dark:border-gray-800 dark:bg-gray-900/60 dark:shadow-black/20"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-600 dark:text-cyan-400">
                      Guided Mode
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                      Tighten the brief.
                    </h2>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full border border-gray-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-600 dark:border-gray-800 dark:bg-gray-950 dark:text-slate-300">
                      {selectedCount}/{questions.length}
                    </span>
                    <button
                      type="button"
                      onClick={resetGuidedMode}
                      className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-gray-800 dark:bg-gray-950 dark:text-slate-300 dark:hover:bg-gray-900"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                <div className="mt-6 grid gap-4">
                  {questions.map((question, questionIndex) => (
                    <motion.div
                      key={question.id}
                      variants={fadeUp}
                      initial="initial"
                      animate="animate"
                      transition={{ delay: questionIndex * 0.06, duration: 0.3 }}
                      className="rounded-xl border border-gray-200 bg-slate-50/80 p-4 dark:border-gray-800 dark:bg-gray-950/50"
                    >
                      <p className="font-medium leading-relaxed text-slate-950 dark:text-white">
                        {question.question}
                      </p>
                      <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        {question.options.map((option) => {
                          const isSelected = answers[question.id] === option;

                          return (
                            <button
                              type="button"
                              key={option}
                              onClick={() => chooseAnswer(question.id, option)}
                              className={cn(
                                "min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-medium leading-relaxed transition",
                                isSelected
                                  ? "border-cyan-400 bg-cyan-50 text-cyan-900 shadow-sm shadow-cyan-500/10 dark:border-cyan-500 dark:bg-cyan-950/40 dark:text-cyan-100"
                                  : "border-gray-200 bg-white text-slate-700 hover:border-cyan-300 hover:bg-cyan-50/60 dark:border-gray-800 dark:bg-gray-950 dark:text-slate-300 dark:hover:border-cyan-700 dark:hover:bg-cyan-950/20",
                              )}
                            >
                              <span className="inline-flex items-center gap-2">
                                {isSelected ? <Check className="h-4 w-4" /> : null}
                                {option}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.section>
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {(isLoading || result) && (
              <motion.section
                variants={fadeUp}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="mx-auto mt-5 grid w-full max-w-4xl gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]"
              >
                <div className="rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-xl shadow-slate-200/50 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/65 dark:shadow-black/20">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-600 dark:text-cyan-400">
                        Output
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                        Master prompt
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => result && copyText("prompt", result.optimized_prompt)}
                      disabled={!result}
                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-slate-300 dark:hover:bg-gray-900"
                    >
                      <Clipboard className="h-4 w-4" />
                      {copied === "prompt" ? "Copied" : "Copy"}
                    </button>
                  </div>

                  <div className="mt-5 min-h-[340px] overflow-auto rounded-xl border border-gray-200 bg-slate-50 p-5 dark:border-gray-800 dark:bg-gray-950/80">
                    {isLoading ? (
                      <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 text-center text-slate-500 dark:text-slate-400">
                        <RefreshCw className="h-7 w-7 animate-spin text-cyan-500" />
                        <p className="font-medium">Generating a structured RTCFC prompt.</p>
                      </div>
                    ) : result ? (
                      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                        {result.optimized_prompt}
                      </pre>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white/80 p-5 shadow-xl shadow-slate-200/50 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/65 dark:shadow-black/20">
                  <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-600 dark:text-cyan-400">
                    Routing
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                    Chat platforms
                  </h2>

                  <div className="mt-5 grid gap-2">
                    {tabs.map((tab) => {
                      const Icon = tab.icon;
                      const isActive = activeTab === tab.id;

                      return (
                        <button
                          type="button"
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          disabled={!result}
                          className={cn(
                            "rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50",
                            isActive
                              ? "border-cyan-400 bg-cyan-50 text-cyan-950 dark:border-cyan-500 dark:bg-cyan-950/40 dark:text-cyan-50"
                              : "border-gray-200 bg-slate-50 text-slate-700 hover:border-cyan-300 dark:border-gray-800 dark:bg-gray-950/70 dark:text-slate-300 dark:hover:border-cyan-700",
                          )}
                        >
                          <span className="flex items-center gap-2 text-sm font-semibold">
                            <Icon className="h-4 w-4" />
                            {tab.label}
                          </span>
                          <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                            {tab.eyebrow}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 rounded-xl border border-gray-200 bg-slate-50 p-4 dark:border-gray-800 dark:bg-gray-950/80">
                    {activeRecommendation ? (
                      <div className="flex flex-col gap-4">
                        <div>
                          <h3 className="text-lg font-semibold tracking-tight text-slate-950 dark:text-white">
                            {activeRecommendation.model_name}
                          </h3>
                          <p className="mt-2 break-words text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                            {activeRecommendation.platform_url}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyAndOpen(activeRecommendation)}
                          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                        >
                          {copied === activeRecommendation.model_name ? "Copied Prompt" : "Copy & Open"}
                          <ExternalLink className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                        Recommendations will appear after generation.
                      </p>
                    )}
                  </div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </section>
      </div>
    </main>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="relative inline-flex h-10 w-[72px] items-center rounded-full border border-gray-200 bg-white p-1 shadow-sm shadow-slate-200/60 transition dark:border-gray-800 dark:bg-gray-900 dark:shadow-black/20"
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        className={cn(
          "absolute top-1 flex h-8 w-8 items-center justify-center rounded-full shadow-sm",
          isDark
            ? "left-[34px] bg-slate-800 text-cyan-200"
            : "left-1 bg-slate-950 text-amber-300",
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {isDark ? (
            <motion.span
              key="moon"
              initial={{ opacity: 0, rotate: -35, scale: 0.8 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: 35, scale: 0.8 }}
            >
              <Moon className="h-4 w-4" />
            </motion.span>
          ) : (
            <motion.span
              key="sun"
              initial={{ opacity: 0, rotate: 35, scale: 0.8 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: -35, scale: 0.8 }}
            >
              <Sun className="h-4 w-4" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.span>
    </button>
  );
}
