export const NOTIFICATION_TYPES = [
  "run.succeeded",
  "run.failed",
  "run.interrupted",
  "human.awaiting",
  "schedule.fired",
  "budget.exceeded",
  "credential.failed",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type Severity = "info" | "warning" | "error";

export const DEFAULT_SEVERITY: Record<NotificationType, Severity> = {
  "run.succeeded": "info",
  "run.failed": "error",
  "run.interrupted": "warning",
  "human.awaiting": "warning",
  "schedule.fired": "info",
  "budget.exceeded": "error",
  "credential.failed": "error",
};

export const READ_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const UNREAD_BADGE_CAP = 99;

export type NotifyInput = {
  type: NotificationType;
  severity?: Severity;
  title: string;
  body?: string;
  projectId?: number;
  runId?: number;
  linkPath?: string;
  dedupeKey?: string;
};

export type NotificationItem = {
  id: number;
  projectId: number | null;
  runId: number | null;
  type: NotificationType;
  severity: Severity;
  title: string;
  body: string | null;
  linkPath: string | null;
  dedupeKey: string | null;
  readAt: Date | null;
  createdAt: Date;
  count: number;
};

export type NotificationScope = {
  projectId?: number;
};

export type ListNotificationsOptions = NotificationScope & {
  severity?: Severity;
  unreadOnly?: boolean;
  limit?: number;
};

export function formatUnreadBadge(count: number): string {
  if (count <= 0) return "";
  if (count > UNREAD_BADGE_CAP) return `${UNREAD_BADGE_CAP}+`;
  return String(count);
}

export function defaultSeverityFor(type: NotificationType): Severity {
  return DEFAULT_SEVERITY[type];
}
