import { describe, expect, it } from "vitest";
import { CREDENTIAL_SUMMARY_KEYS } from "@/lib/credentials/types";
import {
  deleteApiKeyFields,
  migrateCredentialPersist,
  persistedContainsApiKey,
} from "./credential-store";

const LEGACY_KEY = "sk-super-secret-legacy-key-value-123456";

const v1State = {
  credentials: [
    {
      id: "cred_abc",
      label: "Personal OpenAI",
      provider: "openai",
      baseUrl: "https://api.openai.com",
      apiKey: LEGACY_KEY,
      models: ["gpt-4o"],
      active: true,
      discoveryStatus: "ok",
      discoveryError: undefined,
      discoveredAt: 1_700_000_000_000,
    },
    {
      id: "cred_nested",
      label: "nested",
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-another-long-secret-key",
      models: [],
      active: false,
      discoveryStatus: "idle",
    },
  ],
  activeId: "cred_abc",
};

describe("credential store v2 migration", () => {
  it("removes apiKey from every persisted entry", () => {
    expect(persistedContainsApiKey(v1State)).toBe(true);

    const migrated = migrateCredentialPersist(v1State, 1);
    const json = JSON.stringify(migrated);

    expect(persistedContainsApiKey(migrated)).toBe(false);
    expect(json).not.toContain("apiKey");
    expect(json).not.toContain(LEGACY_KEY);
    expect(json).not.toContain("sk-another-long-secret-key");
    expect(deleteApiKeyFields(v1State)).not.toHaveProperty(
      "credentials.0.apiKey"
    );
    expect(migrated.credentials).toEqual([]);
    expect(migrated.showReentryBanner).toBe(true);
    expect(migrated.activeId).toBeNull();
  });

  it("keeps CredentialSummary-shaped rows and no extra secret fields", () => {
    const serverShaped = {
      credentials: [
        {
          id: 7,
          provider: "openai",
          label: "prod",
          baseUrl: "https://api.openai.com",
          last4: "4f2a",
          active: true,
          models: ["gpt-4o"],
          discoveryStatus: "ok",
          discoveryError: null,
          discoveredAt: 1_700_000_000_000,
          apiKey: LEGACY_KEY,
          encryptedKey: "v1.should-not-survive",
        },
      ],
      activeId: 7,
    };

    const migrated = migrateCredentialPersist(serverShaped, 2);
    expect(migrated.credentials).toHaveLength(1);
    const row = migrated.credentials[0];
    expect(Object.keys(row).sort()).toEqual([...CREDENTIAL_SUMMARY_KEYS].sort());
    expect(row).not.toHaveProperty("apiKey");
    expect(row).not.toHaveProperty("encryptedKey");
    expect(row.last4).toBe("4f2a");
    expect(JSON.stringify(migrated)).not.toContain(LEGACY_KEY);
    expect(JSON.stringify(migrated)).not.toContain("v1.should-not-survive");
    expect(migrated.showReentryBanner).toBe(true);
  });

  it("deleteApiKeyFields strips nested apiKey keys", () => {
    const nested = { outer: { apiKey: "sk-hidden", keep: 1 }, apiKey: "x" };
    expect(deleteApiKeyFields(nested)).toEqual({ outer: { keep: 1 } });
  });
});
