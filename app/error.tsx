"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 shadow-sm dark:border-rose-900/70 dark:bg-rose-950/40">
        <h2 className="text-xl font-semibold text-rose-900 dark:text-rose-200">
          Something went wrong
        </h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-rose-700 dark:text-rose-300">
          An unexpected error occurred. This is usually temporary — please try
          again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-6 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
