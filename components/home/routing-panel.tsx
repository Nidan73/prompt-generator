"use client";

import type { ComponentType } from "react";
import { ExternalLink, LockKeyhole, Search, Wand2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Recommendation, RecommendationTier } from "./types";

const tabs: Array<{
  id: RecommendationTier;
  label: string;
  eyebrow: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  {
    id: "open_source",
    label: "Open Source",
    eyebrow: "Hosted OSS",
    icon: Search,
  },
  {
    id: "freemium",
    label: "Freemium",
    eyebrow: "Low friction",
    icon: Wand2,
  },
  {
    id: "premium",
    label: "Premium",
    eyebrow: "Best result",
    icon: LockKeyhole,
  },
];

type RoutingPanelProps = {
  activeTab: RecommendationTier;
  onTabChange: (tab: RecommendationTier) => void;
  hasResult: boolean;
  isCurrentlyLoading: boolean;
  activeRecommendation: Recommendation | undefined;
  copied: string;
  onCopyAndOpen: (recommendation: Recommendation) => void;
};

export function RoutingPanel({
  activeTab,
  onTabChange,
  hasResult,
  isCurrentlyLoading,
  activeRecommendation,
  copied,
  onCopyAndOpen,
}: RoutingPanelProps) {
  return (
    <div className="rounded-[2rem] border border-black/[0.05] bg-white/80 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl dark:border-gray-800 dark:bg-black/40 dark:shadow-black/20">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">
        Routing
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
        Chat platforms
      </h2>

      <div className="mt-5 grid gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              type="button"
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              aria-pressed={isActive}
              disabled={!hasResult || isCurrentlyLoading}
              className={cn(
                "rounded-2xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50",
                isActive
                  ? "border-blue-400 bg-blue-50 text-blue-950 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-50"
                  : "border-black/[0.05] bg-black/[0.02] text-slate-700 hover:border-blue-300 dark:border-white/[0.1] dark:bg-[#1c1c1e] dark:text-slate-300 dark:hover:border-blue-700",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Icon className="h-4 w-4" />
                {tab.label}
              </span>
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                {tab.eyebrow}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-2xl border border-black/[0.05] bg-black/[0.02] p-4 dark:border-white/[0.08] dark:bg-black/60">
        {activeRecommendation ? (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-slate-950 dark:text-white">
                {activeRecommendation.model_name}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {activeRecommendation.reasoning}
              </p>
              <p className="mt-1 break-words text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                {activeRecommendation.platform_url}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onCopyAndOpen(activeRecommendation)}
              disabled={isCurrentlyLoading}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
            >
              {copied === activeRecommendation.model_name ? "Copied Prompt" : "Copy & Open"}
              <ExternalLink className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Recommendations will appear after generation.
          </p>
        )}
      </div>
    </div>
  );
}
