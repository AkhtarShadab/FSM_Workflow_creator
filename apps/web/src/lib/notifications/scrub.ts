const REDACTED = "[REDACTED]";

/** Vendor-prefixed keys (OpenAI/Anthropic `sk-`, GitHub, AWS, Google, Slack). */
const VENDOR_KEY_RE =
  /\b(?:sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/gi;

/** Mixed alphanumeric tokens of length ≥ 20 (letters and digits). */
const MIXED_SECRET_RE =
  /\b(?=[A-Za-z0-9+/=_-]*[A-Za-z])(?=[A-Za-z0-9+/=_-]*\d)[A-Za-z0-9+/=_-]{20,}\b/g;

const BEARER_RE = /\bBearer\s+[A-Za-z0-9._\-+=/]{16,}/gi;

export function scrubSecrets(value: string): string {
  return value
    .replace(VENDOR_KEY_RE, REDACTED)
    .replace(BEARER_RE, `Bearer ${REDACTED}`)
    .replace(MIXED_SECRET_RE, REDACTED);
}

export function scrubOptional(value: string | null | undefined): string | null {
  if (value == null) return null;
  return scrubSecrets(value);
}
