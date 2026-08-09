# 005 — Credential Security

> Status: **Design**  
> Relates to: [DETAILED_DESIGN_PLAN.md](../DETAILED_DESIGN_PLAN.md) §§9, 14  
> Code today: credentials + discovery under `apps/web` (client-influenced storage / fetch)  
> Expand with: **detail-feature** (high-end) · Implement with: **ship-feature** (Composer/Grok)

---

## What

Server-side **encrypted credential storage** and **SSRF-safe** model discovery so BYOK keys never sit in plaintext and discovery cannot target arbitrary internal hosts.

## How

- Encrypt `credentials` rows at rest (AES via `PLATFORM_SECRET` / KMS later)
- Discovery endpoint: allowlist / block private & link-local ranges; validate URL scheme/host
- Never echo secrets back to the client; return capability tokens / redacted metadata only
- Align with live executors (003) so only the server holds raw keys at call time

## Why

Bugbot flagged high-severity risk (SSRF + key handling). Real deployment and live executors are blocked until credentials are handled safely.

---

## Goals & non-goals

### Goals

- Encrypted credential persistence
- Hardened discovery (host allowlist / SSRF guards)
- Clear key lifecycle: create, rotate, revoke

### Non-goals

- Full org/team RBAC (depends on Q2)
- Bring-your-own KMS in v1 (env secret first)

---

## Open questions

1. Encryption envelope format and rotation story for `PLATFORM_SECRET`?
2. Discovery allowlist: fixed public API hosts only, or user-declared OpenAI-compatible bases?

---

## Suggested implementation phases

| Phase | Scope |
|-------|--------|
| S1 | SSRF / host validation on discovery (complete hardening) |
| S2 | Encrypt-at-rest for credential secrets |
| S3 | Redacted client API + rotation UX |
