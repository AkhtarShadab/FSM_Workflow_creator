import { describe, expect, it, vi } from "vitest";
import { createOpenAIAdapter } from "./adapters/openai";
import { ProviderError } from "./errors";

function sseBody(events: unknown[]): string {
  return (
    events
      .map((e) =>
        typeof e === "string" ? `data: ${e}` : `data: ${JSON.stringify(e)}`
      )
      .join("\n\n") + "\n\n"
  );
}

describe("openai adapter", () => {
  it("maps a streamed SSE body into chunks and a final ChatResult with token counts", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      return new Response(
        sseBody([
          { choices: [{ delta: { content: "Hel" } }] },
          { choices: [{ delta: { content: "lo" } }] },
          { usage: { prompt_tokens: 9, completion_tokens: 2 } },
          "[DONE]",
        ]),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );
    });
    const adapter = createOpenAIAdapter(fetchFn);
    const handle = adapter.chat(
      { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
      "sk-test"
    );
    const chunks: string[] = [];
    for await (const chunk of handle) chunks.push(chunk.delta);
    const result = await handle;
    expect(chunks).toEqual(["Hel", "lo"]);
    expect(result.text).toBe("Hello");
    expect(result.tokensIn).toBe(9);
    expect(result.tokensOut).toBe(2);
    expect(fetchFn).toHaveBeenCalledOnce();
    const init = fetchFn.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer sk-test");
  });

  it("surfaces 401 as AUTH_FAILED", async () => {
    const adapter = createOpenAIAdapter(
      (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch
    );
    await expect(
      adapter.chat(
        { model: "gpt-4o", messages: [{ role: "user", content: "x" }] },
        "sk-bad"
      )
    ).rejects.toMatchObject({
      name: "ProviderError",
      code: "AUTH_FAILED",
      status: 401,
      retryable: false,
    } satisfies Partial<ProviderError>);
  });

  it("surfaces 429 as retryable RATE_LIMITED", async () => {
    const adapter = createOpenAIAdapter(
      (async () => new Response("slow", { status: 429 })) as unknown as typeof fetch
    );
    await expect(
      adapter.chat(
        { model: "gpt-4o", messages: [{ role: "user", content: "x" }] },
        "sk-test"
      )
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      retryable: true,
    });
  });
});
