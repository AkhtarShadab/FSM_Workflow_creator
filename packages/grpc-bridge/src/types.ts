import type { ToolDescriptor, ToolEvent, ToolRequest, ToolResponse } from "@fsm/proto";

export interface ToolEndpoint {
  id: string;
  address: string;
  language: "python" | "bash";
}

export interface ToolBridge {
  describe(endpoint: ToolEndpoint): Promise<ToolDescriptor[]>;
  execute(
    req: ToolRequest,
    opts: { signal: AbortSignal; endpoint: ToolEndpoint },
  ): Promise<ToolResponse>;
  executeStream(
    req: ToolRequest,
    opts: { signal: AbortSignal; endpoint: ToolEndpoint },
  ): AsyncIterable<ToolEvent>;
  health(endpoint: ToolEndpoint): Promise<"serving" | "not_serving">;
}
