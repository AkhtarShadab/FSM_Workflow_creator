import { z } from "zod";

export const FSM_STATE_TYPES = [
  "START",
  "SCRIPT",
  "HTTP",
  "AI",
  "EXTERNAL_AI",
  "VALIDATE",
  "HUMAN",
  "SPAWN",
  "AGGREGATE",
  "SYSTEM_FUNCTION",
  "END",
] as const;

export const FSMStateTypeSchema = z.enum(FSM_STATE_TYPES);
export type FSMStateType = z.infer<typeof FSMStateTypeSchema>;

export const SignalSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^::[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*)+$/, "signal must look like ::NS.NAME");

export const EdgeKindSchema = z.enum(["flow", "router", "self-loop"]);

const Label = z.string().min(1).max(60);

export const CopilotOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_node"),
    stateType: FSMStateTypeSchema,
    label: Label,
    position: z.object({ x: z.number(), y: z.number() }).optional(),
  }),
  z.object({
    op: z.literal("connect"),
    sourceLabel: Label,
    targetLabel: Label,
    signal: SignalSchema.optional(),
    kind: EdgeKindSchema.optional(),
  }),
  z.object({
    op: z.literal("set_config"),
    nodeLabel: Label,
    patch: z.record(z.unknown()),
  }),
  z.object({
    op: z.literal("delete_node"),
    nodeLabel: Label,
  }),
  z.object({
    op: z.literal("rename_node"),
    nodeLabel: Label,
    newLabel: Label,
  }),
  z.object({
    op: z.literal("explain"),
    text: z.string().min(1).max(2000),
  }),
]);

export type CopilotOp = z.infer<typeof CopilotOp>;

export function parseCopilotOps(input: unknown): CopilotOp[] {
  const arr = z.array(CopilotOp).safeParse(input);
  if (!arr.success) {
    throw new CopilotOpError(arr.error.issues[0]?.path.join(".") || "ops", arr.error.message);
  }
  return arr.data;
}

export class CopilotOpError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(message);
    this.name = "CopilotOpError";
  }
}
