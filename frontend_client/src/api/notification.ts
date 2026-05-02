import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { request } from "./client";
import { mockNotifications } from "../mock/notificationData";
import type {
  AlertRealtimePayload,
  BackendNotification,
  BookingRealtimePayload,
  NotificationItem,
  NotificationType,
} from "../types/notification";
import { USE_MOCK_API } from "../config/api";

export type NotificationFilter = "all" | "unread";

type NotificationSubscriber = (items: NotificationItem[], unreadCount: number) => void;

const READ_IDS_KEY = "spherecare_notification_read_ids";

let initialized = false;
let readIds = new Set<string>();
let baseNotifications: NotificationItem[] = [];
let realtimeNotifications: NotificationItem[] = [];
let subscribers = new Set<NotificationSubscriber>();
let loadPromise: Promise<void> | null = null;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getStoredValue(key: string) {
  if (Platform.OS === "web") {
    return localStorage.getItem(key);
  }

  return SecureStore.getItemAsync(key);
}

async function setStoredValue(key: string, value: string) {
  if (Platform.OS === "web") {
    localStorage.setItem(key, value);
    return;
  }

  await SecureStore.setItemAsync(key, value);
}

async function ensureInitialized() {
  if (initialized) return;

  const raw = await getStoredValue(READ_IDS_KEY);

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as string[];
      readIds = new Set(parsed);
    } catch {
      readIds = new Set<string>();
    }
  }

  initialized = true;
}

async function persistReadIds() {
  await setStoredValue(READ_IDS_KEY, JSON.stringify(Array.from(readIds)));
}

function formatTimeAgo(value?: string) {
  if (!value) return "Just now";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const diffMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} h ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays} d ago`;

  return date.toLocaleDateString();
}

function toNotificationType(category?: string): NotificationType {
  switch (category) {
    case "appointment":
      return "appointment";
    case "alert":
      return "alert";
    case "reminder":
      return "reminder";
    case "message":
      return "message";
    default:
      return "general";
  }
}

function withReadState(item: Omit<NotificationItem, "isRead">): NotificationItem {
  return {
    ...item,
    isRead: readIds.has(item.id),
  };
}

function sortNotifications(items: NotificationItem[]) {
  return [...items].sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
}

function getMergedNotifications() {
  const merged = new Map<string, NotificationItem>();

  for (const item of [...baseNotifications, ...realtimeNotifications]) {
    merged.set(item.id, item);
  }

  return sortNotifications(Array.from(merged.values()));
}

function notifySubscribers() {
  const merged = getMergedNotifications();
  const unreadCount = merged.filter((item) => !item.isRead).length;
  subscribers.forEach((listener) => listener(merged, unreadCount));
}

export function subscribeToNotificationUpdates(listener: NotificationSubscriber) {
  subscribers.add(listener);
  listener(getMergedNotifications(), getMergedNotifications().filter((item) => !item.isRead).length);

  return () => {
    subscribers.delete(listener);
  };
}

function mapBackendNotification(notification: BackendNotification): NotificationItem {
  const isConversationNotification =
    notification.category === "message" || notification.related_entity_type === "conversation";

  return withReadState({
    id: `server-${notification.id}`,
    type: toNotificationType(notification.category),
    title: notification.title,
    message: notification.body,
    timeAgo: formatTimeAgo(notification.created_at),
    action: {
      label: isConversationNotification
        ? "Open"
        : notification.category === "appointment"
          ? "View details"
          : "Open",
      variant: notification.is_priority ? "red" : "blue",
      actionType: isConversationNotification ? "open_conversation" : "view_details",
    },
    sourceId: notification.id,
    relatedEntityType: notification.related_entity_type ?? null,
    relatedEntityId: notification.related_entity_id ?? null,
    createdAt: notification.created_at,
  });
}

function buildBookingNotification(payload: BookingRealtimePayload): NotificationItem | null {
  if (payload.type === "booking_deleted") {
    const bookingId = payload.booking_id;
    if (!bookingId) return null;

    return withReadState({
      id: `booking-${bookingId}`,
      type: "appointment",
      title: "Booking cancelled",
      message: `Booking #${bookingId} was removed.`,
      timeAgo: "Just now",
      action: {
        label: "View details",
        variant: "blue",
        actionType: "view_details",
      },
      sourceId: bookingId,
      sourceEvent: payload.type,
      createdAt: new Date().toISOString(),
    });
  }

  const booking = payload.booking;
  if (!booking) return null;

  const residentName = booking.resident?.full_name || `Resident #${booking.resident_id ?? booking.id}`;
  const when = [booking.appointment_date, booking.start_time].filter(Boolean).join(" at ");
  const statusLabel = payload.type === "booking_created" ? "New booking" : "Booking updated";

  return withReadState({
    id: `booking-${booking.id}`,
    type: "appointment",
    title: `${statusLabel}: ${booking.booking_type ?? "Appointment"}`,
    message: [residentName, booking.doctor_name, when, booking.status].filter(Boolean).join(" · "),
    timeAgo: "Just now",
    action: {
      label: "View details",
      variant: "blue",
      actionType: "view_details",
    },
    sourceId: booking.id,
    sourceEvent: payload.type,
    createdAt: new Date().toISOString(),
  });
}

function buildAlertNotification(payload: AlertRealtimePayload): NotificationItem {
  return withReadState({
    id: `alert-${payload.alert.id}`,
    type: "alert",
    title: payload.alert.title || "AI Alert",
    message: payload.alert.description || "A new alert needs attention.",
    timeAgo: "Just now",
    action: {
      label: "View details",
      variant: payload.alert.alert_type === "critical" ? "red" : "blue",
      actionType: "view_details",
    },
    sourceId: payload.alert.id,
    sourceEvent: payload.type,
    createdAt: new Date().toISOString(),
  });
}

export async function refreshNotificationCache() {
  await ensureInitialized();

  if (USE_MOCK_API) {
    await wait(180);
    baseNotifications = mockNotifications.map((item) => ({
      ...item,
      createdAt: new Date().toISOString(),
    }));
    notifySubscribers();
    return;
  }

  if (loadPromise) {
    await loadPromise;
    return;
  }

  loadPromise = (async () => {
    const items = await request<BackendNotification[]>("/notifications/");
    baseNotifications = items.map(mapBackendNotification);
    notifySubscribers();
  })();

  try {
    await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export async function getNotifications(
  filter: NotificationFilter = "all"
): Promise<NotificationItem[]> {
  await refreshNotificationCache();

  const merged = getMergedNotifications();

  if (filter === "unread") {
    return merged.filter((item) => !item.isRead);
  }

  return merged;
}

export async function getUnreadNotificationCount(): Promise<number> {
  await refreshNotificationCache();
  return getMergedNotifications().filter((item) => !item.isRead).length;
}

export async function markNotificationAsRead(
  notificationId: string
): Promise<{ success: boolean }> {
  await ensureInitialized();
  readIds.add(notificationId);
  await persistReadIds();

  baseNotifications = baseNotifications.map((item) =>
    item.id === notificationId ? { ...item, isRead: true } : item
  );
  realtimeNotifications = realtimeNotifications.map((item) =>
    item.id === notificationId ? { ...item, isRead: true } : item
  );

  notifySubscribers();
  return { success: true };
}

export async function markAllNotificationsAsRead(): Promise<{ success: boolean }> {
  await ensureInitialized();

  for (const item of getMergedNotifications()) {
    readIds.add(item.id);
  }

  await persistReadIds();
  baseNotifications = baseNotifications.map((item) => ({ ...item, isRead: true }));
  realtimeNotifications = realtimeNotifications.map((item) => ({ ...item, isRead: true }));

  notifySubscribers();
  return { success: true };
}

export async function applyRealtimeNotificationEvent(
  payload: BookingRealtimePayload | AlertRealtimePayload
) {
  await ensureInitialized();

  if (payload.type === "ai_alert") {
    const item = buildAlertNotification(payload);
    realtimeNotifications = sortNotifications([
      item,
      ...realtimeNotifications.filter((current) => current.id !== item.id),
    ]);
    notifySubscribers();
    return;
  }

  if (payload.type === "booking_deleted") {
    const bookingId = payload.booking_id;
    if (!bookingId) return;

    realtimeNotifications = realtimeNotifications.filter(
      (item) => item.id !== `booking-${bookingId}`
    );
    baseNotifications = baseNotifications.filter(
      (item) => item.id !== `server-${bookingId}` && item.sourceId !== bookingId
    );
    notifySubscribers();
    return;
  }

  const item = buildBookingNotification(payload);
  if (!item) return;

  realtimeNotifications = sortNotifications([
    item,
    ...realtimeNotifications.filter((current) => current.id !== item.id),
  ]);
  notifySubscribers();
}