export type { ToolDescriptor, ToolEvent, ToolRequest, ToolResponse } from "@fsm/proto";
export type { ToolBridge, ToolEndpoint } from "./types";

export { createToolBridge } from "./bridge";
export {
  classifyGrpcError,
  GrpcStatus,
  GrpcStatusError,
  type ClassifiedGrpcError,
  type GrpcStatusCode,
} from "./errors";
export {
  LOG_BYTE_LIMIT,
  LOG_TRUNCATED,
  registerFakeTool,
  resetFakeTools,
} from "./fake-server";
