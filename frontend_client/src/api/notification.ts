import { mockNotifications } from "../mock/notificationData";
import type { NotificationItem } from "../types/notification";

export type NotificationFilter = "all" | "unread";

let inMemoryNotifications: NotificationItem[] = [...mockNotifications];

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getNotifications(
  filter: NotificationFilter = "all"
): Promise<NotificationItem[]> {
  await wait(180);

  if (filter === "unread") {
    return inMemoryNotifications.filter((item) => !item.isRead);
  }

  return inMemoryNotifications;
}

export async function getUnreadNotificationCount(): Promise<number> {
  await wait(100);

  return inMemoryNotifications.filter((item) => !item.isRead).length;
}

export async function markNotificationAsRead(
  notificationId: string
): Promise<{ success: boolean }> {
  await wait(120);

  inMemoryNotifications = inMemoryNotifications.map((item) =>
    item.id === notificationId ? { ...item, isRead: true } : item
  );

  return { success: true };
}

export async function markAllNotificationsAsRead(): Promise<{ success: boolean }> {
  await wait(150);

  inMemoryNotifications = inMemoryNotifications.map((item) => ({
    ...item,
    isRead: true,
  }));

  return { success: true };
}