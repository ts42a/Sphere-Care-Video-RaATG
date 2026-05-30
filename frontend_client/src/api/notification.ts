import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { request } from "./client";
import { mockNotifications } from "../mock/notificationData";
import type {
  AlertRealtimePayload,
  BackendNotification,
  BookingRealtimePayload,
  TaskRealtimePayload,
  NotificationItem,
  NotificationType,
} from "../types/notification";
import { USE_MOCK_API } from "../config/api";

export type NotificationFilter = "all" | "unread";

type NotificationSubscriber = (
  items: NotificationItem[],
  unreadCount: number
) => void;

type AnyRealtimePayload =
  | BookingRealtimePayload
  | AlertRealtimePayload
  | TaskRealtimePayload
  | any;

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

  const diffMinutes = Math.max(
    0,
    Math.round((Date.now() - date.getTime()) / 60000)
  );

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
    case "task":
    case "care_task":
      return "task";
    default:
      return "general";
  }
}

function cleanText(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  return text.length > 0 ? text : fallback;
}

function normalizeText(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function inferBookingEventFromTitle(title?: string | null) {
  const normalized = normalizeText(title);

  if (normalized.startsWith("new booking")) {
    return "booking_created";
  }

  if (
    normalized.startsWith("booking cancelled") ||
    normalized.startsWith("booking canceled")
  ) {
    return "booking_deleted";
  }

  if (normalized.startsWith("booking updated")) {
    return "booking_updated";
  }

  return "booking";
}

function buildStableNotificationId(params: {
  type?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: number | string | null;
  sourceId?: number | string | null;
  sourceEvent?: string | null;
  title?: string | null;
}) {
  const relatedEntityType = params.relatedEntityType ?? "";
  const relatedEntityId = params.relatedEntityId ?? "";
  const sourceEvent = params.sourceEvent ?? "";
  const sourceId = params.sourceId ?? "";

  if (relatedEntityType === "booking" && relatedEntityId) {
    return `booking-${relatedEntityId}-${
      sourceEvent || inferBookingEventFromTitle(params.title)
    }`;
  }

  if (params.type === "appointment" && relatedEntityId) {
    return `booking-${relatedEntityId}-${
      sourceEvent || inferBookingEventFromTitle(params.title)
    }`;
  }

  if (relatedEntityType === "task" && relatedEntityId) {
    return `task-${relatedEntityId}-${sourceEvent || "task"}`;
  }

  if (relatedEntityType === "flag" && relatedEntityId) {
    return `flag-${relatedEntityId}-${sourceEvent || "ai_alert"}`;
  }

  if (params.type === "task" && relatedEntityId) {
    return `task-${relatedEntityId}-${sourceEvent || "task"}`;
  }

  if (sourceEvent && sourceId) {
    return `${sourceEvent}-${sourceId}`;
  }

  if (sourceId) {
    return `server-${sourceId}`;
  }

  return `${params.type || "notification"}-${Date.now()}`;
}

function getDedupeKey(item: NotificationItem) {
  const relatedEntityType = item.relatedEntityType ?? "";
  const relatedEntityId = item.relatedEntityId ?? "";
  const sourceEvent = item.sourceEvent || inferBookingEventFromTitle(item.title);

  if (relatedEntityType === "booking" && relatedEntityId) {
    return `booking:${relatedEntityId}:${sourceEvent}`;
  }

  if (relatedEntityType === "task" && relatedEntityId) {
    return `task:${relatedEntityId}:${sourceEvent || "task"}`;
  }

  if (relatedEntityType === "flag" && relatedEntityId) {
    return `flag:${relatedEntityId}:${sourceEvent || "ai_alert"}`;
  }

  return [
    item.type,
    item.sourceId,
    item.sourceEvent,
    item.title,
    item.message,
  ]
    .filter(Boolean)
    .join(":");
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
    const key = getDedupeKey(item);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, item);
      continue;
    }

    const existingTime = existing.createdAt
      ? new Date(existing.createdAt).getTime()
      : 0;

    const itemTime = item.createdAt
      ? new Date(item.createdAt).getTime()
      : 0;

    merged.set(key, itemTime >= existingTime ? item : existing);
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
  listener(
    getMergedNotifications(),
    getMergedNotifications().filter((item) => !item.isRead).length
  );

  return () => {
    subscribers.delete(listener);
  };
}

function mapBackendNotification(notification: BackendNotification): NotificationItem {
  const isConversationNotification =
    notification.category === "message" ||
    notification.related_entity_type === "conversation";

  const type = toNotificationType(notification.category);

  const sourceEvent =
    notification.related_entity_type === "booking"
      ? inferBookingEventFromTitle(notification.title)
      : notification.related_entity_type === "task"
        ? "task"
        : notification.related_entity_type === "flag"
          ? "ai_alert"
          : undefined;

  const id = buildStableNotificationId({
    type,
    relatedEntityType: notification.related_entity_type ?? null,
    relatedEntityId: notification.related_entity_id ?? null,
    sourceId: notification.id,
    sourceEvent,
    title: notification.title,
  });

  return withReadState({
    id,
    type,
    title: cleanText(notification.title, "SphereCare"),
    message: cleanText(notification.body, "You have a new update."),
    timeAgo: formatTimeAgo(notification.created_at),
    action: {
      label: isConversationNotification
        ? "Open"
        : type === "appointment"
          ? "View details"
          : type === "task"
            ? "Open task"
            : "Open",
      variant: notification.is_priority ? "red" : "blue",
      actionType: isConversationNotification
        ? "open_conversation"
        : type === "task"
          ? "open_task"
          : "view_details",
    },
    sourceId: notification.id,
    sourceEvent,
    relatedEntityType: notification.related_entity_type ?? null,
    relatedEntityId: notification.related_entity_id ?? null,
    createdAt: notification.created_at,
  });
}

function buildBookingNotification(
  payload: BookingRealtimePayload
): NotificationItem | null {
  if (payload.type === "booking_deleted") {
    const bookingId = payload.booking_id;
    if (!bookingId) return null;

    return withReadState({
      id: `booking-${bookingId}-booking_deleted`,
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
      sourceEvent: "booking_deleted",
      relatedEntityType: "booking",
      relatedEntityId: bookingId,
      createdAt: new Date().toISOString(),
    });
  }

  const booking = payload.booking;
  if (!booking) return null;

  const residentName =
    booking.resident?.full_name ||
    `Resident #${booking.resident_id ?? booking.id}`;

  const when = [booking.appointment_date, booking.start_time]
    .filter(Boolean)
    .join(" at ");

  const statusLabel =
    payload.type === "booking_created" ? "New booking" : "Booking updated";

  return withReadState({
    id: `booking-${booking.id}-${payload.type}`,
    type: "appointment",
    title: `${statusLabel}: ${booking.booking_type ?? "Appointment"}`,
    message: [residentName, booking.doctor_name, when, booking.status]
      .filter(Boolean)
      .join(" · "),
    timeAgo: "Just now",
    action: {
      label: "View details",
      variant: "blue",
      actionType: "view_details",
    },
    sourceId: booking.id,
    sourceEvent: payload.type,
    relatedEntityType: "booking",
    relatedEntityId: booking.id,
    createdAt: new Date().toISOString(),
  });
}

function getTaskFromPayload(payload: AnyRealtimePayload) {
  return (
    payload?.task ||
    payload?.data?.task ||
    payload?.payload?.task ||
    payload?.payload?.data?.task ||
    null
  );
}

function getTaskIdFromPayload(payload: AnyRealtimePayload) {
  return (
    payload?.task_id ||
    payload?.taskId ||
    payload?.data?.task_id ||
    payload?.data?.taskId ||
    payload?.payload?.task_id ||
    payload?.payload?.taskId ||
    payload?.payload?.data?.task_id ||
    payload?.payload?.data?.taskId ||
    payload?.task?.id ||
    payload?.data?.task?.id ||
    payload?.payload?.task?.id ||
    null
  );
}

function buildTaskNotification(payload: TaskRealtimePayload | any): NotificationItem | null {
  const eventType = payload?.type;

  if (eventType === "task.deleted") {
    const taskId = getTaskIdFromPayload(payload);
    if (!taskId) return null;

    return withReadState({
      id: `task-${taskId}-task.deleted`,
      type: "task",
      title: "Task removed",
      message: `Task #${taskId} was removed.`,
      timeAgo: "Just now",
      action: {
        label: "Open task",
        variant: "blue",
        actionType: "open_task",
      },
      sourceId: Number(taskId),
      sourceEvent: "task.deleted",
      relatedEntityType: "task",
      relatedEntityId: Number(taskId),
      createdAt: new Date().toISOString(),
    });
  }

  const task = getTaskFromPayload(payload);
  if (!task) {
    return withReadState({
      id: `task-${Date.now()}-${eventType || "task.created"}`,
      type: "task",
      title: eventType === "task.updated" ? "Task updated" : "New task assigned",
      message: "A new task has been assigned.",
      timeAgo: "Just now",
      action: {
        label: "Open task",
        variant: "blue",
        actionType: "open_task",
      },
      sourceId: undefined,
      sourceEvent: eventType || "task.created",
      relatedEntityType: "task",
      relatedEntityId: null,
      createdAt: new Date().toISOString(),
    });
  }

  const taskId = Number(task.id || getTaskIdFromPayload(payload) || Date.now());

  const title =
    eventType === "task.updated" ? "Task updated" : "New task assigned";

  const taskTitle = cleanText(task.title || task.name, "Care activity");

  const dueDate = cleanText(task.due_date || task.dueDate, "");
  const dueTimeRaw = cleanText(task.due_time || task.dueTime || task.time, "");
  const dueTime = dueTimeRaw ? dueTimeRaw.slice(0, 5) : "";

  const when =
    dueDate && dueTime
      ? `${dueDate} at ${dueTime}`
      : dueDate || dueTime || "";

  const priority = cleanText(task.priority, "");
  const priorityText = priority ? `${priority} priority` : "";

  const message =
    [taskTitle, when, priorityText].filter(Boolean).join(" · ") ||
    "A new task has been assigned.";

  return withReadState({
    id: `task-${taskId}-${eventType || "task.created"}`,
    type: "task",
    title,
    message,
    timeAgo: "Just now",
    action: {
      label: "Open task",
      variant: "blue",
      actionType: "open_task",
    },
    sourceId: taskId,
    sourceEvent: eventType || "task.created",
    relatedEntityType: "task",
    relatedEntityId: taskId,
    createdAt: new Date().toISOString(),
  });
}

function buildAlertNotification(payload: AlertRealtimePayload): NotificationItem {
  const flagId = Number(
    payload.alert.flag_id ||
      payload.alert.related_entity_id ||
      payload.flag?.id ||
      payload.alert.id
  );

  return withReadState({
    id: `flag-${flagId}-ai_alert`,
    type: "alert",
    title: cleanText(payload.alert.title, "AI Flag"),
    message: cleanText(
      payload.alert.description || payload.flag?.description,
      "A new AI flag needs attention."
    ),
    timeAgo: "Just now",
    action: {
      label: "View details",
      variant: payload.alert.alert_type === "critical" ? "red" : "blue",
      actionType: "view_details",
    },
    sourceId: flagId,
    sourceEvent: payload.type,
    relatedEntityType: "flag",
    relatedEntityId: flagId,
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

  baseNotifications = baseNotifications.map((item) => ({
    ...item,
    isRead: true,
  }));

  realtimeNotifications = realtimeNotifications.map((item) => ({
    ...item,
    isRead: true,
  }));

  notifySubscribers();
  return { success: true };
}

function unwrapRealtimePayload(payload: AnyRealtimePayload): AnyRealtimePayload {
  if (!payload || typeof payload !== "object") return payload;

  const innerPayload =
    payload.payload && typeof payload.payload === "object"
      ? payload.payload
      : payload.data && typeof payload.data === "object" && payload.data.type
        ? payload.data
        : payload;

  return {
    ...innerPayload,
    type: innerPayload.type || payload.type,
  };
}

function isBookingRealtimePayload(
  payload: AnyRealtimePayload
): payload is BookingRealtimePayload {
  return (
    payload?.type === "booking_created" ||
    payload?.type === "booking_updated" ||
    payload?.type === "booking_deleted"
  );
}

function isTaskRealtimePayload(
  payload: AnyRealtimePayload
): payload is TaskRealtimePayload {
  return (
    payload?.type === "task.created" ||
    payload?.type === "task.updated" ||
    payload?.type === "task.deleted"
  );
}

function isAlertRealtimePayload(
  payload: AnyRealtimePayload
): payload is AlertRealtimePayload {
  return payload?.type === "ai_alert";
}

function pushRealtimeNotification(item: NotificationItem | null) {
  if (!item) return undefined;

  realtimeNotifications = sortNotifications([
    item,
    ...realtimeNotifications.filter(
      (current) => getDedupeKey(current) !== getDedupeKey(item)
    ),
  ]);

  notifySubscribers();
  return item;
}

export async function applyRealtimeNotificationEvent(
  payload: BookingRealtimePayload | AlertRealtimePayload | TaskRealtimePayload | any
) {
  await ensureInitialized();

  const normalizedPayload = unwrapRealtimePayload(payload);

  if (isAlertRealtimePayload(normalizedPayload)) {
    return pushRealtimeNotification(buildAlertNotification(normalizedPayload));
  }

  if (isBookingRealtimePayload(normalizedPayload)) {
    return pushRealtimeNotification(buildBookingNotification(normalizedPayload));
  }

  if (isTaskRealtimePayload(normalizedPayload)) {
    return pushRealtimeNotification(buildTaskNotification(normalizedPayload));
  }

  return undefined;
}