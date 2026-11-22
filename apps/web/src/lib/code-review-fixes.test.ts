/**
 * Regression tests for the bugs documented in CODE_REVIEW_FIXES.md.
 * Each `describe` maps to one numbered finding.
 */
import { describe, expect, it, vi } from "vitest";
import { canvasToDsl, hasPathToEndUnderMask, lintCanvas } from "./canvas-to-dsl";
import { canvasToEngine } from "./canvas-to-engine";
import {
  defaultNodeData,
  defaultSpawnConfig,
  normalizeSpawn,
  normalizeSystemFunction,
  syncHeterogeneousProfiles,
  type CanvasData,
  type StateNode,
  type TransitionEdge,
} from "./fsm-types";
import { discoverModels, normalizeBase } from "./model-discovery";
import { bareHostname, isPrivateAddress, validatePublicHttpUrl } from "./url-guard";

function node(
  id: string,
  type: StateNode["data"]["stateType"],
  patch: Partial<StateNode["data"]> = {}
): StateNode {
  return {
    id,
    type: "stateCircle",
    position: { x: 0, y: 0 },
    data: { ...defaultNodeData(type, type), ...patch, stateType: type },
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  signal: string,
  extra: Partial<TransitionEdge["data"]> = {}
): TransitionEdge {
  return { id, source, target, type: "script", data: { signal, ...extra }, label: signal };
}

describe("SSRF guard — IPv4-mapped IPv6 in WHATWG-normalised form", () => {
  it("blocks [::ffff:127.0.0.1] which URL() rewrites to [::ffff:7f00:1]", () => {
    const url = new URL("http://[::ffff:127.0.0.1]/v1");
    expect(url.hostname).toBe("[::ffff:7f00:1]");
    expect(validatePublicHttpUrl(url.href).ok).toBe(false);
  });

  it("blocks metadata / loopback via mapped, compatible and NAT64 forms", () => {
    for (const ip of [
      "::ffff:a9fe:a9fe", // 169.254.169.254
      "::7f00:1", // ::127.0.0.1 (IPv4-compatible)
      "64:ff9b::a00:1", // NAT64 → 10.0.0.1
      "0:0:0:0:0:0:0:1",
      "fe9f::1", // still inside fe80::/10
      "ff02::1", // multicast
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("still allows public IPv6 and IPv4-mapped public addresses", () => {
    expect(isPrivateAddress("2606:4700::1")).toBe(false);
    expect(isPrivateAddress("::ffff:808:808")).toBe(false); // 8.8.8.8
  });

  it("strips brackets for DNS lookup", () => {
    expect(bareHostname(new URL("http://[2606:4700::1]/"))).toBe("2606:4700::1");
    expect(bareHostname(new URL("https://api.openai.com"))).toBe("api.openai.com");
  });
});

describe("model discovery — base URL and redirects", () => {
  it("does not double the /v1 segment", () => {
    expect(normalizeBase("https://api.openai.com/v1/")).toBe("https://api.openai.com");
    expect(normalizeBase("https://api.openai.com")).toBe("https://api.openai.com");
  });

  it("requests /v1/models once and refuses to follow redirects", async () => {
    const fetchFn = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } })
    );
    const r = await discoverModels({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "k",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({ redirect: "manual" })
    );
    expect(r.ok).toBe(false);
  });
});

describe("mask reachability keeps every edge sharing (from, signal)", () => {
  it("finds END through the first of two same-signal edges", () => {
    const canvas: CanvasData = {
      nodes: [node("S0", "START"), node("A", "SCRIPT"), node("B", "SCRIPT"), node("E", "END")],
      edges: [
        edge("e1", "S0", "A", "::SCRIPT.NEXT"),
        edge("e2", "A", "E", "::SCRIPT.NEXT"), // reaches END
        edge("e3", "A", "B", "::SCRIPT.NEXT"), // same signal, dead end; used to overwrite e2
      ],
    };
    const mask = normalizeSystemFunction({ disabledStateIds: ["B"] });
    expect(hasPathToEndUnderMask(canvas.nodes, canvas.edges, mask)).toBe(true);
  });
});

describe("MISSING_ERROR_EDGE honours the state's own error signal", () => {
  it("accepts ::HUMAN.REJECT as the HUMAN error route", () => {
    const canvas: CanvasData = {
      nodes: [node("S0", "START"), node("H", "HUMAN"), node("E", "END"), node("X", "END")],
      edges: [
        edge("e1", "S0", "H", "::SCRIPT.NEXT"),
        edge("e2", "H", "E", "::HUMAN.APPROVE"),
        edge("e3", "H", "X", "::HUMAN.REJECT"),
      ],
    };
    const issues = lintCanvas(canvas);
    expect(issues.some((i) => i.code === "MISSING_ERROR_EDGE" && i.nodeId === "H")).toBe(false);
  });
});

describe("export wizard choices reach the DSL", () => {
  it("emits the selected tool language and checkpoint store", () => {
    const dsl = canvasToDsl(
      { nodes: [], edges: [] },
      { toolLanguage: "bash", checkpointStore: "sql" }
    );
    expect(dsl.config.toolLanguage).toBe("bash");
    expect(dsl.config.checkpointStore).toBe("sql");
    expect(canvasToDsl({ nodes: [], edges: [] }).config.toolLanguage).toBe("python");
  });
});

describe("SPAWN count / heterogeneous profiles", () => {
  it("clamps nonsensical counts", () => {
    expect(normalizeSpawn({ ...defaultSpawnConfig(), count: 0 }).count).toBe(1);
    expect(normalizeSpawn({ ...defaultSpawnConfig(), count: -4 }).count).toBe(1);
    expect(normalizeSpawn({ ...defaultSpawnConfig(), count: 2.7 }).count).toBe(2);
  });

  it("sizes heterogeneous profiles to count with unique ids", () => {
    const spawn = { ...defaultSpawnConfig(), mode: "heterogeneous" as const, count: 3 };
    const synced = syncHeterogeneousProfiles(spawn);
    expect(synced.profiles).toHaveLength(3);
    expect(new Set(synced.profiles.map((p) => p.id)).size).toBe(3);
    const canvas: CanvasData = {
      nodes: [node("SP", "SPAWN", { spawn: synced })],
      edges: [],
    };
    expect(lintCanvas(canvas).some((i) => i.code === "SPAWN_PROFILE_MISMATCH")).toBe(false);
    // homogeneous untouched
    const homo = defaultSpawnConfig();
    expect(syncHeterogeneousProfiles(homo)).toBe(homo);
  });
});

describe("canvasToEngine", () => {
  it("normalises legacy edges and maps heterogeneous worker count", () => {
    const spawn = syncHeterogeneousProfiles({
      ...defaultSpawnConfig(),
      mode: "heterogeneous",
      count: 2,
    });
    const { states, edges } = canvasToEngine({
      nodes: [
        node("S0", "START"),
        node("A", "SCRIPT"),
        node("SP", "SPAWN", { spawn, guardrails: { timeoutMs: 1234, retryMax: 0, retryBackoffMs: 0 } }),
        node("V", "VALIDATE", { validate: { kind: "predicate", predicateRef: "p" } }),
      ],
      edges: [
        // legacy self-loop: no kind, no maxIterations
        { id: "e1", source: "A", target: "A", data: { signal: "::SCRIPT.NEXT" } },
      ],
    });
    expect(edges[0]).toMatchObject({ kind: "self-loop", maxIterations: 3 });
    const sp = states.find((s) => s.id === "SP")!;
    expect(sp.spawn?.count).toBe(2);
    expect(sp.spawn?.profiles.every((p) => p.timeoutMs === 1234)).toBe(true);
    // predicate VALIDATE must not be gated by the (unused) schema field
    expect(states.find((s) => s.id === "V")!.inputSchema).toBeUndefined();
  });
});
