"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clipboard, Code2, Link2, Loader2, MessageSquare, RefreshCw, Send, Square } from "lucide-react";
import { buildApiModeOutput } from "@/lib/api-mode";
import { cn } from "@/lib/cn";
import { REFINE_INSTRUCTION_MAX_CHARS } from "@/lib/limits";
import { fadeUp } from "./fade-up";
import type { DispatcherResponse, RecommendationTier } from "./types";

type OutputPanelProps = {
  visible: boolean;
  hasResult: boolean;
  displayResult: DispatcherResponse | null;
  displayPrompt: string;
  activeTab: RecommendationTier;
  outputMode: "chat" | "api";
  onOutputModeChange: (mode: "chat" | "api") => void;
  isCurrentlyLoading: boolean;
  isRefiningStream: boolean;
  isStreaming: boolean;
  onStop: () => void;
  copied: string;
  onShare: () => void;
  onCopyOutput: () => void;
  refineInput: string;
  onRefineInputChange: (value: string) => void;
  onRefine: () => void;
  // The routing panel sits beside the output card inside the same animated section.
  children: ReactNode;
};

export function OutputPanel({
  visible,
  hasResult,
  displayResult,
  displayPrompt,
  activeTab,
  outputMode,
  onOutputModeChange,
  isCurrentlyLoading,
  isRefiningStream,
  isStreaming,
  onStop,
  copied,
  onShare,
  onCopyOutput,
  refineInput,
  onRefineInputChange,
  onRefine,
  children,
}: OutputPanelProps) {
  return (
    <AnimatePresence>
      {visible && (
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
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {isStreaming && (
                    <button
                      type="button"
                      onClick={onStop}
                      className="inline-flex h-10 items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/60"
                    >
                      <Square className="h-4 w-4" />
                      Stop
                    </button>
                  )}
                  {/* Share Button */}
                  <button
                    type="button"
                    onClick={onShare}
                    disabled={!hasResult || isStreaming}
                    className="inline-flex h-10 items-center gap-2 rounded-2xl border border-black/[0.05] bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-black/[0.02] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-[#1c1c1e] dark:text-slate-300 dark:hover:bg-black/40"
                  >
                    <Link2 className="h-4 w-4" />
                    {copied === "share" ? "Link copied!" : "Share"}
                  </button>
                  {/* Copy Button */}
                  <button
                    type="button"
                    onClick={onCopyOutput}
                    disabled={!hasResult || isStreaming}
                    className="inline-flex h-10 items-center gap-2 rounded-2xl border border-black/[0.05] bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-black/[0.02] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-[#1c1c1e] dark:text-slate-300 dark:hover:bg-black/40"
                  >
                    <Clipboard className="h-4 w-4" />
                    {copied === "prompt" ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>

              {/* Developer Mode Toggle */}
              {hasResult && (
                <div className="flex items-center justify-between rounded-xl bg-black/[0.04] p-1.5 dark:bg-white/[0.04]">
                  <button
                    type="button"
                    onClick={() => onOutputModeChange("chat")}
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
                    onClick={() => onOutputModeChange("api")}
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
              {displayPrompt ? (
                <pre className={cn(
                  "whitespace-pre-wrap break-words font-sans text-sm leading-relaxed",
                  outputMode === "api" && displayResult && !isCurrentlyLoading
                    ? "font-mono text-emerald-700 dark:text-emerald-300"
                    : "text-slate-800 dark:text-slate-200"
                )}>
                  {outputMode === "api" && displayResult && !isCurrentlyLoading
                    ? buildApiModeOutput(displayResult.optimized_prompt, displayResult.recommendations[activeTab]?.model_name)
                    : displayPrompt}
                </pre>
              ) : isCurrentlyLoading ? (
                <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 text-center text-slate-500 dark:text-slate-400">
                  <RefreshCw className="h-7 w-7 animate-spin text-blue-500" />
                  <p className="font-medium">Generating a structured RTCFC prompt.</p>
                </div>
              ) : null}
            </div>

            {/* Tweak It: refinement input */}
            {hasResult && !isCurrentlyLoading && (
              <div className="mt-4 flex items-center gap-2">
                <input
                  type="text"
                  value={refineInput}
                  maxLength={REFINE_INSTRUCTION_MAX_CHARS}
                  onChange={(e) => onRefineInputChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") onRefine(); }}
                  placeholder="Refine: e.g., make it shorter, add error handling..."
                  className="flex-1 rounded-xl border border-black/[0.06] bg-white/90 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:border-white/[0.1] dark:bg-[#1c1c1e] dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={onRefine}
                  disabled={!refineInput.trim() || isRefiningStream}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
                >
                  {isRefiningStream ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            )}
          </div>
          {children}
        </motion.section>
      )}
    </AnimatePresence>
  );
}
