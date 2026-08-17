import { db } from "@/db";
import { humanTasks, runs } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { HumanConfig } from "@/lib/fsm-types";
import {
  defaultHumanBridge,
  signalForDecision,
  type HumanBridge,
  type HumanDecision,
  type HumanResolution,
} from "./human-bridge";
import type { Executor, ExecutorContext } from "./types";

export interface StoredHumanTask {
  id: number;
  status: string;
  responseJson?: string | null;
}

export interface CreateHumanTaskInput {
  runId: number;
  stateId: string;
  prompt: string;
  assignee?: string;
  expiresAt?: Date | null;
}

export interface HumanExecutorDeps {
  createTask: (input: CreateHumanTaskInput) => Promise<{ id: number }>;
  findTask?: (runId: number, stateId: string) => Promise<StoredHumanTask | null>;
  setRunAwaiting: (runId: number) => Promise<void>;
  wait: HumanBridge["wait"];
  expireTask?: (taskId: number) => Promise<void>;
  now?: () => number;
}

function humanConfig(ctx: ExecutorContext): HumanConfig {
  return (
    ctx.node?.data.human ?? {
      prompt: "Please review and approve to continue.",
      approvalSignals: ["::HUMAN.APPROVE", "::HUMAN.REJECT"],
    }
  );
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function resolutionFromStored(task: StoredHumanTask): HumanResolution | null {
  if (task.status === "pending") return null;
  const decision: HumanDecision =
    task.status === "approved"
      ? "approved"
      : task.status === "expired"
        ? "expired"
        : "rejected";
  let response: unknown;
  if (task.responseJson) {
    try {
      response = JSON.parse(task.responseJson) as unknown;
    } catch {
      response = task.responseJson;
    }
  }
  return { signal: signalForDecision(decision), decision, response };
}

function emissionFor(
  ctx: ExecutorContext,
  resolution: HumanResolution
): { signal: string; payload: Record<string, unknown> } {
  return {
    signal: resolution.signal,
    payload: {
      ...asObject(ctx.payload),
      human: {
        decision: resolution.decision,
        ...(resolution.response !== undefined
          ? { response: resolution.response }
          : {}),
      },
    },
  };
}

export function createHumanExecutor(deps: HumanExecutorDeps): Executor {
  const now = deps.now ?? Date.now;

  return async function executeHuman(ctx: ExecutorContext) {
    const cfg = humanConfig(ctx);
    const prompt = cfg.prompt || "Please review and approve to continue.";
    const timeoutMs = cfg.timeoutMs;
    const expiresAt =
      timeoutMs != null && timeoutMs > 0 ? new Date(now() + timeoutMs) : null;

    const existing = await deps.findTask?.(ctx.runId, ctx.state.id);
    if (existing) {
      const already = resolutionFromStored(existing);
      if (already) {
        await ctx.emit({
          stateId: ctx.state.id,
          kind: "human.resolved",
          payload: {
            taskId: existing.id,
            decision: already.decision,
            signal: already.signal,
          },
        });
        return emissionFor(ctx, already);
      }
    }

    const task =
      existing?.status === "pending"
        ? { id: existing.id }
        : await deps.createTask({
            runId: ctx.runId,
            stateId: ctx.state.id,
            prompt,
            assignee: cfg.assignTo,
            expiresAt,
          });

    await deps.setRunAwaiting(ctx.runId);
    await ctx.emit({
      stateId: ctx.state.id,
      kind: "human.awaiting",
      payload: {
        taskId: task.id,
        prompt,
        expiresAt: expiresAt?.toISOString() ?? null,
        incomingPayload: ctx.payload ?? null,
      },
    });

    const resolution = await deps.wait({
      runId: ctx.runId,
      taskId: task.id,
      expiresAt,
      signal: ctx.signal,
      onExpire: () => deps.expireTask?.(task.id),
    });

    await ctx.emit({
      stateId: ctx.state.id,
      kind: "human.resolved",
      payload: {
        taskId: task.id,
        decision: resolution.decision,
        signal: resolution.signal,
      },
    });

    return emissionFor(ctx, resolution);
  };
}

async function liveCreateTask(input: CreateHumanTaskInput) {
  const [row] = await db
    .insert(humanTasks)
    .values({
      runId: input.runId,
      stateId: input.stateId,
      prompt: input.prompt,
      assignee: input.assignee ?? null,
      status: "pending",
      expiresAt: input.expiresAt ?? null,
    })
    .returning({ id: humanTasks.id });
  if (!row) throw new Error("failed to insert human_tasks row");
  return row;
}

async function liveFindTask(
  runId: number,
  stateId: string
): Promise<StoredHumanTask | null> {
  const [row] = await db
    .select({
      id: humanTasks.id,
      status: humanTasks.status,
      responseJson: humanTasks.responseJson,
    })
    .from(humanTasks)
    .where(and(eq(humanTasks.runId, runId), eq(humanTasks.stateId, stateId)))
    .orderBy(desc(humanTasks.id))
    .limit(1);
  return row ?? null;
}

async function liveSetRunAwaiting(runId: number) {
  await db
    .update(runs)
    .set({ status: "awaiting_human", endedAt: null })
    .where(eq(runs.id, runId));
}

async function liveExpireTask(taskId: number) {
  await db
    .update(humanTasks)
    .set({ status: "expired", resolvedAt: new Date() })
    .where(and(eq(humanTasks.id, taskId), eq(humanTasks.status, "pending")));
}

export const executeHuman: Executor = createHumanExecutor({
  createTask: liveCreateTask,
  findTask: liveFindTask,
  setRunAwaiting: liveSetRunAwaiting,
  wait: (args) => defaultHumanBridge.wait(args),
  expireTask: liveExpireTask,
});
