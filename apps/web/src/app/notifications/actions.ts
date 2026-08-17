"use server";

import { revalidatePath } from "next/cache";
import {
  clearRead as clearReadQuery,
  getUnreadCount as getUnreadCountQuery,
  listNotifications as listNotificationsQuery,
  markAllRead as markAllReadQuery,
  markRead as markReadQuery,
} from "@/lib/notifications/queries";
import type {
  ListNotificationsOptions,
  NotificationItem,
  NotificationScope,
} from "@/lib/notifications/types";

export type {
  ListNotificationsOptions,
  NotificationItem,
  NotificationScope,
};

function refreshInbox(): void {
  try {
    revalidatePath("/notifications");
    revalidatePath("/");
  } catch {
    // Unit tests (and any non-request context) skip cache invalidation.
  }
}

export async function listNotifications(
  opts: ListNotificationsOptions = {}
): Promise<NotificationItem[]> {
  return listNotificationsQuery(opts);
}

export async function getUnreadCount(
  scope: NotificationScope = {}
): Promise<{ count: number; badge: string }> {
  return getUnreadCountQuery(scope);
}

export async function markRead(id: number): Promise<void> {
  await markReadQuery(id);
  refreshInbox();
}

export async function markAllRead(
  scope: NotificationScope = {}
): Promise<void> {
  await markAllReadQuery(scope);
  refreshInbox();
}

export async function clearRead(
  scope: NotificationScope = {}
): Promise<void> {
  await clearReadQuery(scope);
  refreshInbox();
}
