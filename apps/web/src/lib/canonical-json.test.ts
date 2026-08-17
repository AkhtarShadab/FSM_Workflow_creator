import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, contentHash } from "./canonical-json";

describe("canonicalJson", () => {
  it("is key-order independent", () => {
    const a = { z: 1, a: { d: 4, c: 3 }, b: 2 };
    const b = { a: { c: 3, d: 4 }, b: 2, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"c":3,"d":4},"b":2,"z":1}');
  });

  it("preserves array order", () => {
    expect(canonicalJson([1, 2, 3])).toBe("[1,2,3]");
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it("sorts keys inside array elements", () => {
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it("keeps updatedAt/createdAt for storage payloads", () => {
    const json = canonicalJson({
      id: "n1",
      updatedAt: 111,
      createdAt: 100,
    });
    expect(json).toContain('"updatedAt":111');
    expect(json).toContain('"createdAt":100');
  });
});

describe("contentHash", () => {
  it("hashes the canonical JSON of a value", () => {
    const value = { b: 1, a: 2 };
    const expected = createHash("sha256")
      .update(canonicalJson(value))
      .digest("hex");
    expect(contentHash(value)).toBe(expected);
    expect(contentHash(value)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is equal for canvases that differ only in key order", () => {
    const left = {
      nodes: [{ id: "n1", data: { label: "Start", config: { x: 1 } } }],
      edges: [],
    };
    const right = {
      edges: [],
      nodes: [{ data: { config: { x: 1 }, label: "Start" }, id: "n1" }],
    };
    expect(contentHash(left)).toBe(contentHash(right));
  });

  it("changes when a node's config changes", () => {
    const base = {
      nodes: [
        {
          id: "n1",
          position: { x: 10, y: 20 },
          data: { label: "AI", config: { model: "a" } },
        },
      ],
      edges: [],
    };
    const changed = {
      nodes: [
        {
          id: "n1",
          position: { x: 10, y: 20 },
          data: { label: "AI", config: { model: "b" } },
        },
      ],
      edges: [],
    };
    expect(contentHash(base)).not.toBe(contentHash(changed));
  });

  it("is unchanged when only updatedAt/createdAt differ at any depth", () => {
    const a = {
      createdAt: 1,
      nodes: [
        {
          id: "n1",
          updatedAt: 10,
          data: { label: "Start", createdAt: 2, nested: { updatedAt: 3, k: 1 } },
        },
      ],
    };
    const b = {
      createdAt: 999,
      nodes: [
        {
          id: "n1",
          updatedAt: 888,
          data: {
            label: "Start",
            createdAt: 777,
            nested: { updatedAt: 666, k: 1 },
          },
        },
      ],
    };
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it("includes node positions in the hash", () => {
    const a = { nodes: [{ id: "n1", position: { x: 0, y: 0 } }] };
    const b = { nodes: [{ id: "n1", position: { x: 40, y: 80 } }] };
    expect(contentHash(a)).not.toBe(contentHash(b));
  });
});
