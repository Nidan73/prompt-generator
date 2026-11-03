"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getHistory, clearHistory, type HistoryEntry } from "@/lib/prompt-history";
import { buildApiModeOutput } from "@/lib/api-mode";
import { PROMPT_MAX_CHARS } from "@/lib/limits";
import { GuidedQuestions } from "./guided-questions";
import { HistoryDrawer } from "./history-drawer";
import { OutputPanel } from "./output-panel";
import { PromptComposer } from "./prompt-composer";
import { RoutingPanel } from "./routing-panel";
import { SharedPromptPanel } from "./shared-prompt-panel";
import type { ClarifyingQuestion, DispatcherResponse, Recommendation, RecommendationTier } from "./types";
import { useClipboardActions } from "./use-clipboard-actions";
import { useCooldown } from "./use-cooldown";
import { useGuidedMode } from "./use-guided-mode";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";
import { usePromptStreams } from "./use-prompt-streams";
import { useSharedPrompt } from "./use-shared-prompt";
import { WorkbenchHeader } from "./workbench-header";

type PromptWorkbenchProps = {
  // Server-rendered sections that sit around and between the interactive parts.
  banner: ReactNode;
  hero: ReactNode;
  footer: ReactNode;
};

export function PromptWorkbench({ banner, hero, footer }: PromptWorkbenchProps) {
  const [prompt, setPrompt] = useState("");
  const {
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
  } = useGuidedMode();
  const [result, setResult] = useState<DispatcherResponse | null>(null);
  const { copied, setCopied, copyTimeoutRef, copyText, copyAndOpen, sharePrompt } = useClipboardActions(result);
  const { sharedPrompt, dismissSharedPrompt } = useSharedPrompt();
  const [activeTab, setActiveTab] = useState<RecommendationTier>("open_source");
  const [isGuidedModeEnabled, setIsGuidedModeEnabled] = useState(false);
  const [isClarifying, setIsClarifying] = useState(false);
  const [isLoadingManual, setIsLoadingManual] = useState(false);
  const [error, setError] = useState("");
  const { cooldownTimer, isCoolingDown, reportApiError } = useCooldown(setError);
  // Bumped per clarify request and on Reset, so a superseded response is dropped.
  const clarifyRequestRef = useRef(0);

  // Feature: History
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Feature: Developer Mode
  const [outputMode, setOutputMode] = useState<"chat" | "api">("chat");

  // Feature: Tweak It
  const [refineInput, setRefineInput] = useState("");

  // Feature: URL Context Injection
  const [extractedContext, setExtractedContext] = useState<string | null>(null);
  const [extractedContextUrl, setExtractedContextUrl] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  const trimmedPrompt = prompt.trim();
  const detectedUrl = useMemo(() => {
    const urlMatch = trimmedPrompt.match(/https?:\/\/[^\s]+/);
    return urlMatch ? urlMatch[0] : null;
  }, [trimmedPrompt]);
  const isPromptTooLong = prompt.length > PROMPT_MAX_CHARS;
  const wordCount = trimmedPrompt ? trimmedPrompt.split(/\s+/).length : 0;
  const hasPrompt = trimmedPrompt.length > 0;
  const hasEnoughContext = wordCount >= 3 && !isPromptTooLong;

  const {
    submitGenerate,
    submitRefine,
    isGeneratingStream,
    isRefiningStream,
    displayPrompt,
    displayResult,
    displayRecommendations,
  } = usePromptStreams({ result, trimmedPrompt, setResult, setError, reportApiError, setHistory, setRefineInput });
  const isCurrentlyLoading = isLoadingManual || isGeneratingStream || isRefiningStream;
  const isGenerateDisabled = !hasEnoughContext || isClarifying || isCurrentlyLoading || isCoolingDown;

  // Load history on mount
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setHistory(getHistory());
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  useKeyboardShortcuts({
    onGenerate: generateFromShortcut,
    onCopy: copyOutput,
    onToggleHistory: () => {
      setShowHistory((open) => !open);
      setHistory(getHistory());
    },
  });

  // Same rules as the visible buttons: Guided Mode needs every question answered first.
  function generateFromShortcut() {
    if (isGenerateDisabled) return;

    if (isGuidedModeEnabled && !isGuided) {
      void requestClarifications();
    } else if (!isGuided || hasCompletedGuidedFlow) {
      void generatePrompt();
    }
  }

  async function requestClarifications() {
    if (isGenerateDisabled) {
      return;
    }

    const requestId = ++clarifyRequestRef.current;
    setIsClarifying(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmedPrompt }),
      });

      const payload = await response.json();
      if (requestId !== clarifyRequestRef.current) return;

      if (!response.ok) {
        reportApiError(
          {
            message: payload.error,
            retryAfter: response.status === 429 ? payload.retryAfter : undefined,
          },
          "The dispatcher could not complete that request.",
        );
        return;
      }

      startGuidedMode(payload as ClarifyingQuestion[]);
    } catch {
      if (requestId === clarifyRequestRef.current) {
        setError("Guided Mode could not start. Try direct generation.");
      }
    } finally {
      if (requestId === clarifyRequestRef.current) {
        setIsClarifying(false);
      }
    }
  }

  async function generatePrompt() {
    if (isGenerateDisabled) {
      return;
    }

    setIsLoadingManual(true);
    setError("");
    setCopied("");
    setOutputMode("chat");
    setRefineInput("");
    setResult(null); // Clear previous result before streaming starts

    try {
      // URL Context Injection: extract page content if a URL is detected
      let urlContext = detectedUrl && extractedContextUrl === detectedUrl ? extractedContext : null;
      if (detectedUrl && !urlContext) {
        try {
          setIsExtracting(true);
          const extractRes = await fetch("/api/extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: detectedUrl }),
          });
          if (extractRes.ok) {
            const extractData = await extractRes.json();
            urlContext = `[Extracted from ${extractData.title || detectedUrl}]: ${extractData.content}`;
            setExtractedContext(urlContext);
            setExtractedContextUrl(detectedUrl);
          }
        } catch {
          // URL extraction failed silently, continue without it
        } finally {
          setIsExtracting(false);
        }
      }

      // Build clarifications payload with optional URL context
      const enrichedClarifications = urlContext
        ? [...clarifications, { question: "URL Context (auto-extracted)", answer: urlContext }]
        : clarifications;

      // Submit to the Vercel AI SDK hook
      submitGenerate({
        prompt: trimmedPrompt,
        clarifications: enrichedClarifications,
      });

      setActiveTab("open_source");
    } catch {
      setError("Generation failed. Give it another run in a moment.");
    } finally {
      setIsLoadingManual(false);
    }
  }

  async function refinePrompt() {
    if (!result || !refineInput.trim() || isRefiningStream) return;

    setError("");

    try {
      submitRefine(refineInput.trim(), {
        body: {
          currentPrompt: result.optimized_prompt,
          instruction: refineInput.trim(),
        }
      });
    } catch {
      setError("Refinement failed. Try again in a moment.");
    }
  }


  function resetGuided() {
    // Invalidate any clarify request still in flight before clearing the questions.
    clarifyRequestRef.current += 1;
    setIsClarifying(false);
    resetGuidedMode();
  }

  function loadFromHistory(entry: HistoryEntry) {
    setResult({
      optimized_prompt: entry.optimizedPrompt,
      recommendations: entry.recommendations as Record<RecommendationTier, Recommendation>,
    });
    setPrompt(entry.inputPrompt);
    setActiveTab("open_source");
    setShowHistory(false);
    setOutputMode("chat");
  }

  function getApiModeOutput(): string {
    if (!result) return "";
    return buildApiModeOutput(result.optimized_prompt, result.recommendations[activeTab]?.model_name);
  }

  function copyOutput() {
    if (!result) return;
    const text = outputMode === "api" ? getApiModeOutput() : result.optimized_prompt;
    copyText("prompt", text);
  }

  const activeRecommendation = displayRecommendations?.[activeTab];

  return (
    <main className="min-h-screen overflow-x-hidden transition-colors">
      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-6 pb-40 sm:px-6 sm:pb-6 lg:px-8">
        {banner}

        <WorkbenchHeader
          historyCount={history.length}
          onToggleHistory={() => {
            setShowHistory(!showHistory);
            setHistory(getHistory());
          }}
        />

        <HistoryDrawer
          open={showHistory}
          history={history}
          onClear={() => {
            clearHistory();
            setHistory([]);
          }}
          onClose={() => setShowHistory(false)}
          onLoad={loadFromHistory}
        />

        <SharedPromptPanel
          sharedPrompt={sharedPrompt}
          hasResult={Boolean(result)}
          copied={copied}
          onCopy={copyText}
          onDismiss={dismissSharedPrompt}
        />

        <section className="flex flex-1 flex-col justify-center py-10">
          {hero}

          <PromptComposer
            prompt={prompt}
            onPromptChange={setPrompt}
            isCoolingDown={isCoolingDown}
            cooldownTimer={cooldownTimer}
            isPromptTooLong={isPromptTooLong}
            hasPrompt={hasPrompt}
            hasEnoughContext={hasEnoughContext}
            detectedUrl={detectedUrl}
            isExtracting={isExtracting}
            isGuided={isGuided}
            isGuidedModeEnabled={isGuidedModeEnabled}
            onGuidedModeChange={setIsGuidedModeEnabled}
            isClarifying={isClarifying}
            isCurrentlyLoading={isCurrentlyLoading}
            isGenerateDisabled={isGenerateDisabled}
            showGenerateButton={showGenerateButton}
            hasCompletedGuidedFlow={hasCompletedGuidedFlow}
            error={error}
            onRequestClarifications={requestClarifications}
            onGenerate={generatePrompt}
          />

          <GuidedQuestions
            questions={questions}
            answers={answers}
            customAnswers={customAnswers}
            hasCompletedGuidedFlow={hasCompletedGuidedFlow}
            isCurrentlyLoading={isCurrentlyLoading}
            isGenerateDisabled={isGenerateDisabled}
            isCoolingDown={isCoolingDown}
            cooldownTimer={cooldownTimer}
            onReset={resetGuided}
            onChooseAnswer={chooseAnswer}
            onUpdateCustomAnswer={updateCustomAnswer}
            onGenerate={generatePrompt}
          />

          <OutputPanel
            visible={Boolean(isCurrentlyLoading || displayResult)}
            hasResult={Boolean(result)}
            displayResult={displayResult}
            displayPrompt={displayPrompt}
            activeTab={activeTab}
            outputMode={outputMode}
            onOutputModeChange={setOutputMode}
            isCurrentlyLoading={isCurrentlyLoading}
            isRefiningStream={isRefiningStream}
            copied={copied}
            onShare={sharePrompt}
            onCopyOutput={copyOutput}
            refineInput={refineInput}
            onRefineInputChange={setRefineInput}
            onRefine={refinePrompt}
          >
            <RoutingPanel
              activeTab={activeTab}
              onTabChange={setActiveTab}
              hasResult={Boolean(result)}
              isCurrentlyLoading={isCurrentlyLoading}
              activeRecommendation={activeRecommendation}
              copied={copied}
              onCopyAndOpen={copyAndOpen}
            />
          </OutputPanel>
        </section>

        {footer}
      </div>
    </main>
  );
}
