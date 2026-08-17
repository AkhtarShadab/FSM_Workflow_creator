export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { assertPlatformSecret } = await import("@/lib/crypto/envelope");
  assertPlatformSecret();
  const { reconcileOrphanedRuns } = await import("@/lib/run-supervisor");
  // Only `running` rows become `interrupted`. `awaiting_human` stays parked
  // so a later POST /human/[taskId] can wake the waiter.
  // Interrupted runs are resumable from `run.cursor` via POST /resume — do not
  // auto-restart from START when a cursor exists.
  await reconcileOrphanedRuns();
}
