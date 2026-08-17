import { describe, expect, it } from "vitest";
import { mockAdapter, MOCK_TOKENS_IN, MOCK_TOKENS_OUT } from "./adapters/mock";
import type { ChatRequest } from "./types";

const req: ChatRequest = {
  model: "mock-chat",
  messages: [{ role: "user", content: "hello world" }],
  temperature: 0,
  maxTokens: 16,
};

describe("mock adapter", () => {
  it("is deterministic: identical requests produce identical text and token counts", async () => {
    const a = await mockAdapter.chat(req, "sk-unused");
    const b = await mockAdapter.chat(req, "sk-other");
    expect(a.text).toBe("mock:mock-chat:hello world");
    expect(a).toEqual(b);
    expect(a.tokensIn).toBe(MOCK_TOKENS_IN);
    expect(a.tokensOut).toBe(MOCK_TOKENS_OUT);
    expect(b.tokensIn).toBe(12);
    expect(b.tokensOut).toBe(8);
  });

  it("yields the same assembled text when streamed", async () => {
    const handle = mockAdapter.chat(req, "k");
    const chunks: string[] = [];
    for await (const chunk of handle) {
      chunks.push(chunk.delta);
    }
    const result = await handle;
    expect(chunks.join("")).toBe(result.text);
    expect(result.tokensIn).toBe(MOCK_TOKENS_IN);
    expect(result.tokensOut).toBe(MOCK_TOKENS_OUT);
  });

  it("changes output when the prompt changes", async () => {
    const other = await mockAdapter.chat(
      { ...req, messages: [{ role: "user", content: "other" }] },
      "k"
    );
    const first = await mockAdapter.chat(req, "k");
    expect(other.text).not.toBe(first.text);
    expect(other.tokensIn).toBe(first.tokensIn);
    expect(other.tokensOut).toBe(first.tokensOut);
  });
});
