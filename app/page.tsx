import Link from "next/link";
import { Info } from "lucide-react";
import { PromptWorkbench } from "@/components/home/prompt-workbench";
import { APP_VERSION } from "@/lib/version";

export default function Home() {
  return (
    <PromptWorkbench
      banner={
        <>
          {/* Contained Static Banner */}
          <div className="relative mb-8 flex min-h-[38px] w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-r from-emerald-600/10 via-emerald-500/10 to-teal-600/10 border border-emerald-500/20 shadow-sm backdrop-blur-md dark:from-emerald-950/40 dark:via-emerald-900/40 dark:to-teal-900/40 dark:border-emerald-500/10">
            <div className="flex items-center px-4 py-2 text-center text-sm font-medium tracking-wide text-emerald-800 dark:text-emerald-300 sm:text-base">
              <span className="mr-2">🍉</span>
              <span>Unforgotten. Unbroken. Free Palestine. Every Life is a Story Worth Telling.</span>
              <span className="ml-2">🍉</span>
            </div>
          </div>
        </>
      }
      hero={
        <div className="animate-fade-up mx-auto max-w-3xl text-center" style={{ animationDelay: "0.05s" }}>
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
            Stop writing generic prompts. Our engine detects your intent, wraps it in a specialized structural framework, and routes it directly to the state-of-the-art AI model that excels at it.
          </p>
        </div>
      }
      footer={
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
            <span className="mx-2 opacity-30">•</span>
            <Link
              href="/privacy"
              className="font-semibold text-slate-900 transition hover:text-blue-600 dark:text-slate-200 dark:hover:text-blue-400"
            >
              Privacy
            </Link>
            <span className="mx-2 opacity-30">•</span>
            <span className="text-xs tracking-wider opacity-60">v{APP_VERSION}</span>
          </p>
        </footer>
      }
    />
  );
}
