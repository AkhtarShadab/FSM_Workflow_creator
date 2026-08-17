import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateSuccessCondition,
  type SuccessCondition,
} from "./verify-success";

describe("R2 evaluateSuccessCondition", () => {
  afterEach(() => {
    delete process.env.FSM_MOCK_PROVIDER;
  });

  it("schema pass validates required object properties", async () => {
    const condition: SuccessCondition = {
      kind: "schema",
      schema: JSON.stringify({
        type: "object",
        required: ["ok"],
        properties: { ok: { type: "boolean" } },
      }),
    };
    const pass = await evaluateSuccessCondition(condition, {
      signal: "::STATE.SUCCESS",
      payload: { ok: true },
      stateId: "S1",
    });
    expect(pass.pass).toBe(true);

    const fail = await evaluateSuccessCondition(condition, {
      signal: "::STATE.SUCCESS",
      payload: { ok: "yes" },
      stateId: "S1",
    });
    expect(fail.pass).toBe(false);
  });

  it("JSONLogic predicate supports == and var on payload path", async () => {
    const condition: SuccessCondition = {
      kind: "predicate",
      expr: JSON.stringify({
        "==": [{ var: "payload.status" }, "done"],
      }),
    };
    const pass = await evaluateSuccessCondition(condition, {
      signal: "::HTTP.SUCCESS",
      payload: { status: "done" },
      stateId: "S2",
    });
    expect(pass.pass).toBe(true);

    const fail = await evaluateSuccessCondition(condition, {
      signal: "::HTTP.SUCCESS",
      payload: { status: "pending" },
      stateId: "S2",
    });
    expect(fail.pass).toBe(false);
  });

  it("mock llm_verify passes when FSM_MOCK_PROVIDER=1", async () => {
    process.env.FSM_MOCK_PROVIDER = "1";
    const condition: SuccessCondition = {
      kind: "llm_verify",
      credentialId: "cred-1",
      modelId: "judge",
      rubric: "Output must be complete",
      onFail: "retry",
    };
    const result = await evaluateSuccessCondition(condition, {
      signal: "::AI.NEXT",
      payload: { answer: "complete" },
      stateId: "S3",
    });
    expect(result.pass).toBe(true);
  });

  it("payload VERIFY_FAIL fails mock llm_verify", async () => {
    process.env.FSM_MOCK_PROVIDER = "1";
    const condition: SuccessCondition = {
      kind: "llm_verify",
      credentialId: "cred-1",
      modelId: "judge",
      rubric: "check",
      onFail: "error_signal",
    };
    const result = await evaluateSuccessCondition(condition, {
      signal: "::AI.NEXT",
      payload: "contains VERIFY_FAIL marker",
      stateId: "S3",
    });
    expect(result.pass).toBe(false);
  });

  it("throws fail closed", async () => {
    const condition: SuccessCondition = {
      kind: "predicate",
      expr: "{not-valid-json",
    };
    const result = await evaluateSuccessCondition(condition, {
      signal: "::STATE.SUCCESS",
      payload: {},
      stateId: "S4",
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("verify_fail");
  });

  it("judge non-JSON result fails closed", async () => {
    const condition: SuccessCondition = {
      kind: "llm_verify",
      credentialId: "cred-1",
      modelId: "judge",
      rubric: "r",
      onFail: "retry",
    };
    const result = await evaluateSuccessCondition(
      condition,
      { signal: "::AI.NEXT", payload: {}, stateId: "S5" },
      {
        judge: async () => ({ pass: "yes" } as unknown as { pass: boolean; reason: string }),
      }
    );
    expect(result.pass).toBe(false);
  });

  it("signal kind matches success kit or outgoing edge", async () => {
    const condition: SuccessCondition = { kind: "signal" };
    const kit = await evaluateSuccessCondition(condition, {
      signal: "::HTTP.SUCCESS",
      payload: {},
      stateId: "S6",
      successSignal: "::HTTP.SUCCESS",
    });
    expect(kit.pass).toBe(true);

    const edge = await evaluateSuccessCondition(condition, {
      signal: "::CUSTOM.OK",
      payload: {},
      stateId: "S6",
      successSignal: "::HTTP.SUCCESS",
      outgoingSignals: ["::CUSTOM.OK"],
    });
    expect(edge.pass).toBe(true);

    const miss = await evaluateSuccessCondition(condition, {
      signal: "::HTTP.ERROR",
      payload: {},
      stateId: "S6",
      successSignal: "::HTTP.SUCCESS",
    });
    expect(miss.pass).toBe(false);
  });
});
