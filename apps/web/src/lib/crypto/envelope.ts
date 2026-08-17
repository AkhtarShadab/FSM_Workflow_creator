import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";
const HKDF_INFO = "fsm-credential-v1";
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const CIPHER = "aes-256-gcm";

export class EnvelopeError extends Error {
  constructor(message = "Invalid credential envelope") {
    super(message);
    this.name = "EnvelopeError";
  }
}

/** Lazy env read so importing this module does not crash unrelated Next routes. */
function readSecret(name: "PLATFORM_SECRET" | "PLATFORM_SECRET_PREVIOUS"): string | undefined {
  const value = process.env[name];
  if (value == null || value.length === 0) return undefined;
  return value;
}

function requirePlatformSecret(): string {
  const secret = readSecret("PLATFORM_SECRET");
  if (!secret) {
    throw new Error(
      "PLATFORM_SECRET is required; cannot seal or open credentials"
    );
  }
  return secret;
}

/** Fail-closed boot check. Call from instrumentation / server startup, not at import. */
export function assertPlatformSecret(): void {
  if (!readSecret("PLATFORM_SECRET")) {
    throw new Error(
      "PLATFORM_SECRET is required; refusing to start without a credential wrapping key"
    );
  }
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, salt, HKDF_INFO, KEY_LEN));
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromB64url(value: string): Buffer {
  if (/[^A-Za-z0-9_-]/.test(value)) {
    throw new EnvelopeError();
  }
  return Buffer.from(value, "base64url");
}

function parseEnvelope(envelope: string): {
  salt: Buffer;
  iv: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
} {
  const parts = envelope.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new EnvelopeError();
  }
  const salt = fromB64url(parts[1]);
  const iv = fromB64url(parts[2]);
  const ciphertext = fromB64url(parts[3]);
  const authTag = fromB64url(parts[4]);
  if (
    salt.length !== SALT_LEN ||
    iv.length !== IV_LEN ||
    authTag.length !== TAG_LEN
  ) {
    throw new EnvelopeError();
  }
  return { salt, iv, ciphertext, authTag };
}

export function isSealed(value: string): boolean {
  if (typeof value !== "string" || !value.startsWith(`${VERSION}.`)) {
    return false;
  }
  try {
    parseEnvelope(value);
    return true;
  } catch {
    return false;
  }
}

export function seal(plaintext: string): string {
  const secret = requirePlatformSecret();
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(secret, salt);
  const cipher = createCipheriv(CIPHER, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  if (authTag.length !== TAG_LEN) {
    throw new EnvelopeError("Unexpected GCM tag length");
  }
  return [
    VERSION,
    b64url(salt),
    b64url(iv),
    b64url(ciphertext),
    b64url(authTag),
  ].join(".");
}

function decryptWithSecret(envelope: string, secret: string): string {
  const { salt, iv, ciphertext, authTag } = parseEnvelope(envelope);
  const key = deriveKey(secret, salt);
  const decipher = createDecipheriv(CIPHER, key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new EnvelopeError();
  }
}

export function open(envelope: string): string {
  const secret = requirePlatformSecret();
  try {
    return decryptWithSecret(envelope, secret);
  } catch (err) {
    if (!(err instanceof EnvelopeError)) throw err;
    const previous = readSecret("PLATFORM_SECRET_PREVIOUS");
    if (!previous) throw err;
    try {
      return decryptWithSecret(envelope, previous);
    } catch {
      throw new EnvelopeError();
    }
  }
}
