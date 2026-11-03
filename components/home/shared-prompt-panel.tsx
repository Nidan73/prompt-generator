"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Clipboard, X } from "lucide-react";
import { fadeUp } from "./fade-up";

type SharedPromptPanelProps = {
  sharedPrompt: string | null;
  hasResult: boolean;
  copied: string;
  onCopy: (label: string, text: string) => void;
  onDismiss: () => void;
};

export function SharedPromptPanel({ sharedPrompt, hasResult, copied, onCopy, onDismiss }: SharedPromptPanelProps) {
  return (
    <AnimatePresence>
      {sharedPrompt && !hasResult && (
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
                onClick={() => onCopy("shared", sharedPrompt)}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-black/[0.05] bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-black/[0.02] dark:border-white/[0.08] dark:bg-[#1c1c1e] dark:text-slate-300"
              >
                <Clipboard className="h-4 w-4" />
                {copied === "shared" ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={onDismiss}
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
  );
}
