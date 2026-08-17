import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_SUMMARY_KEYS,
  last4Of,
  toCredentialSummary,
  type CredentialSummary,
} from "./types";

function collectStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") {
    into.push(value);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
    return into;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      into.push(key);
      collectStrings(nested, into);
    }
  }
  return into;
}

function listCredentialsShaped(
  plaintext: string,
  extras?: Partial<{
    encryptedKey: string;
    apiKey: string;
    models: string[];
  }>
): CredentialSummary {
  return toCredentialSummary({
    id: 7,
    provider: "openai",
    label: "prod",
    baseUrl: "https://api.openai.com",
    last4: last4Of(plaintext),
    active: true,
    modelsJson: JSON.stringify(extras?.models ?? ["gpt-4o"]),
    discoveryStatus: "ok",
    discoveryError: null,
    discoveredAt: 1_700_000_000_000,
  });
}

describe("credential redaction", () => {
  it("listCredentials-shaped objects never contain the plaintext (20 random keys)", () => {
    for (let i = 0; i < 20; i++) {
      const plaintext = `sk-${randomBytes(24).toString("hex")}`;
      const summary = listCredentialsShaped(plaintext, {
        encryptedKey: `v1.should-not-leak.${plaintext}`,
        apiKey: plaintext,
      });

      expect(summary).not.toHaveProperty("apiKey");
      expect(summary).not.toHaveProperty("encryptedKey");
      expect(Object.keys(summary).sort()).toEqual(
        [...CREDENTIAL_SUMMARY_KEYS].sort()
      );
      expect(summary.last4).toBe(plaintext.slice(-4));
      expect(summary.last4).toBe(last4Of(plaintext));

      const strings = collectStrings(summary);
      expect(strings).not.toContain(plaintext);
      expect(JSON.stringify(summary)).not.toContain(plaintext);
    }
  });

  it("last4 equals the final four characters of the plaintext", () => {
    expect(last4Of("sk-abc4f2a")).toBe("4f2a");
    expect(last4Of("abcd")).toBe("abcd");
    expect(last4Of("ab")).toBe("ab");
  });
});
