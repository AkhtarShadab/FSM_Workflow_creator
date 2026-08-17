export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { assertPlatformSecret } = await import("@/lib/crypto/envelope");
  assertPlatformSecret();
  const { reconcileOrphanedRuns, runSupervisor } = await import(
    "@/lib/run-supervisor"
  );
  // Only `running` rows become `interrupted`. `awaiting_human` stays parked
  // so a later POST /human/[taskId] can wake the waiter.
  // Crash recovery: resume those newly interrupted runs at cursor nextStateId
  // (do not restart from START when a cursor exists).
  const crashed =
    (await runSupervisor.store.listRunIdsByStatus?.("running")) ?? [];
  await reconcileOrphanedRuns();
  await runSupervisor.resumeCrashedRuns(crashed);
}
