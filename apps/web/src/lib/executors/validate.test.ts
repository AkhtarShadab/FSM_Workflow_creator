import { describe, expect, it } from "vitest";
import type { StateNodeData } from "@/lib/fsm-types";
import type { RunEventDraft } from "./types";
import { createValidateExecutor } from "./validate";

const SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    id: { type: "number" },
    nested: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  required: ["id"],
  additionalProperties: false,
});

function validateNode(schema = SCHEMA): { id: string; data: StateNodeData } {
  return {
    id: "V1",
    data: {
      validate: { kind: "schema", schema },
    } as StateNodeData,
  };
}

describe("VALIDATE executor", () => {
  const execute = createValidateExecutor();

  it("passes a conforming payload", async () => {
    const drafts: RunEventDraft[] = [];
    const emission = await execute({
      runId: 1,
      state: { id: "V1", type: "VALIDATE" },
      node: validateNode(),
      payload: { id: 7, nested: { name: "ok" } },
      signal: new AbortController().signal,
      emit: async (ev) => {
        drafts.push(ev);
      },
    });
    expect(emission).toMatchObject({ signal: "::VALIDATE.NEXT" });
    expect(drafts.some((d) => d.kind === "state.error")).toBe(false);
  });

  it("fails a non-conforming payload with the Ajv path in the message", async () => {
    const drafts: RunEventDraft[] = [];
    const emission = await execute({
      runId: 1,
      state: { id: "V1", type: "VALIDATE" },
      node: validateNode(),
      payload: { nested: { name: 12 } },
      signal: new AbortController().signal,
      emit: async (ev) => {
        drafts.push(ev);
      },
    });
    expect(emission).toMatchObject({ signal: "::VALIDATE.ERROR" });
    const message =
      typeof emission === "object" && emission && "payload" in emission
        ? String((emission.payload as { message?: string }).message ?? "")
        : "";
    expect(message).toMatch(/\/id/);
    expect(message).toMatch(/\/nested\/name/);
    const err = drafts.find((d) => d.kind === "state.error");
    expect(String((err?.payload as { message?: string })?.message ?? "")).toMatch(
      /\/id/
    );
  });
});
