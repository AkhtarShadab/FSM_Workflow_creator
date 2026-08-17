import type { FSMStateType } from "@/lib/fsm-types";
import { executeAi } from "./ai";
import { executeScript } from "./script";
import type { Executor } from "./types";

/**
 * HTTP / VALIDATE: success stubs until E2. HUMAN auto-approves until E3.
 * SCRIPT: grpc-bridge via 010 G3 (`script.ts`).
 */
export const executeStart: Executor = async () => "::SCRIPT.NEXT";

export const executeHttp: Executor = async () => "::HTTP.NEXT";

export const executeValidate: Executor = async () => "::VALIDATE.NEXT";

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
