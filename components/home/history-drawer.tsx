"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Trash2, X } from "lucide-react";
import type { HistoryEntry } from "@/lib/prompt-history";

type HistoryDrawerProps = {
  id: string;
  open: boolean;
  history: HistoryEntry[];
  // Loading an entry mid-stream would race the stream's own result.
  disabled: boolean;
  onClear: () => void;
  onClose: () => void;
  onLoad: (entry: HistoryEntry) => void;
};

export function HistoryDrawer({ id, open, history, disabled, onClear, onClose, onLoad }: HistoryDrawerProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus into the drawer when it opens so keyboard users land on its content.
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <m.div
          id={id}
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
                <h2 ref={headingRef} tabIndex={-1} className="mt-1 text-lg font-semibold tracking-tight text-slate-950 outline-none dark:text-white">Past Generations</h2>
              </div>
              <div className="flex items-center gap-2">
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={onClear}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close history"
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
                    onClick={() => onLoad(entry)}
                    disabled={disabled}
                    className="group rounded-xl disabled:cursor-not-allowed disabled:opacity-50 border border-black/[0.05] bg-black/[0.02] p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/50 dark:border-white/[0.06] dark:bg-[#1c1c1e] dark:hover:border-blue-700 dark:hover:bg-blue-950/20"
                  >
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 line-clamp-1">
                      {entry.inputPrompt}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
                      {entry.optimizedPrompt.slice(0, 80)}...
                    </p>
                    <p className="mt-1.5 text-[11px] text-slate-600 dark:text-slate-400">
                      {new Date(entry.timestamp).toLocaleString()}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
