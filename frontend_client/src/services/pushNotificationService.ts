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

async function showLocalNotification(
  title: string,
  body: string,
  data: PushData = {}
) {
  try {
    if (!shouldPushOnce(title, body, data)) return;

    const allowed = await ensurePermission();
    if (!allowed) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
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
  await showLocalNotification(item.title, item.message, {
    notificationId: item.id,
    sourceId: item.sourceId,
    sourceEvent: item.sourceEvent,
    relatedEntityType: item.relatedEntityType,
    relatedEntityId: item.relatedEntityId,
    type: item.type,
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