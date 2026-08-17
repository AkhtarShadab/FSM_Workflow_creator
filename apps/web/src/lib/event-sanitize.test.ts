import { describe, expect, it } from "vitest";
import { sanitizeEventPayload } from "./event-sanitize";

describe("event payload sanitizer", () => {
  it("redacts apiKey and authorization fields", () => {
    const cleaned = sanitizeEventPayload({
      text: "ok",
      apiKey: "sk-secret",
      nested: { authorization: "Bearer sk-secret", n: 1 },
    });
    expect(cleaned).toEqual({
      text: "ok",
      apiKey: "[redacted]",
      nested: { authorization: "[redacted]", n: 1 },
    });
  });
});
