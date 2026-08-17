export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { assertPlatformSecret } = await import("@/lib/crypto/envelope");
  assertPlatformSecret();
  const { reconcileOrphanedRuns } = await import("@/lib/run-supervisor");
  await reconcileOrphanedRuns();
}
