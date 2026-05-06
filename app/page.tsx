"use client";

import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTheme } from "@/components/theme-provider";
import { saveToHistory, getHistory, clearHistory, type HistoryEntry } from "@/lib/prompt-history";
import { encodePromptToHash, decodePromptFromHash } from "@/lib/share-link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import {
  AlertCircle,
  Check,
  Clipboard,
  Code2,
  ExternalLink,
  Globe,
  History,
  Info,
  Link2,
  Loader2,
  LockKeyhole,
  MessageSquare,
  Moon,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Sun,
  Trash2,
  Wand2,
  X,
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
  reasoning: string;
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
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<DispatcherResponse | null>(null);
  const [activeTab, setActiveTab] = useState<RecommendationTier>("open_source");
  const [isGuidedModeEnabled, setIsGuidedModeEnabled] = useState(false);
  const [isClarifying, setIsClarifying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [cooldownTimer, setCooldownTimer] = useState(0);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Feature: History
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Feature: Developer Mode
  const [outputMode, setOutputMode] = useState<"chat" | "api">("chat");

  // Feature: Tweak It
  const [refineInput, setRefineInput] = useState("");
  const [isRefining, setIsRefining] = useState(false);

  // Feature: Shared Prompt (read-only view from URL hash)
  const [sharedPrompt, setSharedPrompt] = useState<string | null>(null);

  // Feature: URL Context Injection
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const [extractedContext, setExtractedContext] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  const trimmedPrompt = prompt.trim();
  const wordCount = trimmedPrompt ? trimmedPrompt.split(/\s+/).length : 0;
  const hasPrompt = trimmedPrompt.length > 0;
  const hasEnoughContext = wordCount >= 3;
  const isCoolingDown = cooldownTimer > 0;
  const isGuided = questions.length > 0;
  const answeredQuestionCount = questions.filter((question) => answers[question.id]?.trim()).length;
  const selectedCount = answeredQuestionCount;
  const guidedStepCount = questions.length;
  const hasCompletedGuidedFlow = isGuided && answeredQuestionCount === questions.length;
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

  // Load history on mount
  useEffect(() => {
    setHistory(getHistory());
  }, []);

  // Decode shared prompt from URL hash on mount
  useEffect(() => {
    const hash = window.location.hash;
    const decoded = decodePromptFromHash(hash);
    if (decoded) {
      setSharedPrompt(decoded);
      // Clean the hash from the URL without reload
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  // Detect URLs in prompt input
  useEffect(() => {
    const urlMatch = trimmedPrompt.match(/https?:\/\/[^\s]+/);
    setDetectedUrl(urlMatch ? urlMatch[0] : null);
  }, [trimmedPrompt]);

  // Keyboard shortcuts for power users
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      // Ctrl/Cmd + Enter → Generate prompt
      if (e.key === "Enter") {
        e.preventDefault();
        if (hasEnoughContext && !isLoading && !isCoolingDown) {
          if (isGuidedModeEnabled && !isGuided) {
            requestClarifications();
          } else {
            generatePrompt();
          }
        }
        return;
      }

      // Ctrl/Cmd + Shift + C → Copy output
      if (e.key === "C" && e.shiftKey) {
        e.preventDefault();
        if (result) {
          const text = outputMode === "api" ? getApiModeOutput() : result.optimized_prompt;
          navigator.clipboard.writeText(text);
          setCopied("prompt");
          if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
          copyTimeoutRef.current = setTimeout(() => setCopied(""), 1600);
        }
        return;
      }

      // Ctrl/Cmd + H → Toggle history
      if (e.key === "h" || e.key === "H") {
        // Don't capture if user is typing in an input/textarea
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        setShowHistory((prev) => !prev);
        setHistory(getHistory());
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEnoughContext, isLoading, isCoolingDown, isGuidedModeEnabled, isGuided, result, outputMode]);

  async function requestClarifications() {
    if (!hasEnoughContext || isCoolingDown) {
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
      setCustomAnswers({});
    } catch {
      setError("Guided Mode could not start. Try direct generation.");
    } finally {
      setIsClarifying(false);
    }
  }

  async function generatePrompt() {
    if (!hasEnoughContext || isCoolingDown) {
      return;
    }

    setIsLoading(true);
    setError("");
    setCopied("");
    setOutputMode("chat");
    setRefineInput("");

    try {
      // URL Context Injection: extract page content if a URL is detected
      let urlContext = extractedContext;
      if (detectedUrl && !urlContext) {
        try {
          setIsExtracting(true);
          const extractRes = await fetch("/api/extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: detectedUrl }),
          });
          if (extractRes.ok) {
            const extractData = await extractRes.json();
            urlContext = `[Extracted from ${extractData.title || detectedUrl}]: ${extractData.content}`;
            setExtractedContext(urlContext);
          }
        } catch {
          // URL extraction failed silently — continue without it
        } finally {
          setIsExtracting(false);
        }
      }

      // Build clarifications payload with optional URL context
      const enrichedClarifications = urlContext
        ? [...clarifications, { question: "URL Context (auto-extracted)", answer: urlContext }]
        : clarifications;

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          clarifications: enrichedClarifications,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        handleApiError(response.status, payload);
        return;
      }

      const generatedResult = payload as DispatcherResponse;
      setResult(generatedResult);
      setActiveTab("open_source");

      // Save to local history
      saveToHistory({
        inputPrompt: trimmedPrompt,
        optimizedPrompt: generatedResult.optimized_prompt,
        recommendations: generatedResult.recommendations,
      });
      setHistory(getHistory());
    } catch {
      setError("Generation failed. Give it another run in a moment.");
    } finally {
      setIsLoading(false);
    }
  }

  async function refinePrompt() {
    if (!result || !refineInput.trim() || isRefining) return;

    setIsRefining(true);
    setError("");

    try {
      const response = await fetch("/api/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPrompt: result.optimized_prompt,
          instruction: refineInput.trim(),
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        handleApiError(response.status, payload);
        return;
      }

      // Update the result in-place
      setResult((prev) =>
        prev ? { ...prev, optimized_prompt: payload.refined_prompt } : prev,
      );
      setRefineInput("");

      // Update history with the refined version
      saveToHistory({
        inputPrompt: trimmedPrompt,
        optimizedPrompt: payload.refined_prompt,
        recommendations: result.recommendations,
      });
      setHistory(getHistory());
    } catch {
      setError("Refinement failed. Try again in a moment.");
    } finally {
      setIsRefining(false);
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
    setCustomAnswers((current) => ({
      ...current,
      [questionId]: "",
    }));
  }

  function updateCustomAnswer(questionId: string, value: string) {
    setCustomAnswers((current) => ({
      ...current,
      [questionId]: value,
    }));
    setAnswers((current) => {
      const next = { ...current };

      if (value.trim()) {
        next[questionId] = value.trim();
      } else {
        delete next[questionId];
      }

      return next;
    });
  }

  function resetGuidedMode() {
    setQuestions([]);
    setAnswers({});
    setCustomAnswers({});
  }

  async function copyText(label: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = setTimeout(() => setCopied(""), 1600);
  }

  async function copyAndOpen(recommendation: Recommendation) {
    if (result) {
      await copyText(recommendation.model_name, result.optimized_prompt);
    }

    window.open(recommendation.platform_url, "_blank", "noopener,noreferrer");
  }

  async function sharePrompt() {
    if (!result) return;
    const hash = encodePromptToHash(result.optimized_prompt);
    const shareUrl = `${window.location.origin}${window.location.pathname}${hash}`;
    await navigator.clipboard.writeText(shareUrl);
    setCopied("share");
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(""), 2000);
  }

  function loadFromHistory(entry: HistoryEntry) {
    setResult({
      optimized_prompt: entry.optimizedPrompt,
      recommendations: entry.recommendations as Record<RecommendationTier, Recommendation>,
    });
    setPrompt(entry.inputPrompt);
    setActiveTab("open_source");
    setShowHistory(false);
    setOutputMode("chat");
  }

  function getApiModeOutput(): string {
    if (!result) return "";
    const activeRec = result.recommendations[activeTab];
    return JSON.stringify(
      {
        model: activeRec?.model_name || "recommended-model",
        messages: [
          { role: "system", content: result.optimized_prompt },
          { role: "user", content: "Execute the task described above." },
        ],
      },
      null,
      2,
    );
  }

  const activeRecommendation = result?.recommendations[activeTab];

  return (
    <main className="min-h-screen overflow-x-hidden transition-colors">
      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-6 pb-40 sm:px-6 sm:pb-6 lg:px-8">
        
        {/* Contained Static Banner */}
        <div className="relative mb-8 flex min-h-[38px] w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-r from-emerald-600/10 via-emerald-500/10 to-teal-600/10 border border-emerald-500/20 shadow-sm backdrop-blur-md dark:from-emerald-950/40 dark:via-emerald-900/40 dark:to-teal-900/40 dark:border-emerald-500/10">
          <div className="flex items-center px-4 py-2 text-center text-sm font-medium tracking-wide text-emerald-800 dark:text-emerald-300 sm:text-base">
            <span className="mr-2">🍉</span>
            <span>Unforgotten. Unbroken. Free Palestine. Every Life is a Story Worth Telling.</span>
            <span className="ml-2">🍉</span>
          </div>
        </div>

        <motion.header
          variants={fadeUp}
          initial="initial"
          animate="animate"
          transition={{ duration: 0.45, type: "spring", stiffness: 400, damping: 30 }}
          className="flex items-center justify-between"
        >
          <div className="inline-flex h-10 items-center gap-2 rounded-full border border-black/[0.05] bg-white/80 px-4 text-sm font-semibold shadow-sm shadow-slate-200/60 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70 dark:shadow-black/20">
            <span className="text-base leading-none">🤖</span>
            AI Prompt Generator
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setShowHistory(!showHistory); setHistory(getHistory()); }}
              className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/[0.05] bg-white/70 shadow-sm backdrop-blur-md transition hover:bg-black/[0.03] dark:border-white/[0.08] dark:bg-black/50 dark:hover:bg-white/[0.06]"
              aria-label="Prompt history"
            >
              <History className="h-4 w-4 text-slate-600 dark:text-slate-300" />
              {history.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">
                  {history.length}
                </span>
              )}
            </button>
            <ThemeToggle />
          </div>
        </motion.header>

        {/* History Drawer */}
        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, type: "spring", stiffness: 400, damping: 30 }}
              className="mt-4 overflow-hidden rounded-[2rem] border border-black/[0.05] bg-white/80 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-black/40 dark:shadow-black/20"
            >
              <div className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">History</p>
                    <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950 dark:text-white">Past Generations</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    {history.length > 0 && (
                      <button
                        type="button"
                        onClick={() => { clearHistory(); setHistory([]); }}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Clear
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowHistory(false)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-black/[0.04] dark:text-slate-400 dark:hover:bg-white/[0.06]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {history.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No prompt history yet. Generate your first prompt!</p>
                ) : (
                  <div className="mt-4 grid gap-2">
                    {history.map((entry) => (
                      <button
                        type="button"
                        key={entry.id}
                        onClick={() => loadFromHistory(entry)}
                        className="group rounded-xl border border-black/[0.05] bg-black/[0.02] p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/50 dark:border-white/[0.06] dark:bg-[#1c1c1e] dark:hover:border-blue-700 dark:hover:bg-blue-950/20"
                      >
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 line-clamp-1">
                          {entry.inputPrompt}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
                          {entry.optimizedPrompt.slice(0, 80)}...
                        </p>
                        <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                          {new Date(entry.timestamp).toLocaleString()}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Shared Prompt View (from URL hash) */}
        <AnimatePresence>
          {sharedPrompt && !result && (
            <motion.section
              variants={fadeUp}
              initial="initial"
              animate="animate"
              exit="exit"
              className="mx-auto mt-8 w-full max-w-4xl rounded-[2rem] border border-blue-200 bg-blue-50/50 p-6 shadow-sm dark:border-blue-900/40 dark:bg-blue-950/20"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">Shared Prompt</p>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950 dark:text-white">Someone shared this with you</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => copyText("shared", sharedPrompt)}
                    className="inline-flex h-9 items-center gap-2 rounded-xl border border-black/[0.05] bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-black/[0.02] dark:border-white/[0.08] dark:bg-[#1c1c1e] dark:text-slate-300"
                  >
                    <Clipboard className="h-4 w-4" />
                    {copied === "shared" ? "Copied" : "Copy"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSharedPrompt(null)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-black/[0.04] dark:text-slate-400 dark:hover:bg-white/[0.06]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <pre className="mt-4 whitespace-pre-wrap break-words rounded-xl border border-black/[0.05] bg-white/80 p-4 font-sans text-sm leading-relaxed text-slate-800 dark:border-white/[0.08] dark:bg-black/40 dark:text-slate-200">
                {sharedPrompt}
              </pre>
            </motion.section>
          )}
        </AnimatePresence>

        <section className="flex flex-1 flex-col justify-center py-10">
          <motion.div
            variants={fadeUp}
            initial="initial"
            animate="animate"
            transition={{ delay: 0.05, duration: 0.5, type: "spring", stiffness: 400, damping: 30 }}
            className="mx-auto max-w-3xl text-center"
          >
            <div className="mb-6 flex items-center justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-400">
                <Info className="h-3.5 w-3.5" />
                Prompt Generator, Not a Chatbot
              </span>
            </div>
            <p className="text-sm font-medium uppercase tracking-[0.28em] text-blue-600 dark:text-blue-400">
              Prompt engine
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
            transition={{ delay: 0.12, duration: 0.5, type: "spring", stiffness: 400, damping: 30 }}
            className="mx-auto mt-10 mb-20 sm:mb-0 w-full max-w-4xl rounded-[2rem] border border-black/[0.05] bg-white/70 p-6 shadow-xl shadow-black/[0.03] backdrop-blur-2xl sm:p-10 dark:border-white/[0.08] dark:bg-black/50 dark:shadow-black/50"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <label
                  htmlFor="prompt"
                  className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400"
                >
                  Intent
                </label>
                <h2 className="mt-2 text-xl sm:text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                  Feeling lazy? Write your vague prompt here
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
              onChange={(event) => setPrompt(event.target.value)}
              onFocus={() => {
                // On mobile, wait for keyboard to fully open, then scroll the buttons into view so they 'bump up'
                if (window.innerWidth < 640) {
                  setTimeout(() => {
                    document.getElementById('action-buttons')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }, 400);
                }
              }}
              placeholder="Example: build a subscription dashboard for a solo founder"
              className="mt-5 min-h-[120px] sm:min-h-[170px] w-full resize-none rounded-2xl border border-black/[0.06] bg-white/90 shadow-inner p-5 text-base leading-relaxed text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-500/10 dark:border-white/[0.1] dark:bg-[#1c1c1e] dark:text-white dark:placeholder:text-slate-600 dark:focus:border-blue-500 dark:focus:bg-gray-950"
            />
            <AnimatePresence>
              {hasPrompt && !hasEnoughContext ? (
                <motion.p
                  variants={fadeUp}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="mt-3 text-sm font-medium text-amber-600 dark:text-amber-400"
                >
                  Add a bit more detail — describe what you want to build or accomplish.
                </motion.p>
              ) : null}
            </AnimatePresence>

            {/* URL Detection Badge */}
            <AnimatePresence>
              {detectedUrl && (
                <motion.div
                  variants={fadeUp}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="mt-3 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300"
                >
                  <Globe className="h-3.5 w-3.5" />
                  {isExtracting ? "Extracting page content..." : "URL detected — context will be injected"}
                </motion.div>
              )}
            </AnimatePresence>

            {!isGuided && (
              <div className="mt-5 flex items-center justify-between rounded-xl bg-black/[0.04] p-1.5 dark:bg-white/[0.04]">
                <button
                  type="button"
                  onClick={() => setIsGuidedModeEnabled(false)}
                  className={cn(
                    "flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all duration-200",
                    !isGuidedModeEnabled
                      ? "bg-white text-slate-900 shadow-sm dark:bg-[#1c1c1e] dark:text-white"
                      : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  )}
                >
                  Fast Generation
                </button>
                <button
                  type="button"
                  onClick={() => setIsGuidedModeEnabled(true)}
                  className={cn(
                    "flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all duration-200",
                    isGuidedModeEnabled
                      ? "bg-white text-slate-900 shadow-sm dark:bg-[#1c1c1e] dark:text-white"
                      : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  )}
                >
                  Guided Mode
                </button>
              </div>
            )}

            <div id="action-buttons" className="mt-4 flex flex-col gap-3 sm:flex-row">
              {isGuidedModeEnabled && !isGuided ? (
                <button
                  type="button"
                  onClick={requestClarifications}
                  disabled={!hasEnoughContext || isClarifying || isLoading || isCoolingDown}
                  className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 text-base font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:-translate-y-0.5 hover:bg-blue-500 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-slate-400 dark:shadow-blue-900/20"
                >
                  {isClarifying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
                  {isCoolingDown ? `Wait ${cooldownTimer}s` : "Start Guided Mode"}
                </button>
              ) : (
                <AnimatePresence mode="wait">
                  {showGenerateButton ? (
                    <motion.button
                      key="generate"
                      type="button"
                      onClick={generatePrompt}
                      disabled={!hasEnoughContext || isClarifying || isLoading || isCoolingDown}
                      initial={{ opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.98 }}
                      transition={{ duration: 0.22, type: "spring", stiffness: 400, damping: 30 }}
                      className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 text-base font-semibold text-white shadow-lg shadow-slate-950/15 transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-slate-400 dark:bg-white dark:text-slate-950 dark:shadow-white/10 dark:hover:bg-slate-200"
                    >
                      {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                      {isCoolingDown ? `Wait ${cooldownTimer}s` : "Generate Prompt"}
                    </motion.button>
                  ) : null}
                </AnimatePresence>
              )}
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
                  className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium leading-relaxed text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-300"
                >
                  {error}
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* Keyboard Shortcuts Hint — desktop only */}
            <div className="mt-5 hidden items-center justify-center gap-5 text-[11px] font-medium text-slate-400 dark:text-slate-500 sm:flex">
              <span><kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800">⌘/Ctrl</kbd> + <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800">Enter</kbd> Generate</span>
              <span><kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800">⌘/Ctrl</kbd> + <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800">⇧ C</kbd> Copy</span>
              <span><kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800">⌘/Ctrl</kbd> + <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800">H</kbd> History</span>
            </div>
          </motion.section>

          <AnimatePresence>
            {questions.length ? (
              <motion.section
                variants={fadeUp}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.32, type: "spring", stiffness: 400, damping: 30 }}
                className="mx-auto mt-5 w-full max-w-4xl overflow-hidden rounded-[2rem] border border-black/[0.05] bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl sm:p-10 dark:border-white/[0.08] dark:bg-black/40 dark:shadow-black/20"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">
                      Guided Mode
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                      Tighten the brief.
                    </h2>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full border border-black/[0.05] bg-black/[0.02] px-4 py-2 text-sm font-semibold text-slate-600 dark:border-white/[0.08] dark:bg-[#1c1c1e] dark:text-slate-300">
                      {selectedCount}/{guidedStepCount}
                    </span>
                    <button
                      type="button"
                      onClick={resetGuidedMode}
                      className="rounded-full border border-black/[0.05] bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-black/[0.02] dark:border-white/[0.08] dark:bg-[#1c1c1e] dark:text-slate-300 dark:hover:bg-black/40"
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
                      className="rounded-2xl border border-black/[0.06] bg-white/90 shadow-inner p-4 dark:border-white/[0.08] dark:bg-[#1c1c1e]"
                    >
                      <p className="font-medium leading-relaxed text-slate-950 dark:text-white">
                        {question.question}
                      </p>
                      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {question.options.map((option) => {
                          const isSelected = answers[question.id] === option;

                          return (
                            <button
                              type="button"
                              key={option}
                              onClick={() => chooseAnswer(question.id, option)}
                              className={cn(
                                "min-h-12 rounded-2xl border px-3 py-2 text-left text-sm font-medium leading-relaxed transition",
                                isSelected
                                  ? "border-blue-400 bg-blue-50 text-blue-900 shadow-sm shadow-blue-500/10 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-100"
                                  : "border-black/[0.05] bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50/60 dark:border-white/[0.08] dark:bg-[#1c1c1e] dark:text-slate-300 dark:hover:border-blue-700 dark:hover:bg-blue-950/20",
                              )}
                            >
                              <span className="inline-flex items-center gap-2">
                                {isSelected ? <Check className="h-4 w-4" /> : null}
                                {option}
                              </span>
                            </button>
                          );
                        })}
                        <input
                          value={customAnswers[question.id] ?? ""}
                          onChange={(event) => updateCustomAnswer(question.id, event.target.value)}
                          placeholder="Custom answer..."
                          className={cn(
                            "min-h-12 rounded-2xl border px-3 py-2 text-sm font-medium leading-relaxed outline-none transition",
                            customAnswers[question.id]?.trim()
                              ? "border-blue-400 bg-blue-50 text-blue-900 shadow-sm shadow-blue-500/10 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-100"
                              : "border-black/[0.05] bg-white text-slate-700 placeholder:text-slate-400 hover:border-blue-300 focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-[#1c1c1e] dark:text-slate-300 dark:placeholder:text-slate-600 dark:hover:border-blue-700",
                          )}
                        />
                      </div>
                    </motion.div>
                  ))}
                
                {hasCompletedGuidedFlow && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-6 flex justify-end border-t border-black/5 pt-6 dark:border-white/10"
                  >
                    <button
                      type="button"
                      onClick={generatePrompt}
                      disabled={!hasEnoughContext || isClarifying || isLoading || isCoolingDown}
                      className="inline-flex h-12 w-full sm:w-auto px-8 items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-semibold text-white shadow-lg shadow-slate-950/15 transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-slate-400 dark:bg-white dark:text-slate-950 dark:shadow-white/10 dark:hover:bg-slate-200"
                    >
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      {isCoolingDown ? `Wait ${cooldownTimer}s` : "Generate Prompt"}
                    </button>
                  </motion.div>
                )}
  
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
                transition={{ duration: 0.35, type: "spring", stiffness: 400, damping: 30 }}
                className="mx-auto mt-5 grid w-full max-w-4xl gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]"
              >
                <div className="rounded-[2rem] border border-black/[0.05] bg-white/80 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl dark:border-gray-800 dark:bg-black/40 dark:shadow-black/20">
                  <div className="flex flex-col gap-3">
                    {/* Header row */}
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">
                          Output
                        </p>
                        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                          Master prompt
                        </h2>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Share Button */}
                        <button
                          type="button"
                          onClick={sharePrompt}
                          disabled={!result}
                          className="inline-flex h-10 items-center gap-2 rounded-2xl border border-black/[0.05] bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-black/[0.02] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-[#1c1c1e] dark:text-slate-300 dark:hover:bg-black/40"
                        >
                          <Link2 className="h-4 w-4" />
                          {copied === "share" ? "Link copied!" : "Share"}
                        </button>
                        {/* Copy Button */}
                        <button
                          type="button"
                          onClick={() => {
                            if (!result) return;
                            const text = outputMode === "api" ? getApiModeOutput() : result.optimized_prompt;
                            copyText("prompt", text);
                          }}
                          disabled={!result}
                          className="inline-flex h-10 items-center gap-2 rounded-2xl border border-black/[0.05] bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-black/[0.02] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-[#1c1c1e] dark:text-slate-300 dark:hover:bg-black/40"
                        >
                          <Clipboard className="h-4 w-4" />
                          {copied === "prompt" ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>

                    {/* Developer Mode Toggle */}
                    {result && (
                      <div className="flex items-center justify-between rounded-xl bg-black/[0.04] p-1.5 dark:bg-white/[0.04]">
                        <button
                          type="button"
                          onClick={() => setOutputMode("chat")}
                          className={cn(
                            "flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-all duration-200",
                            outputMode === "chat"
                              ? "bg-white text-slate-900 shadow-sm dark:bg-[#1c1c1e] dark:text-white"
                              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                          )}
                        >
                          <MessageSquare className="h-3.5 w-3.5" /> Chat Mode
                        </button>
                        <button
                          type="button"
                          onClick={() => setOutputMode("api")}
                          className={cn(
                            "flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-all duration-200",
                            outputMode === "api"
                              ? "bg-white text-slate-900 shadow-sm dark:bg-[#1c1c1e] dark:text-white"
                              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                          )}
                        >
                          <Code2 className="h-3.5 w-3.5" /> API Mode
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Prompt Output */}
                  <div className="mt-5 min-h-[340px] overflow-auto rounded-2xl border border-black/[0.05] bg-black/[0.02] p-5 dark:border-white/[0.08] dark:bg-black/60">
                    {isLoading ? (
                      <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 text-center text-slate-500 dark:text-slate-400">
                        <RefreshCw className="h-7 w-7 animate-spin text-blue-500" />
                        <p className="font-medium">Generating a structured RTCFC prompt.</p>
                      </div>
                    ) : result ? (
                      <pre className={cn(
                        "whitespace-pre-wrap break-words font-sans text-sm leading-relaxed",
                        outputMode === "api"
                          ? "font-mono text-emerald-700 dark:text-emerald-300"
                          : "text-slate-800 dark:text-slate-200"
                      )}>
                        {outputMode === "api" ? getApiModeOutput() : result.optimized_prompt}
                      </pre>
                    ) : null}
                  </div>

                  {/* Tweak It — Refinement Input */}
                  {result && !isLoading && (
                    <div className="mt-4 flex items-center gap-2">
                      <input
                        type="text"
                        value={refineInput}
                        onChange={(e) => setRefineInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") refinePrompt(); }}
                        placeholder="Refine: e.g., make it shorter, add error handling..."
                        className="flex-1 rounded-xl border border-black/[0.06] bg-white/90 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:border-white/[0.1] dark:bg-[#1c1c1e] dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-500"
                      />
                      <button
                        type="button"
                        onClick={refinePrompt}
                        disabled={!refineInput.trim() || isRefining}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
                      >
                        {isRefining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </button>
                    </div>
                  )}
                </div>

                <div className="rounded-[2rem] border border-black/[0.05] bg-white/80 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl dark:border-gray-800 dark:bg-black/40 dark:shadow-black/20">
                  <p className="text-sm font-medium uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">
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
                          disabled={!result || isLoading}
                          className={cn(
                            "rounded-2xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50",
                            isActive
                              ? "border-blue-400 bg-blue-50 text-blue-950 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-50"
                              : "border-black/[0.05] bg-black/[0.02] text-slate-700 hover:border-blue-300 dark:border-white/[0.1] dark:bg-[#1c1c1e] dark:text-slate-300 dark:hover:border-blue-700",
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

                  <div className="mt-4 rounded-2xl border border-black/[0.05] bg-black/[0.02] p-4 dark:border-white/[0.08] dark:bg-black/60">
                    {activeRecommendation ? (
                      <div className="flex flex-col gap-4">
                        <div>
                          <h3 className="text-lg font-semibold tracking-tight text-slate-950 dark:text-white">
                            {activeRecommendation.model_name}
                          </h3>
                          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                            {activeRecommendation.reasoning}
                          </p>
                          <p className="mt-1 break-words text-xs leading-relaxed text-slate-400 dark:text-slate-500">
                            {activeRecommendation.platform_url}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyAndOpen(activeRecommendation)}
                          disabled={isLoading}
                          className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
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

        <footer className="mt-auto py-6 text-center">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            Developed by{" "}
            <a
              href="https://github.com/Nidan73"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-slate-900 transition hover:text-blue-600 dark:text-slate-200 dark:hover:text-blue-400"
            >
              Nidan Alam
            </a>
          </p>
        </footer>
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
      className="relative inline-flex h-10 w-[72px] items-center rounded-full border border-black/[0.05] bg-white/70 p-1 shadow-sm backdrop-blur-md transition dark:border-white/[0.08] dark:bg-black/50"
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        className={cn(
          "absolute top-1 flex h-8 w-8 items-center justify-center rounded-full shadow-sm",
          isDark
            ? "left-[34px] bg-slate-800 text-blue-200"
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
