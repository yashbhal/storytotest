import { strict as assert } from "assert";
import { resolveLLMEnvConfig } from "../../src/llm/env";
import { getDefaultModelForProvider } from "../../src/llm/provider";

describe("resolveLLMEnvConfig", () => {
  it("uses LLM_* vars when provided", () => {
    const env = {
      LLM_PROVIDER: "anthropic",
      LLM_API_KEY: "api-key",
      LLM_MODEL: "claude-model",
      LLM_BASE_URL: "https://custom",
    } as NodeJS.ProcessEnv;

    const result = resolveLLMEnvConfig(env);

    assert.equal(result.provider, "anthropic");
    assert.equal(result.apiKey, "api-key");
    assert.equal(result.model, "claude-model");
    assert.equal(result.baseUrl, "https://custom");
  });

  it("falls back to provider-specific keys and default model when LLM_* missing", () => {
    const env = {
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "openai-key",
    } as NodeJS.ProcessEnv;

    const result = resolveLLMEnvConfig(env);

    assert.equal(result.provider, "openai");
    assert.equal(result.apiKey, "openai-key");
    assert.equal(result.model, getDefaultModelForProvider("openai"));
    assert.equal(result.baseUrl, undefined);
  });

  it("uses provider-specific model/base URL overrides", () => {
    const env = {
      LLM_PROVIDER: "gemini",
      LLM_API_KEY: "api-key",
      GEMINI_MODEL: "gemini-model",
      GEMINI_BASE_URL: "https://gemini",
    } as NodeJS.ProcessEnv;

    const result = resolveLLMEnvConfig(env);

    assert.equal(result.provider, "gemini");
    assert.equal(result.model, "gemini-model");
    assert.equal(result.baseUrl, "https://gemini");
  });

  it("defaults provider and model when nothing is set", () => {
    const env = {} as NodeJS.ProcessEnv;

    const result = resolveLLMEnvConfig(env);

    assert.equal(result.provider, "openai");
    assert.equal(result.apiKey, undefined);
    assert.equal(result.model, getDefaultModelForProvider("openai"));
    assert.equal(result.baseUrl, undefined);
  });
});
