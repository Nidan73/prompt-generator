"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { experimental_useObject as useObject, useCompletion } from "@ai-sdk/react";
import { GenerateSchemaObject } from "@/lib/generate-schema";
import { resolveRecommendations } from "@/lib/platform-registry";
import { parseApiError, type ParsedApiError } from "@/lib/home-errors";
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
  reportApiError: (error: ParsedApiError, fallback: string) => void;
  setHistory: Dispatch<SetStateAction<HistoryEntry[]>>;
  setRefineInput: Dispatch<SetStateAction<string>>;
  onGenerated: () => void;
};

// The two AI SDK streaming hooks, plus the prompt and recommendations to show while they stream.
export function usePromptStreams({
  result,
  trimmedPrompt,
  setResult,
  setError,
  reportApiError,
  setHistory,
  setRefineInput,
  onGenerated,
}: PromptStreamsOptions) {
  const latestResultRef = useRef(result);
  useEffect(() => {
    latestResultRef.current = result;
  }, [result]);

  const {
    object: generateObject,
    submit: submitGenerate,
    isLoading: isGeneratingStream,
    stop: stopGenerate,
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
      onGenerated();
    },
    onError: (error) => {
      reportApiError(parseApiError(error), "Generation failed. Give it another run in a moment.");
    }
  });

  const {
    completion: refineCompletion,
    complete: submitRefine,
    isLoading: isRefiningStream,
    stop: stopRefine,
  } = useCompletion({
    api: "/api/refine",
    streamProtocol: "text",
    onFinish: (_prompt, completion) => {
      // The hook binds this callback when the request starts, so read the
      // result from the ref to build on the latest one.
      const current = latestResultRef.current;
      if (!current) {
        setRefineInput("");
        return;
      }

      const refined = completion.trim();
      // An empty body is a clean 200, which would otherwise blank the prompt.
      if (!refined) {
        setError("Refinement returned nothing. Your prompt is unchanged.");
        return;
      }

      setResult({ ...current, optimized_prompt: refined });
      saveToHistory({
        inputPrompt: trimmedPrompt,
        optimizedPrompt: refined,
        recommendations: current.recommendations,
      });
      setHistory(getHistory());
      setRefineInput("");
    },
    onError: (error) => {
      reportApiError(parseApiError(error), "Refinement failed. Try again in a moment.");
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
    stopGenerate,
    stopRefine,
    isGeneratingStream,
    isRefiningStream,
    displayPrompt,
    displayRecommendations,
    displayResult,
  };
}
