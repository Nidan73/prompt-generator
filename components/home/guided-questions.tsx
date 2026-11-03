"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { fadeUp } from "./fade-up";
import type { ClarifyingQuestion } from "./types";

type GuidedQuestionsProps = {
  questions: ClarifyingQuestion[];
  answers: Record<string, string>;
  customAnswers: Record<string, string>;
  hasCompletedGuidedFlow: boolean;
  isCurrentlyLoading: boolean;
  isGenerateDisabled: boolean;
  isCoolingDown: boolean;
  cooldownTimer: number;
  onReset: () => void;
  onChooseAnswer: (questionId: string, option: string) => void;
  onUpdateCustomAnswer: (questionId: string, value: string) => void;
  onGenerate: () => void;
};

export function GuidedQuestions({
  questions,
  answers,
  customAnswers,
  hasCompletedGuidedFlow,
  isCurrentlyLoading,
  isGenerateDisabled,
  isCoolingDown,
  cooldownTimer,
  onReset,
  onChooseAnswer,
  onUpdateCustomAnswer,
  onGenerate,
}: GuidedQuestionsProps) {
  const selectedCount = questions.filter((question) => answers[question.id]?.trim()).length;
  const guidedStepCount = questions.length;

  return (
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
                onClick={onReset}
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
                        onClick={() => onChooseAnswer(question.id, option)}
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
                    onChange={(event) => onUpdateCustomAnswer(question.id, event.target.value)}
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
                  onClick={onGenerate}
                  disabled={isGenerateDisabled}
                  className="inline-flex h-12 w-full sm:w-auto px-8 items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-semibold text-white shadow-lg shadow-slate-950/15 transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-slate-400 dark:bg-white dark:text-slate-950 dark:shadow-white/10 dark:hover:bg-slate-200"
                >
                  {isCurrentlyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {isCoolingDown ? `Wait ${cooldownTimer}s` : "Generate Prompt"}
                </button>
              </motion.div>
            )}
          </div>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}

