import {
  getDefaultModelForProvider,
  LLMProvider,
  normalizeProvider,
} from "./provider";

export interface LLMEnvConfig {
  provider: LLMProvider;
  apiKey?: string;
  model: string;
  baseUrl?: string;
}

export function resolveLLMEnvConfig(
  env: NodeJS.ProcessEnv,
  fallbackProvider: LLMProvider = "openai",
): LLMEnvConfig {
  const provider = normalizeProvider(
    firstDefined(env.LLM_PROVIDER, env.STORYTOTEST_PROVIDER),
    fallbackProvider,
  );

  const apiKey = firstDefined(
    env.LLM_API_KEY,
    provider === "openai" ? env.OPENAI_API_KEY : undefined,
    provider === "anthropic" ? env.ANTHROPIC_API_KEY : undefined,
    provider === "gemini" ? env.GEMINI_API_KEY : undefined,
  );

  const model = firstDefined(
    env.LLM_MODEL,
    provider === "openai" ? env.OPENAI_MODEL : undefined,
    provider === "anthropic" ? env.ANTHROPIC_MODEL : undefined,
    provider === "gemini" ? env.GEMINI_MODEL : undefined,
  ) || getDefaultModelForProvider(provider);

  const baseUrl = firstDefined(
    env.LLM_BASE_URL,
    provider === "openai" ? env.OPENAI_BASE_URL : undefined,
    provider === "anthropic" ? env.ANTHROPIC_BASE_URL : undefined,
    provider === "gemini" ? env.GEMINI_BASE_URL : undefined,
  );

  return {
    provider,
    apiKey,
    model,
    baseUrl,
  };
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

