import { describe, expect, it } from "vitest";
import {
  PHASE_MAP_BUDGET,
  buildPhaseMap,
  estimateTokens,
  formatPhaseMap,
  type FsmDsl,
  type FsmDslState,
} from "./phase-map";

const SECRET_SYSTEM_PROMPT = "SECRET_SYSTEM_PROMPT_DO_NOT_LEAK";
const SECRET_TOOL_SCHEMA = "SECRET_TOOL_SCHEMA_properties_fetch_pages";
const SECRET_OUTPUT_SCHEMA = "SECRET_OUTPUT_SCHEMA_pageSummary";

function manyStateFixture(n = 200): FsmDsl {
  const states: FsmDslState[] = [
    { id: "S0", type: "START", label: "Start", description: "Hydrate config" },
  ];
  for (let i = 0; i < n; i++) {
    states.push({
      id: `W${i}`,
      type: "SCRIPT",
      label: `Work island ${i} ingestion transform summarize`,
      description: `Distinct processing island ${i} for a dedicated pipeline stage`,
      tool: {
        name: `fetch_pages_${i}`,
        schema: {
          type: "object",
          properties: { url: { type: "string" } },
          secret: SECRET_TOOL_SCHEMA,
        },
      },
      llm: {
        systemPrompt: SECRET_SYSTEM_PROMPT,
        outputSchema: { title: SECRET_OUTPUT_SCHEMA },
      },
      inputSchema: { title: "SECRET_INPUT_SCHEMA" },
      outputSchema: { title: SECRET_OUTPUT_SCHEMA },
      transitions: [],
    });
  }
  states.push({ id: "END", type: "END", label: "End" });
  return { name: "many-islands", states };
}

describe("buildPhaseMap", () => {
  it("stays at or under the 400-token cap for a 200-state fixture and appends +N more clusters", () => {
    const map = buildPhaseMap(manyStateFixture(200), undefined, PHASE_MAP_BUDGET);
    expect(map.estimatedTokens).toBeLessThanOrEqual(PHASE_MAP_BUDGET);
    expect(estimateTokens(formatPhaseMap(map))).toBe(map.estimatedTokens);
    expect(map.estimatedTokens).toBeLessThanOrEqual(400);
    expect(map.overflowCount).toBeGreaterThan(0);
    expect(formatPhaseMap(map)).toMatch(/\+\d+ more clusters/);
    expect(map.clusters.length).toBeGreaterThan(0);
    expect(map.clusters.length + (map.overflowCount ?? 0)).toBeGreaterThanOrEqual(200);
  });

  it("contains no tool schema or system-prompt text from the fixture", () => {
    const dsl: FsmDsl = {
      states: [
        {
          id: "S0",
          type: "START",
          label: "Start",
          description: "Hydrate",
          transitions: [{ on: "::SCRIPT.NEXT", to: "S1" }],
        },
        {
          id: "S1",
          type: "AI",
          label: "Summarize",
          description: "Write a page summary",
          llm: {
            systemPrompt: SECRET_SYSTEM_PROMPT,
            outputSchema: { title: SECRET_OUTPUT_SCHEMA },
          },
          tool: {
            name: "fetch_pages",
            schema: { secret: SECRET_TOOL_SCHEMA },
          },
          inputSchema: { $schema: "SECRET_INPUT_SCHEMA" },
          outputSchema: { title: SECRET_OUTPUT_SCHEMA },
          transitions: [{ on: "::AI.NEXT", to: "END" }],
        },
        { id: "END", type: "END", label: "End" },
      ],
    };
    const map = buildPhaseMap(dsl);
    const blob = `${formatPhaseMap(map)}\n${JSON.stringify(map)}`;
    expect(blob).not.toContain(SECRET_SYSTEM_PROMPT);
    expect(blob).not.toContain(SECRET_TOOL_SCHEMA);
    expect(blob).not.toContain(SECRET_OUTPUT_SCHEMA);
    expect(blob).not.toContain("SECRET_INPUT_SCHEMA");
    expect(blob.toLowerCase()).not.toContain("systemprompt");
    expect(blob).not.toMatch(/"properties"\s*:/);
  });

  it("splits clusters on SYSTEM_FUNCTION boundaries via connected components", () => {
    const dsl: FsmDsl = {
      states: [
        {
          id: "S0",
          type: "START",
          label: "Start",
          transitions: [{ to: "A" }],
        },
        {
          id: "A",
          type: "SCRIPT",
          label: "Ingest",
          description: "Fetch source pages",
          transitions: [{ to: "SF1" }],
        },
        {
          id: "SF1",
          type: "SYSTEM_FUNCTION",
          label: "Checkpoint 1",
          transitions: [{ to: "B" }],
        },
        {
          id: "B",
          type: "AI",
          label: "Transform",
          description: "Summarize ingested pages",
          llm: { systemPrompt: SECRET_SYSTEM_PROMPT },
          transitions: [{ to: "END" }],
        },
        { id: "END", type: "END", label: "Done" },
      ],
    };
    const map = buildPhaseMap(dsl);
    expect(map.clusters.length).toBe(2);
    expect(map.clusters[0]?.stateCount).toBe(2); // S0, A
    expect(map.clusters[1]?.stateCount).toBe(2); // B, END
    expect(map.clusters.map((c) => c.summary).join(" ")).toContain("Fetch source pages");
    expect(formatPhaseMap(map)).not.toContain(SECRET_SYSTEM_PROMPT);
  });

  it("uses SYSTEM_FUNCTION enabledStateIds as groupings when present", () => {
    const dsl: FsmDsl = {
      states: [
        { id: "S0", type: "START", label: "Start", transitions: [{ to: "SF1" }] },
        {
          id: "SF1",
          type: "SYSTEM_FUNCTION",
          label: "Ingest mask",
          checkpoint: { enabledStateIds: ["A", "B"] },
          transitions: [{ to: "A" }],
        },
        { id: "A", type: "SCRIPT", label: "Fetch", description: "Pull URLs" },
        { id: "B", type: "SCRIPT", label: "Parse", description: "Parse HTML" },
        { id: "END", type: "END", label: "End" },
      ],
    };
    const map = buildPhaseMap(dsl);
    const ingest = map.clusters.find((c) => c.id === "SF1");
    expect(ingest).toBeDefined();
    expect(ingest?.stateCount).toBe(2);
    expect(ingest?.label).toBe("Ingest mask");
    expect(ingest?.summary).toContain("Pull URLs");
  });

  it("never truncates mid-cluster when dropping overflow", () => {
    const map = buildPhaseMap(manyStateFixture(80), undefined, 80);
    expect(map.estimatedTokens).toBeLessThanOrEqual(80);
    const text = formatPhaseMap(map);
    for (const c of map.clusters) {
      expect(text).toContain(`- ${c.id}:`);
      expect(text).toContain(`(${c.stateCount} states)`);
    }
    expect(text).toMatch(/\+\d+ more clusters/);
  });
});
