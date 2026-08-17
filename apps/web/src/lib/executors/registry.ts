import type { FSMStateType } from "@/lib/fsm-types";
import { executeAi } from "./ai";
import { executeHttp } from "./http";
import { executeValidate } from "./validate";
import type { Executor } from "./types";

/**
 * SCRIPT: success stub in mock mode; otherwise TOOL_RUNTIME_UNAVAILABLE until 010 G3.
 * HUMAN auto-approves until E3.
 */
export const executeStart: Executor = async () => "::SCRIPT.NEXT";

export const executeScript: Executor = async () => {
  if (process.env.FSM_MOCK_PROVIDER === "1") return "::SCRIPT.NEXT";
  return {
    signal: "::SCRIPT.ERROR",
    payload: { code: "TOOL_RUNTIME_UNAVAILABLE" },
  };
};

export { executeHttp, executeValidate };

export const executeHuman: Executor = async () => "::HUMAN.APPROVE";

export const executeSystem: Executor = async () => "::SYSTEM.HYDRATE";

export const executeAggregate: Executor = async () => "::SCRIPT.NEXT";

export const executors: Record<string, Executor> = {
  START: executeStart,
  SCRIPT: executeScript,
  HTTP: executeHttp,
  VALIDATE: executeValidate,
  AI: executeAi,
  EXTERNAL_AI: executeAi,
  HUMAN: executeHuman,
  AGGREGATE: executeAggregate,
  SYSTEM_FUNCTION: executeSystem,
};

export function getExecutor(type: string | FSMStateType): Executor {
  return executors[type] ?? executeStart;
}
