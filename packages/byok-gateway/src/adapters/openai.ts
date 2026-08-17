import { createChatHandle } from "../chat-handle";
import { ProviderError } from "../errors";
import { httpStatusError, listModels, normalizeBaseUrl } from "../list-models";
import type {
  ChatChunk,
  ChatRequest,
  ChatResult,
  ProviderAdapter,
} from "../types";

const DEFAULT_OPENAI_BASE = "https://api.openai.com";

export function createOpenAIAdapter(
  fetchFn: typeof fetch = fetch
): ProviderAdapter {
  return {
    id: "openai",
    chat(req, key, baseUrl = DEFAULT_OPENAI_BASE) {
      return createChatHandle(async (emit) => {
        const url = `${normalizeBaseUrl(baseUrl)}/v1/chat/completions`;
        const messages: Array<{ role: string; content: string }> = [];
        if (req.systemPrompt) {
          messages.push({ role: "system", content: req.systemPrompt });
        }
        messages.push(...req.messages);

        const body: Record<string, unknown> = {
          model: req.model,
          messages,
          stream: true,
          stream_options: { include_usage: true },
        };
        if (req.temperature != null) body.temperature = req.temperature;
        if (req.maxTokens != null) body.max_tokens = req.maxTokens;
        if (req.jsonSchema) {
          body.response_format = {
            type: "json_schema",
            json_schema: {
              name: "output",
              schema: req.jsonSchema,
              strict: true,
            },
          };
        }

        const res = await fetchFn(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: req.signal,
        });

        if (!res.ok) throw httpStatusError(res.status);
        return consumeOpenAiSse(res, emit);
      });
    },
    listModels(key, baseUrl = DEFAULT_OPENAI_BASE) {
      return listModels({
        provider: "openai",
        key,
        baseUrl,
        fetchFn,
      });
    },
  };
}

export const openaiAdapter: ProviderAdapter = createOpenAIAdapter();

async function consumeOpenAiSse(
  res: Response,
  emit: (chunk: ChatChunk) => void
): Promise<ChatResult> {
  if (!res.body) {
    throw new ProviderError("PROVIDER_ERROR", res.status, {
      message: "empty body",
    });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let tokensIn = 0;
  let tokensOut = 0;
  let raw: unknown = null;

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) return;
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") return;
    let json: {
      choices?: Array<{ delta?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      json = JSON.parse(data) as typeof json;
    } catch {
      return;
    }
    raw = json;
    const delta = json.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta.length > 0) {
      text += delta;
      emit({ delta });
    }
    if (json.usage) {
      tokensIn = json.usage.prompt_tokens ?? tokensIn;
      tokensOut = json.usage.completion_tokens ?? tokensOut;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) processLine(line);
  }
  buffer += decoder.decode();
  if (buffer.trim()) processLine(buffer);

  return { text, tokensIn, tokensOut, raw };
}
