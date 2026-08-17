import { describe, expect, it } from "vitest";
import { swapToolSchemas, type ToolSchema } from "./mask";

const ingest: ToolSchema[] = [
  {
    name: "fetch_pages",
    stateId: "S1",
    schema: { type: "object", properties: { url: { type: "string" } } },
  },
  {
    name: "parse_html",
    stateId: "S2",
    schema: { type: "object", properties: { html: { type: "string" } } },
  },
];

const transform: ToolSchema[] = [
  {
    name: "embed",
    stateId: "T1",
    schema: { type: "object", properties: { text: { type: "string" } } },
  },
  {
    name: "write_index",
    stateId: "T2",
    schema: { type: "object", properties: { vec: { type: "array" } } },
  },
];

describe("swapToolSchemas", () => {
  it("unloads the finished cluster's schemas and loads exactly the next cluster's", () => {
    const current = [...ingest, { name: "stale_tool", schema: { leftover: true } }];
    const result = swapToolSchemas(current, ingest, transform);

    expect(result.loaded.map((s) => s.name)).toEqual(["embed", "write_index"]);
    expect(result.loaded).toHaveLength(transform.length);
    expect(result.loaded.map((s) => s.name).sort()).toEqual(
      transform.map((s) => s.name).sort()
    );
    expect(result.loaded.some((s) => ingest.some((f) => f.name === s.name))).toBe(
      false
    );
    expect(result.unloaded.map((s) => s.name).sort()).toEqual(
      ["fetch_pages", "parse_html", "stale_tool"].sort()
    );
  });

  it("does not keep a union of finished and next schemas", () => {
    const result = swapToolSchemas(ingest, ingest, transform);
    expect(result.loaded).toEqual(transform);
    expect(new Set(result.loaded.map((s) => s.name))).toEqual(
      new Set(["embed", "write_index"])
    );
  });
});
