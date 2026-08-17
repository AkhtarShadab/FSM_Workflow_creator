import { describe, expect, it } from "vitest";
import { mockAdapter } from "@fsm/byok-gateway";
import { createAiExecutor } from "./ai";
import type { StateNodeData } from "@/lib/fsm-types";
import type { RunEventDraft } from "./types";

function aiNode(model = "mock-chat"): { id: string; data: StateNodeData } {
  return {
    id: "AI1",
    data: {
      ai: {
        credentialId: "1",
        model,
        temperature: 0,
        maxTokens: 16,
        systemPrompt: "be brief",
        outputSchema: "",
      },
    } as StateNodeData,
  };
}

describe("AI executor", () => {
  it("uses the mock adapter and omits the credential key from events", async () => {
    const drafts: RunEventDraft[] = [];
    const planted = "sk-never-emit-this-key";
    const executeAi = createAiExecutor({
      isMock: () => false,
      adapter: mockAdapter,
      getCredential: async () => ({
        key: planted,
        provider: "openai",
        baseUrl: null,
      }),
    });
    const emission = await executeAi({
      runId: 1,
      state: { id: "AI1", type: "AI" },
      node: aiNode(),
      payload: { hello: "world" },
      signal: new AbortController().signal,
      emit: async (ev) => {
        drafts.push(ev);
      },
    });
    expect(emission).toMatchObject({ signal: "::AI.NEXT" });
    if (typeof emission !== "string") {
      expect(emission.payload).toMatchObject({
        tokensIn: 12,
        tokensOut: 8,
      });
      expect(JSON.stringify(emission.payload)).not.toContain(planted);
    }
    expect(JSON.stringify(drafts)).not.toContain(planted);
    expect(drafts.some((d) => d.kind === "state.token")).toBe(true);
  });
});
