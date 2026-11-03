export type ClarifyingQuestion = {
  id: string;
  question: string;
  options: string[];
};

export type RecommendationTier = "open_source" | "freemium" | "premium";

export type Recommendation = {
  model_name: string;
  platform_url: string;
  reasoning: string;
};

export type DispatcherResponse = {
  optimized_prompt: string;
  recommendations: Record<RecommendationTier, Recommendation>;
};
