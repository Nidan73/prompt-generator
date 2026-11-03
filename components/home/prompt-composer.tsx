"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Globe, Loader2, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { PROMPT_MAX_CHARS } from "@/lib/limits";
import { fadeUp } from "./fade-up";

type PromptComposerProps = {
  prompt: string;
  onPromptChange: (value: string) => void;
  isCoolingDown: boolean;
  cooldownTimer: number;
  isPromptTooLong: boolean;
  hasPrompt: boolean;
  hasEnoughContext: boolean;
  detectedUrl: string | null;
  isExtracting: boolean;
  isGuided: boolean;
  isGuidedModeEnabled: boolean;
  onGuidedModeChange: (enabled: boolean) => void;
  isClarifying: boolean;
  isCurrentlyLoading: boolean;
  isGenerateDisabled: boolean;
  showGenerateButton: boolean;
  hasCompletedGuidedFlow: boolean;
  error: string;
  onRequestClarifications: () => void;
  onGenerate: () => void;
};

export function PromptComposer({
  prompt,
  onPromptChange,
  isCoolingDown,
  cooldownTimer,
  isPromptTooLong,
  hasPrompt,
  hasEnoughContext,
  detectedUrl,
  isExtracting,
  isGuided,
  isGuidedModeEnabled,
  onGuidedModeChange,
  isClarifying,
  isCurrentlyLoading,
  isGenerateDisabled,
  showGenerateButton,
  hasCompletedGuidedFlow,
  error,
  onRequestClarifications,
  onGenerate,
}: PromptComposerProps) {
  return (
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-10 items-center rounded-full border border-black/[0.05] bg-white/70 px-4 text-sm font-semibold text-slate-500 dark:border-white/[0.08] dark:bg-[#1c1c1e] dark:text-slate-400">
            {prompt.length}/{PROMPT_MAX_CHARS}
          </span>
          {isCoolingDown ? (
            <div className="inline-flex h-10 items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-300">
              <AlertCircle className="h-4 w-4" />
              {cooldownTimer}s cooldown
            </div>
          ) : null}
        </div>
      </div>

      <textarea
        id="prompt"
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        onFocus={() => {
          // On mobile, wait for keyboard to fully open, then scroll the buttons into view so they 'bump up'
          if (window.innerWidth < 640) {
            setTimeout(() => {
              document.getElementById('action-buttons')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 400);
          }
        }}
        placeholder="Example: Build a chrome extension that will help me to track my time"
        className="mt-5 min-h-[120px] sm:min-h-[170px] w-full resize-none rounded-2xl border border-black/[0.06] bg-white/90 shadow-inner p-5 text-base leading-relaxed text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-500/10 dark:border-white/[0.1] dark:bg-[#1c1c1e] dark:text-white dark:placeholder:text-slate-600 dark:focus:border-blue-500 dark:focus:bg-gray-950"
      />
      <AnimatePresence>
        {isPromptTooLong ? (
          <motion.p
            variants={fadeUp}
            initial="initial"
            animate="animate"
            exit="exit"
            className="mt-3 text-sm font-medium text-amber-600 dark:text-amber-400"
          >
            Keep the rough prompt under {PROMPT_MAX_CHARS} characters.
          </motion.p>
        ) : hasPrompt && !hasEnoughContext ? (
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
            onClick={() => onGuidedModeChange(false)}
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
            onClick={() => onGuidedModeChange(true)}
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
            onClick={onRequestClarifications}
            disabled={isGenerateDisabled}
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
                onClick={onGenerate}
                disabled={isGenerateDisabled}
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.22, type: "spring", stiffness: 400, damping: 30 }}
                className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 text-base font-semibold text-white shadow-lg shadow-slate-950/15 transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-slate-400 dark:bg-white dark:text-slate-950 dark:shadow-white/10 dark:hover:bg-slate-200"
              >
                {isCurrentlyLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
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

      {/* Keyboard shortcuts hint, desktop only */}
      <div className="mt-5 hidden items-center justify-center gap-5 text-[11px] font-medium text-slate-400 dark:text-slate-500 sm:flex">
        <span><kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800">⌘/Ctrl</kbd> + <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800">Enter</kbd> Generate</span>
        <span><kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800">⌘/Ctrl</kbd> + <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800">⇧ C</kbd> Copy</span>
        <span><kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800">⌘/Ctrl</kbd> + <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800">H</kbd> History</span>
      </div>
    </motion.section>
  );
}
