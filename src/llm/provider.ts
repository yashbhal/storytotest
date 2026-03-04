export const SUPPORTED_LLM_PROVIDERS = ["openai", "anthropic", "gemini"] as const;

export type LLMProvider = (typeof SUPPORTED_LLM_PROVIDERS)[number];

const DEFAULT_PROVIDER: LLMProvider = "openai";

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4-turbo",
  anthropic: "claude-3-5-sonnet-latest",
  gemini: "gemini-2.0-flash",
};

export function normalizeProvider(
  provider: string | undefined,
  fallback: LLMProvider = DEFAULT_PROVIDER,
): LLMProvider {
  if (!provider) {
    return fallback;
  }

  const normalized = provider.trim().toLowerCase();
  return (SUPPORTED_LLM_PROVIDERS as readonly string[]).includes(normalized)
    ? (normalized as LLMProvider)
    : fallback;
}

export function getDefaultModelForProvider(provider: LLMProvider): string {
  return DEFAULT_MODELS[provider];
}

