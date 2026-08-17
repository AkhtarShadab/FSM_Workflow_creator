import type { FSMStateType } from "@/lib/fsm-types";
import { executeAi } from "./ai";
import { executeHttp } from "./http";
import { executeHuman } from "./human";
import { executeValidate } from "./validate";
import type { Executor } from "./types";
import {
  deniedEmission,
  ToolGrantError,
} from "@/lib/tool-grants";

/**
 * SCRIPT: success stub in mock mode; otherwise TOOL_RUNTIME_UNAVAILABLE until 010 G3.
 * HUMAN parks on human_tasks until the approval API wakes the supervisor.
 */
export const executeStart: Executor = async () => "::SCRIPT.NEXT";

export const executeScript: Executor = async (ctx) => {
  const toolName = ctx.node?.data?.script?.toolName ?? "script";
  if (ctx.tools) {
    try {
      ctx.tools.requireGrant(toolName);
    } catch (e) {
      if (e instanceof ToolGrantError) {
        return deniedEmission(e.toolName, e.reason);
      }
      throw e;
    }
  }
  if (process.env.FSM_MOCK_PROVIDER === "1") return "::SCRIPT.NEXT";
  return {
    signal: "::SCRIPT.ERROR",
    payload: { code: "TOOL_RUNTIME_UNAVAILABLE" },
  };
};

export { executeHttp, executeValidate, executeHuman };

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
