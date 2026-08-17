export type AppDb = typeof import("@/db").db;

let override: AppDb | null = null;

export async function getNotificationsDb(explicit?: AppDb): Promise<AppDb> {
  if (explicit) return explicit;
  if (override) return override;
  const { db } = await import("@/db");
  return db;
}

/** Test-only: point notification reads/writes at a temp libSQL database. */
export function setNotificationsDbForTests(db: AppDb | null): void {
  override = db;
}
