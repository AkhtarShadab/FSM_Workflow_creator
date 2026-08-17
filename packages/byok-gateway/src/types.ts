export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  systemPrompt?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonSchema?: object;
  signal?: AbortSignal;
}

export interface ChatChunk {
  delta: string;
}

export interface ChatResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  raw: unknown;
}

export interface DiscoveredModel {
  modelId: string;
  label: string;
}

export type ProviderId = "openai" | "anthropic" | "openai-compatible" | "mock";

export type ChatHandle = AsyncIterable<ChatChunk> & Promise<ChatResult>;

export interface ProviderAdapter {
  id: ProviderId;
  chat(req: ChatRequest, key: string, baseUrl?: string): ChatHandle;
  listModels(key: string, baseUrl?: string): Promise<DiscoveredModel[]>;
}

export interface ListModelsInput {
  provider: Exclude<ProviderId, "mock"> | "mock";
  key: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}
