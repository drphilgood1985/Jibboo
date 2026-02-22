import type { GeminiService } from "./types.js";

interface GeminiCandidate {
  content?: {
    parts?: Array<{
      text?: string;
    }>;
  };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  error?: {
    message?: string;
  };
}

interface GeminiModelInfo {
  name?: string;
  supportedGenerationMethods?: string[];
}

interface GeminiModelListResponse {
  models?: GeminiModelInfo[];
  error?: {
    message?: string;
  };
}

export interface GeminiServiceOptions {
  apiKey: string;
  model: string;
}

const MODEL_UNAVAILABLE_PATTERNS = [
  "no longer available",
  "not found",
  "unsupported model",
  "invalid model",
  "does not exist"
];

const MODEL_FALLBACK_PREFERENCES = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-pro"
];

function normalizeModelName(model: string): string {
  const trimmed = model.trim();
  return trimmed.startsWith("models/") ? trimmed.slice("models/".length) : trimmed;
}

function buildGenerateUrl(apiKey: string, model: string): URL {
  const endpoint = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${normalizeModelName(model)}:generateContent`
  );
  endpoint.searchParams.set("key", apiKey);
  return endpoint;
}

function buildListModelsUrl(apiKey: string): URL {
  const endpoint = new URL("https://generativelanguage.googleapis.com/v1beta/models");
  endpoint.searchParams.set("key", apiKey);
  return endpoint;
}

async function parseJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function isModelUnavailableError(message: string): boolean {
  const normalized = message.toLowerCase();
  return MODEL_UNAVAILABLE_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function pickFallbackModel(
  supportedModels: string[],
  currentModel: string
): string | null {
  if (supportedModels.length === 0) {
    return null;
  }

  const normalizedCurrent = normalizeModelName(currentModel).toLowerCase();

  for (const preferredModel of MODEL_FALLBACK_PREFERENCES) {
    const match = supportedModels.find(
      (model) => model.toLowerCase() === preferredModel && model.toLowerCase() !== normalizedCurrent
    );
    if (match) {
      return match;
    }
  }

  const flashMatch = supportedModels.find((model) => {
    const normalized = model.toLowerCase();
    return normalized.includes("flash") && normalized !== normalizedCurrent;
  });
  if (flashMatch) {
    return flashMatch;
  }

  return (
    supportedModels.find(
      (model) => model.toLowerCase() !== normalizedCurrent
    ) ?? null
  );
}

async function requestGenerateContent(
  apiKey: string,
  model: string,
  instruction: string
): Promise<string> {
  const response = await fetch(buildGenerateUrl(apiKey, model), {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: instruction }]
        }
      ]
    })
  });

  const payload = await parseJson<GeminiResponse>(response);

  if (!response.ok) {
    const message = payload?.error?.message ?? `Gemini API returned ${response.status}`;
    throw new Error(message);
  }

  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();

  return text && text.length > 0
    ? text
    : "I couldn't produce a response for that request.";
}

async function listGenerateModels(apiKey: string): Promise<string[]> {
  const response = await fetch(buildListModelsUrl(apiKey));
  const payload = await parseJson<GeminiModelListResponse>(response);

  if (!response.ok) {
    const message = payload?.error?.message ?? `Gemini model listing failed with ${response.status}`;
    throw new Error(message);
  }

  const unique = new Set<string>();
  for (const model of payload?.models ?? []) {
    if (!model.name) {
      continue;
    }

    if (!model.supportedGenerationMethods?.includes("generateContent")) {
      continue;
    }

    const normalized = normalizeModelName(model.name);
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}

export function createGeminiService(options: GeminiServiceOptions): GeminiService {
  let activeModel = normalizeModelName(options.model);
  let resolvedFallbackModel: string | null = null;
  let modelDiscoveryPromise: Promise<string | null> | null = null;

  async function discoverFallbackModel(): Promise<string | null> {
    if (resolvedFallbackModel) {
      return resolvedFallbackModel;
    }

    if (!modelDiscoveryPromise) {
      modelDiscoveryPromise = (async () => {
        try {
          const supportedModels = await listGenerateModels(options.apiKey);
          const fallback = pickFallbackModel(supportedModels, activeModel);
          resolvedFallbackModel = fallback;
          return fallback;
        } catch (error) {
          console.error("Gemini model discovery failed:", error);
          return null;
        } finally {
          modelDiscoveryPromise = null;
        }
      })();
    }

    return modelDiscoveryPromise;
  }

  return {
    async generateReply(instruction: string): Promise<string> {
      try {
        return await requestGenerateContent(options.apiKey, activeModel, instruction);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isModelUnavailableError(message)) {
          throw error;
        }

        const fallbackModel = await discoverFallbackModel();
        if (!fallbackModel || fallbackModel.toLowerCase() === activeModel.toLowerCase()) {
          throw error;
        }

        activeModel = fallbackModel;
        console.warn(`Gemini model fallback activated: using ${activeModel}`);
        return requestGenerateContent(options.apiKey, activeModel, instruction);
      }
    }
  };
}
