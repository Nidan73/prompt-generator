"use client";

import type { Dispatch, SetStateAction } from "react";
import { experimental_useObject as useObject, useCompletion } from "@ai-sdk/react";
import { GenerateSchemaObject } from "@/lib/generate-schema";
import { resolveRecommendations } from "@/lib/platform-registry";
import { saveToHistory, getHistory, type HistoryEntry } from "@/lib/prompt-history";
import type { DispatcherResponse } from "./types";

type RoutingPick = {
  platform_id: string;
  model_name: string;
  reasoning: string;
};

type GenerateStreamObject = {
  optimized_prompt?: string;
  routing?: Record<string, RoutingPick>;
};

type PromptStreamsOptions = {
  result: DispatcherResponse | null;
  trimmedPrompt: string;
  setResult: Dispatch<SetStateAction<DispatcherResponse | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setHistory: Dispatch<SetStateAction<HistoryEntry[]>>;
  setRefineInput: Dispatch<SetStateAction<string>>;
};

// The two AI SDK streaming hooks, plus the prompt and recommendations to show while they stream.
export function usePromptStreams({
  result,
  trimmedPrompt,
  setResult,
  setError,
  setHistory,
  setRefineInput,
}: PromptStreamsOptions) {
  const {
    object: generateObject,
    submit: submitGenerate,
    isLoading: isGeneratingStream,
  } = useObject({
    api: "/api/generate",
    schema: GenerateSchemaObject,
    onFinish: ({ object }) => {
      const optimizedPrompt = object?.optimized_prompt?.trim();
      // A provider that dies mid-stream closes cleanly, so the response is a 200
      // carrying truncated JSON and this lands with no usable prompt. Returning
      // quietly left the spinner to stop with nothing on screen and no error.
      if (!optimizedPrompt) {
        setError("The model stopped before finishing. Give it another run.");
        return;
      }

      const resolvedRecs = resolveRecommendations(
        (object?.routing ?? {}) as Record<string, RoutingPick>,
      );
      const finalResult = {
        optimized_prompt: optimizedPrompt,
        recommendations: resolvedRecs,
      };

      setResult(finalResult);
      saveToHistory({
        inputPrompt: trimmedPrompt,
        optimizedPrompt,
        recommendations: resolvedRecs,
      });
      setHistory(getHistory());
    },
    onError: () => {
      setError("Generation failed. Give it another run in a moment.");
    }
  });

  const {
    completion: refineCompletion,
    complete: submitRefine,
    isLoading: isRefiningStream
  } = useCompletion({
    api: "/api/refine",
    streamProtocol: "text",
    onFinish: (_prompt, completion) => {
      if (result) {
        const finalResult = { ...result, optimized_prompt: completion };
        setResult(finalResult);
        saveToHistory({
          inputPrompt: trimmedPrompt,
          optimizedPrompt: completion,
          recommendations: result.recommendations,
        });
        setHistory(getHistory());
      }
      setRefineInput("");
    },
    onError: () => {
      setError("Refinement failed. Try again in a moment.");
    }
  });

  const generatedStreamObject = isGeneratingStream
    ? (generateObject as GenerateStreamObject | null | undefined)
    : null;
  const generatedRecommendations = generatedStreamObject?.routing
    ? resolveRecommendations(generatedStreamObject.routing)
    : null;
  const displayPrompt = isRefiningStream
    ? refineCompletion || result?.optimized_prompt || ""
    : generatedStreamObject?.optimized_prompt || result?.optimized_prompt || "";
  const displayRecommendations = generatedRecommendations ?? result?.recommendations ?? null;
  const displayResult = displayPrompt && displayRecommendations
    ? {
        optimized_prompt: displayPrompt,
        recommendations: displayRecommendations,
      }
    : result;

  return {
    submitGenerate,
    submitRefine,
    isGeneratingStream,
    isRefiningStream,
    displayPrompt,
    displayRecommendations,
    displayResult,
  };
}
