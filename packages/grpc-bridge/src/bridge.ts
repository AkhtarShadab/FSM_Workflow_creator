import type { ToolDescriptor, ToolEvent, ToolRequest, ToolResponse } from "@fsm/proto";
import type { ToolBridge, ToolEndpoint } from "./types";
import { GrpcStatus, GrpcStatusError } from "./errors";
import { fakeExecute, fakeExecuteStream, listFakeDescriptors } from "./fake-server";

type ChannelKind = "fake" | "unavailable";

interface Channel {
  kind: ChannelKind;
  endpoint: ToolEndpoint;
}

function envFakeTools(): boolean {
  return process.env.FSM_FAKE_TOOLS === "1";
}

function isFakeAddress(address: string): boolean {
  return address.startsWith("fake://");
}

function isFakeDown(address: string): boolean {
  return address === "fake://down" || address.startsWith("fake://down/");
}

function channelKind(endpoint: ToolEndpoint): ChannelKind {
  if (isFakeDown(endpoint.address)) return "unavailable";
  if (isFakeAddress(endpoint.address) || envFakeTools()) return "fake";
  return "unavailable";
}

/** Lazy per-endpoint channel pool. G1 only materializes fake or UNAVAILABLE stubs. */
class ChannelPool {
  private readonly channels = new Map<string, Channel>();

  constructor(endpoints: ToolEndpoint[]) {
    for (const endpoint of endpoints) this.ensure(endpoint);
  }

  ensure(endpoint: ToolEndpoint): Channel {
    const existing = this.channels.get(endpoint.id);
    if (existing) return existing;
    const channel: Channel = { kind: channelKind(endpoint), endpoint };
    this.channels.set(endpoint.id, channel);
    return channel;
  }

  get(endpoint: ToolEndpoint): Channel {
    return this.channels.get(endpoint.id) ?? this.ensure(endpoint);
  }
}

function unavailable(endpoint: ToolEndpoint): never {
  throw new GrpcStatusError(
    GrpcStatus.UNAVAILABLE,
    `tool runtime unavailable: ${endpoint.id} (${endpoint.address})`,
  );
}

export function createToolBridge(endpoints: ToolEndpoint[]): ToolBridge {
  const pool = new ChannelPool(endpoints);

  return {
    async describe(endpoint: ToolEndpoint): Promise<ToolDescriptor[]> {
      const channel = pool.get(endpoint);
      if (channel.kind !== "fake") unavailable(endpoint);
      return listFakeDescriptors();
    },

    async execute(
      req: ToolRequest,
      opts: { signal: AbortSignal; endpoint: ToolEndpoint },
    ): Promise<ToolResponse> {
      const channel = pool.get(opts.endpoint);
      if (channel.kind !== "fake") unavailable(opts.endpoint);
      return fakeExecute(req, opts.signal);
    },

    executeStream(
      req: ToolRequest,
      opts: { signal: AbortSignal; endpoint: ToolEndpoint },
    ): AsyncIterable<ToolEvent> {
      const channel = pool.get(opts.endpoint);
      if (channel.kind !== "fake") unavailable(opts.endpoint);
      return fakeExecuteStream(req, opts.signal);
    },

    async health(endpoint: ToolEndpoint): Promise<"serving" | "not_serving"> {
      const channel = pool.get(endpoint);
      return channel.kind === "fake" ? "serving" : "not_serving";
    },
  };
}
