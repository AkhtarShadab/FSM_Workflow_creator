# 005 — Credential Security

> Status: **Detailed**
> Relates to: [DETAILED_DESIGN_PLAN.md](../DETAILED_DESIGN_PLAN.md) §§9, 14 · Roadmap Wave 0
> Code today: [`credential-store.ts`](../apps/web/src/stores/credential-store.ts) (localStorage), [`discover/route.ts`](../apps/web/src/app/api/credentials/discover/route.ts), [`url-guard.ts`](../apps/web/src/lib/url-guard.ts)
> Blocks: 003 · Implement with: **ship-feature** (Composer/Grok)

---

## What

Move BYOK keys off the browser and into the database encrypted with AES-256-GCM, so the client only ever sees redacted metadata and the server is the only party that can decrypt a key.

## Why

Every API key a user adds is written to `localStorage` in plaintext and re-sent to the server on each discovery call — the `credentials` table exists but is never touched, and the store comment still says "real storage is AES-256-GCM server-side" as an aspiration. Any XSS, shared machine, or browser sync exposes every key. Live executors (003) also need the server to hold keys at call time, so this is a hard prerequisite, not a hardening pass.

**S1 (SSRF hardening) already shipped** with the C2–C6 PR: [`validatePublicHttpUrl`](../apps/web/src/lib/url-guard.ts) plus a DNS re-check blocks private, loopback, link-local, and metadata hosts. What remains is storage and lifecycle.

## How

### Envelope format

Single self-describing string in `credentials.encrypted_key`:

```
v1.<base64url salt>.<base64url iv>.<base64url ciphertext>.<base64url authTag>
```

- Key derivation: `hkdfSync("sha256", PLATFORM_SECRET, salt(16B), "fsm-credential-v1", 32)` — per-row salt, so one leaked derived key does not unlock the table.
- Cipher: `aes-256-gcm`, 12-byte random IV, 16-byte auth tag.
- `PLATFORM_SECRET` is required at boot; the server refuses to start without it (fail closed, never fall back to plaintext).
- Rotation: `PLATFORM_SECRET_PREVIOUS` is accepted for **decrypt only**; a `rotateEncryption()` maintenance action re-encrypts every row with the current secret.

```ts
// apps/web/src/lib/crypto/envelope.ts
export function seal(plaintext: string): string;
export function open(envelope: string): string;   // throws EnvelopeError on tamper / wrong secret
export function isSealed(value: string): boolean;
```

### Redacted client model

The client never receives `apiKey`. `listCredentials()` returns:

```ts
interface CredentialSummary {
  id: number;
  provider: "openai" | "anthropic" | "openai-compatible";
  label: string;
  baseUrl: string | null;
  last4: string;              // from the plaintext at create time, stored as a column
  active: boolean;
  models: string[];           // last discovery result
  discoveryStatus: "idle" | "ok" | "error";
  discoveryError: string | null;
  discoveredAt: number | null;
}
```

Schema delta on `credentials`: add `last4 TEXT NOT NULL`, `active INTEGER NOT NULL DEFAULT 1`, `models_json TEXT`, `discovery_status TEXT`, `discovery_error TEXT`, `discovered_at INTEGER`, `revoked_at INTEGER`.

### Server API

| Function | File | Notes |
|----------|------|-------|
| `createCredential({provider,label,baseUrl,apiKey})` | `src/app/settings/credentials/actions.ts` (new) | Seals the key, stores `last4`, returns a `CredentialSummary` |
| `listCredentials()` | same | Redacted summaries only |
| `rotateCredential(id, newApiKey)` | same | Re-seals in place, keeps `id` so node bindings survive |
| `revokeCredential(id)` | same | Sets `revoked_at`, clears the ciphertext, keeps the row for audit |
| `discoverModels(credentialId)` | rewritten `POST /api/credentials/discover` | Body becomes `{ credentialId }` only; key is loaded and opened server-side |
| `getDecryptedKey(id)` | `src/lib/credentials/server.ts` (new, **server-only**) | The single call site allowed to `open()`; consumed by 003 |

`src/lib/credentials/server.ts` carries `import "server-only"` so a client import fails at build time.

### Store migration

`credential-store` drops to a thin cache of `CredentialSummary`. Bump `persist` to `version: 2` with a `migrate` that **deletes any `apiKey` field** from previously persisted state, so upgrading users are scrubbed on first load. A one-time banner explains that existing keys must be re-entered (old plaintext keys are not silently uploaded).

### UI implications

[`credentials-view.tsx`](../apps/web/src/components/credentials/credentials-view.tsx): key input becomes write-only (`•••• 4f2a` after save), plus **Rotate** and **Revoke** actions and a "stored encrypted on the server" note. [`inspector-cards.tsx`](../apps/web/src/components/inspector/inspector-cards.tsx) keeps binding by `credentialId` — unchanged, since it never used the raw key.

## File / API change map

| Phase | Touch | Change |
|-------|-------|--------|
| S2 | `src/lib/crypto/envelope.ts` (new) | `seal` / `open` / `isSealed`, boot check for `PLATFORM_SECRET` |
| S2 | `src/app/settings/credentials/actions.ts` (new) | CRUD returning redacted summaries (columns already in SB0) |
| S2 | `src/lib/credentials/server.ts` (new) | `getDecryptedKey`, `server-only` guard |
| S2 | `src/app/api/credentials/discover/route.ts` | Accept `{ credentialId }`; drop `apiKey` from the request body |
| S3 | `src/stores/credential-store.ts` | v2 migration that strips `apiKey`; summaries only |
| S3 | `src/components/credentials/credentials-view.tsx` | Write-only input, rotate/revoke UX, masked display |
| S3 | `.env.example`, `README.md` | Document `PLATFORM_SECRET` / `PLATFORM_SECRET_PREVIOUS` |

## Edge cases & failure modes

| Case | Expected behavior |
|------|-------------------|
| `PLATFORM_SECRET` missing | Server refuses to boot with a clear message; never stores plaintext |
| `PLATFORM_SECRET` changed without `PREVIOUS` | `open()` throws `EnvelopeError`; credential shows `needs re-entry`, no crash |
| Tampered ciphertext | GCM auth tag fails → `EnvelopeError`, treated as revoked |
| Discovery for a revoked credential | 409 `CREDENTIAL_REVOKED` |
| Node bound to a deleted credential | Existing `brokenRef` lint keeps firing (001 behavior preserved) |
| Legacy localStorage keys | Wiped by the v2 migration; user re-enters once |
| Log/error paths | Envelope and plaintext are never logged; errors carry `credentialId` only |
| Export bundles (004) | Never include ciphertext or plaintext; emit `.env.example` placeholders |

## Open questions

1. Should revocation hard-delete the row after an audit window, or keep tombstones forever?
2. Per-key spend caps (Q16) — this feature or 011's budget ledger?

## Implementation phases

| Phase | Scope | Size |
|-------|-------|------|
| S1 | SSRF / host validation on discovery | **Shipped** (PR #3) |
| S2 | Envelope + server CRUD + discovery by `credentialId` (columns already in SB0) | 1 PR |
| S3 | Client store scrub + write-only UI + rotate/revoke | 1 PR |

## Test plan

**Vitest** — `src/lib/crypto/envelope.test.ts`, `src/lib/credentials/redaction.test.ts`

- `seal` → `open` round-trips ASCII, unicode, and 4 KB keys.
- Two `seal()` calls on the same plaintext produce different envelopes (unique salt + IV).
- Flipping one ciphertext byte makes `open()` throw `EnvelopeError`.
- Opening with a different `PLATFORM_SECRET` throws; opening with `PLATFORM_SECRET_PREVIOUS` succeeds.
- Missing `PLATFORM_SECRET` throws at module init.
- `isSealed` rejects plaintext and malformed `v1.` strings.
- `listCredentials()` output contains no property whose value matches the plaintext key (property-based over 20 random keys).
- `last4` equals the final four characters of the plaintext.
- Store v1→v2 migration removes `apiKey` from every persisted entry.

**Playwright** — `e2e/credential-security.spec.ts`

- Add a credential → `localStorage` snapshot contains neither the key nor any 20+ char secret-looking substring.
- Reload → credential still listed, masked as `•••• last4`.
- Discover models → succeeds while the request body contains only `credentialId` (assert via `page.route` interception).
- Rotate a key → bound AI node keeps working; `last4` updates.
- Revoke → discovery returns an error state and the node lint flags the broken reference.

## Acceptance criteria

- [ ] No API key is present in `localStorage`, Zustand state, or any client-visible response.
- [ ] `credentials.encrypted_key` holds a `v1.` GCM envelope; tampering is detected.
- [ ] Discovery works from `credentialId` alone.
- [ ] Rotate preserves `id` so node bindings survive; revoke fails closed.
- [ ] Server refuses to start without `PLATFORM_SECRET`.
- [ ] Vitest and Playwright suites above pass in CI.
