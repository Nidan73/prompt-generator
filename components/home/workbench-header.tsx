"use client";

import { motion } from "framer-motion";
import { History } from "lucide-react";
import { fadeUp } from "./fade-up";
import { ThemeToggle } from "./theme-toggle";

type WorkbenchHeaderProps = {
  historyCount: number;
  onToggleHistory: () => void;
};

export function WorkbenchHeader({ historyCount, onToggleHistory }: WorkbenchHeaderProps) {
  return (
    <motion.header
      variants={fadeUp}
      initial="initial"
      animate="animate"
      transition={{ duration: 0.45, type: "spring", stiffness: 400, damping: 30 }}
      className="flex items-center justify-between"
    >
      <div className="inline-flex h-10 items-center gap-2 rounded-full border border-black/[0.05] bg-white/80 px-4 text-sm font-semibold shadow-sm shadow-slate-200/60 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70 dark:shadow-black/20">
        Bhai Thik Kor<span className="text-base leading-none">😤</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleHistory}
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/[0.05] bg-white/70 shadow-sm backdrop-blur-md transition hover:bg-black/[0.03] dark:border-white/[0.08] dark:bg-black/50 dark:hover:bg-white/[0.06]"
          aria-label="Prompt history"
        >
          <History className="h-4 w-4 text-slate-600 dark:text-slate-300" />
          {historyCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">
              {historyCount}
            </span>
          )}
        </button>
        <ThemeToggle />
      </div>
    </motion.header>
  );
}
