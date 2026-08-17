import { describe, expect, it } from "vitest";
import { extractSymbols } from "./extractor";

const sample = `
/** Says hello. */
export function greet(name: string): string {
  return name;
}

export class Greeter {
  greet(name: string): string {
    return name;
  }
}

export type Greeting = string;
`;

describe("extractSymbols", () => {
  it("extracts functions, classes, methods, and types", () => {
    const symbols = extractSymbols("sample.ts", sample);
    const kinds = new Set(symbols.map((s) => s.kind));
    expect(kinds.has("function")).toBe(true);
    expect(kinds.has("class")).toBe(true);
    expect(kinds.has("method")).toBe(true);
    expect(kinds.has("type")).toBe(true);
  });

  it("uses docstring for intent when present", () => {
    const symbols = extractSymbols("sample.ts", sample);
    const greet = symbols.find((s) => s.name === "greet" && s.kind === "function");
    expect(greet?.intent).toBe("Says hello.");
  });

  it("builds stable identity strings", () => {
    const symbols = extractSymbols("sample.ts", sample);
    const greet = symbols.find((s) => s.name === "greet" && s.kind === "function");
    expect(greet?.identity).toContain("greet");
    expect(greet?.identity).toContain("string");
  });
});
