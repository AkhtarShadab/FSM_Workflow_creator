import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EnvelopeError,
  assertPlatformSecret,
  isSealed,
  open,
  seal,
} from "./envelope";

const SECRET = "test-platform-secret-s2";

beforeEach(() => {
  vi.stubEnv("PLATFORM_SECRET", SECRET);
  vi.stubEnv("PLATFORM_SECRET_PREVIOUS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("credential envelope", () => {
  it("round-trips ASCII, unicode, and 4 KB keys", () => {
    const samples = [
      "sk-ascii-key-123",
      "sk-unicodé-🔑-ключ",
      randomBytes(2048).toString("hex"), // 4 KB hex
    ];
    for (const plaintext of samples) {
      const envelope = seal(plaintext);
      expect(envelope.startsWith("v1.")).toBe(true);
      expect(envelope.split(".")).toHaveLength(5);
      expect(open(envelope)).toBe(plaintext);
    }
  });

  it("produces unique envelopes for the same plaintext", () => {
    const plaintext = "sk-same-key";
    const a = seal(plaintext);
    const b = seal(plaintext);
    expect(a).not.toBe(b);
    expect(open(a)).toBe(plaintext);
    expect(open(b)).toBe(plaintext);
  });

  it("throws EnvelopeError when one ciphertext byte is flipped", () => {
    const envelope = seal("sk-tamper-me");
    const parts = envelope.split(".");
    const ciphertext = Buffer.from(parts[3], "base64url");
    ciphertext[0] = ciphertext[0] ^ 0xff;
    parts[3] = ciphertext.toString("base64url");
    const tampered = parts.join(".");
    expect(() => open(tampered)).toThrow(EnvelopeError);
  });

  it("throws EnvelopeError with a different PLATFORM_SECRET and no PREVIOUS", () => {
    const envelope = seal("sk-rotate-fail");
    vi.stubEnv("PLATFORM_SECRET", "a-different-secret");
    vi.stubEnv("PLATFORM_SECRET_PREVIOUS", "");
    expect(() => open(envelope)).toThrow(EnvelopeError);
  });

  it("opens with PLATFORM_SECRET_PREVIOUS after rotation", () => {
    const plaintext = "sk-previous-secret-ok";
    const envelope = seal(plaintext);
    vi.stubEnv("PLATFORM_SECRET", "the-new-platform-secret");
    vi.stubEnv("PLATFORM_SECRET_PREVIOUS", SECRET);
    expect(open(envelope)).toBe(plaintext);
  });

  it("throws at seal/open and assertPlatformSecret when PLATFORM_SECRET is missing", () => {
    vi.stubEnv("PLATFORM_SECRET", "");
    vi.stubEnv("PLATFORM_SECRET_PREVIOUS", "");
    expect(() => assertPlatformSecret()).toThrow(/PLATFORM_SECRET/);
    expect(() => seal("sk-x")).toThrow(/PLATFORM_SECRET/);
    expect(() => open("v1.a.b.c.d")).toThrow(/PLATFORM_SECRET/);
  });

  it("does not throw on import when PLATFORM_SECRET is unset", async () => {
    vi.unstubAllEnvs();
    delete process.env.PLATFORM_SECRET;
    delete process.env.PLATFORM_SECRET_PREVIOUS;
    const mod = await import("./envelope");
    expect(typeof mod.seal).toBe("function");
    expect(() => mod.assertPlatformSecret()).toThrow(/PLATFORM_SECRET/);
  });

  it("isSealed rejects plaintext and malformed v1. strings", () => {
    expect(isSealed("sk-plaintext-key")).toBe(false);
    expect(isSealed("v1.")).toBe(false);
    expect(isSealed("v1.a.b.c")).toBe(false);
    expect(isSealed("v1.a.b.c.d")).toBe(false);
    expect(isSealed("v2.aaaa.bbbb.cccc.dddd")).toBe(false);
    expect(isSealed(seal("sk-sealed"))).toBe(true);
  });
});
