import { LLMProvider } from "./provider";

export interface GenerateTextParams {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  baseUrl?: string;
}

interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

interface AnthropicResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  error?: {
    message?: string;
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

export async function generateText(params: GenerateTextParams): Promise<string> {
  switch (params.provider) {
    case "openai":
      return generateWithOpenAI(params);
    case "anthropic":
      return generateWithAnthropic(params);
    case "gemini":
      return generateWithGemini(params);
  }
}

async function generateWithOpenAI(params: GenerateTextParams): Promise<string> {
  const endpoint = joinUrl(params.baseUrl || "https://api.openai.com/v1", "/chat/completions");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens ?? 2000,
    }),
  });

  if (!response.ok) {
    throw await buildRequestError("OpenAI", response);
  }

  const data = (await response.json()) as OpenAIResponse;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content;
  }
  if (Array.isArray(content)) {
    const combined = content
      .map((part) => part.text || "")
      .join("")
      .trim();
    if (combined) {
      return combined;
    }
  }

  throw new Error("OpenAI response did not include generated text.");
}

async function generateWithAnthropic(params: GenerateTextParams): Promise<string> {
  const endpoint = joinUrl(params.baseUrl || "https://api.anthropic.com/v1", "/messages");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: params.model,
      system: params.systemPrompt,
      max_tokens: params.maxTokens ?? 2000,
      temperature: params.temperature ?? 0.3,
      messages: [{ role: "user", content: params.userPrompt }],
    }),
  });

  if (!response.ok) {
    throw await buildRequestError("Anthropic", response);
  }

  const data = (await response.json()) as AnthropicResponse;
  const text = (data.content || [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text?.trim() || "")
    .filter(Boolean)
    .join("\n");

  if (!text) {
    const message = data.error?.message || "Anthropic response did not include generated text.";
    throw new Error(message);
  }

  return text;
}

async function generateWithGemini(params: GenerateTextParams): Promise<string> {
  const endpointBase = params.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
  const modelName = normalizeGeminiModelName(params.model);
  const endpoint = joinUrl(
    endpointBase,
    `/models/${encodeURIComponent(modelName)}:generateContent`,
  );
  const endpointWithKey = `${endpoint}?key=${encodeURIComponent(params.apiKey)}`;

  const response = await fetch(endpointWithKey, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: params.systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: params.userPrompt }],
        },
      ],
      generationConfig: {
        temperature: params.temperature ?? 0.3,
        maxOutputTokens: params.maxTokens ?? 2000,
      },
    }),
  });

  if (!response.ok) {
    throw await buildRequestError("Gemini", response);
  }

  const data = (await response.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();

  if (!text) {
    const message = data.error?.message || "Gemini response did not include generated text.";
    throw new Error(message);
  }

  return text;
}

function normalizeGeminiModelName(model: string): string {
  return model.replace(/^models\//, "");
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

async function buildRequestError(provider: string, response: Response): Promise<Error> {
  const body = await response.text();
  const detail = body.trim().slice(0, 1200);
  return new Error(
    `${provider} request failed with status ${response.status}${detail ? `: ${detail}` : ""}`,
  );
}

