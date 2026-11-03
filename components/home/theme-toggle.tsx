"use client";

import { AnimatePresence, m } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/cn";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="relative inline-flex h-10 w-[72px] items-center rounded-full border border-black/[0.05] bg-white/70 p-1 shadow-sm backdrop-blur-md transition dark:border-white/[0.08] dark:bg-black/50"
    >
      <m.span
        // x instead of layout: layout animations are not in the lazy domAnimation bundle.
        initial={false}
        animate={{ x: isDark ? 30 : 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        className={cn(
          "absolute left-1 top-1 flex h-8 w-8 items-center justify-center rounded-full shadow-sm",
          isDark ? "bg-slate-800 text-blue-200" : "bg-slate-950 text-amber-300",
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {isDark ? (
            <m.span
              key="moon"
              initial={{ opacity: 0, rotate: -35, scale: 0.8 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: 35, scale: 0.8 }}
            >
              <Moon className="h-4 w-4" />
            </m.span>
          ) : (
            <m.span
              key="sun"
              initial={{ opacity: 0, rotate: 35, scale: 0.8 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: -35, scale: 0.8 }}
            >
              <Sun className="h-4 w-4" />
            </m.span>
          )}
        </AnimatePresence>
      </m.span>
    </button>
  );
}
