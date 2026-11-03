"use client";

import { useMemo, useState } from "react";
import type { ClarifyingQuestion } from "./types";

// Clarifying questions plus the picked and typed answers for Guided Mode.
export function useGuidedMode() {
  const [questions, setQuestions] = useState<ClarifyingQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});

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

  const isGuided = questions.length > 0;
  const answeredQuestionCount = questions.filter((question) => answers[question.id]?.trim()).length;
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

  function startGuidedMode(nextQuestions: ClarifyingQuestion[]) {
    setQuestions(nextQuestions);
    setAnswers({});
    setCustomAnswers({});
  }

  return {
    questions,
    answers,
    customAnswers,
    isGuided,
    hasCompletedGuidedFlow,
    showGenerateButton,
    clarifications,
    startGuidedMode,
    chooseAnswer,
    updateCustomAnswer,
    resetGuidedMode,
  };
}
