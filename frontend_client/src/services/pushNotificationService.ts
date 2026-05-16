import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

type PushData = Record<string, unknown>;

let configured = false;
let permissionRequested = false;

const recentPushKeys = new Set<string>();

function makePushKey(title: string, body: string, data: PushData = {}) {
  return [
    data.realtimeEventType || data.sourceEvent || data.type,
    data.relatedEntityId || data.sourceId || data.notificationId,
    title,
    body,
  ]
    .filter(Boolean)
    .join("|");
}

function shouldPushOnce(title: string, body: string, data: PushData = {}) {
  const key = makePushKey(title, body, data);

  if (!key) return true;

  if (recentPushKeys.has(key)) {
    return false;
  }

  recentPushKeys.add(key);

  setTimeout(() => {
    recentPushKeys.delete(key);
  }, 30000);

  return true;
}

function configureHandler() {
  if (configured) return;

  Notifications.setNotificationHandler({
    handleNotification: async () =>
      ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowAlert: false,
      } as any),
  });

  configured = true;
}

async function ensurePermission() {
  configureHandler();

  if (Platform.OS === "web") {
    return false;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("spherecare-bookings", {
      name: "Booking updates",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: "default",
      lockscreenVisibility:
        Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  const current = await Notifications.getPermissionsAsync();

  if (
    current.granted ||
    current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  ) {
    return true;
  }

  if (permissionRequested) return false;
  permissionRequested = true;

  const requested = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });

  return (
    requested.granted ||
    requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

function normalizeNotificationText(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : fallback;
}

async function showLocalNotification(
  title: string,
  body: string,
  data: PushData = {}
) {
  const safeTitle = normalizeNotificationText(title, "SphereCare");
  const safeBody = normalizeNotificationText(
    body,
    data.type === "task" ? "A new task has been assigned." : "You have a new update."
  );

  try {
    if (!shouldPushOnce(safeTitle, safeBody, data)) return;

    const allowed = await ensurePermission();
    if (!allowed) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: safeTitle,
        body: safeBody,
        sound: "default",
        data,
      },
      trigger: null,
    });
  } catch (error) {
    console.warn("Failed to show local notification", error);
  }
}

async function showNotificationItem(item: any) {
  const title =
    typeof item?.title === "string" && item.title.trim().length > 0
      ? item.title.trim()
      : item?.type === "task"
        ? "New task assigned"
        : "SphereCare";

  const bodySource =
    item?.body ??
    item?.message ??
    item?.description ??
    item?.content ??
    item?.data?.message ??
    item?.data?.body ??
    item?.data?.title;

  const body =
    typeof bodySource === "string" && bodySource.trim().length > 0
      ? bodySource.trim()
      : item?.type === "task"
        ? "A new task has been assigned."
        : "You have a new notification.";

  return showLocalNotification(title, body, {
    type: item?.type,
    notification_id: item?.id,
    task_id: item?.data?.task_id ?? item?.task_id,
    target: item?.data?.target ?? item?.target,
    ...item?.data,
  });
}

function resetDuplicateCache() {
  recentPushKeys.clear();
}

export const pushNotificationService = {
  configureHandler,
  ensurePermission,
  showLocalNotification,
  showNotificationItem,
  resetDuplicateCache,
};