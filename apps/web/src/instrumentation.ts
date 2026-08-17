export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { assertPlatformSecret } = await import("@/lib/crypto/envelope");
  assertPlatformSecret();
}
