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
  /**
   * Normalizes a provider string to a supported LLMProvider, falling back when unknown.
   * @param provider provider name from config/user input
   * @param fallback default provider to use when input is missing or unsupported
   * @returns a supported provider id (openai | anthropic | gemini)
   */
  if (!provider) {
    return fallback;
  }

  const normalized = provider.trim().toLowerCase();
  return (SUPPORTED_LLM_PROVIDERS as readonly string[]).includes(normalized)
    ? (normalized as LLMProvider)
    : fallback;
}

export function getDefaultModelForProvider(provider: LLMProvider): string {
  /**
   * Returns the default model name for the given provider.
   * @param provider normalized provider id
   * @returns default model string for that provider
   */
  return DEFAULT_MODELS[provider];
}

