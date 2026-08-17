import { mockAdapter } from "./adapters/mock";
import { createOpenAIAdapter, openaiAdapter } from "./adapters/openai";
import type { ProviderAdapter, ProviderId } from "./types";

export function isMockProviderEnabled(): boolean {
  return process.env.FSM_MOCK_PROVIDER === "1";
}

export function getAdapter(
  id: ProviderId,
  opts?: { fetchFn?: typeof fetch }
): ProviderAdapter {
  if (isMockProviderEnabled() || id === "mock") return mockAdapter;
  if (id === "openai" || id === "openai-compatible") {
    return opts?.fetchFn ? createOpenAIAdapter(opts.fetchFn) : openaiAdapter;
  }
  // Anthropic lands in 003 E4 — OpenAI-compatible is the E1 fallback.
  return opts?.fetchFn ? createOpenAIAdapter(opts.fetchFn) : openaiAdapter;
}

export type {
  ChatChunk,
  ChatHandle,
  ChatMessage,
  ChatRequest,
  ChatResult,
  DiscoveredModel,
  ListModelsInput,
  ProviderAdapter,
  ProviderId,
} from "./types";
export { ProviderError, isProviderError } from "./errors";
export { createChatHandle } from "./chat-handle";
export { listModels, DEFAULT_BASE_URL, normalizeBaseUrl } from "./list-models";
export { mockAdapter, MOCK_TOKENS_IN, MOCK_TOKENS_OUT } from "./adapters/mock";
export { createOpenAIAdapter, openaiAdapter } from "./adapters/openai";
