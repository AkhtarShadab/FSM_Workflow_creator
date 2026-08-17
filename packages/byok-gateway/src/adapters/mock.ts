import { createChatHandle } from "../chat-handle";
import { listModels } from "../list-models";
import type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  ProviderAdapter,
} from "../types";

/** Fixed token counts so CI E2E is deterministic. */
export const MOCK_TOKENS_IN = 12;
export const MOCK_TOKENS_OUT = 8;

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return "";
}

export function mockResponseText(req: ChatRequest): string {
  return `mock:${req.model}:${lastUserText(req.messages)}`;
}

export const mockAdapter: ProviderAdapter = {
  id: "mock",
  chat(req, _key, _baseUrl) {
    const text = mockResponseText(req);
    const result: ChatResult = {
      text,
      tokensIn: MOCK_TOKENS_IN,
      tokensOut: MOCK_TOKENS_OUT,
      raw: { mock: true, model: req.model },
    };
    return createChatHandle(async (emit) => {
      if (req.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      emit({ delta: text });
      return result;
    });
  },
  listModels(key, baseUrl) {
    return listModels({ provider: "mock", key, baseUrl });
  },
};
