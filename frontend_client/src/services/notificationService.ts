import {
  applyRealtimeNotificationEvent,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  refreshNotificationCache,
  subscribeToNotificationUpdates,
  type NotificationFilter,
} from "../api/notification";
import { wsClient } from "./wsClient";
import { pushNotificationService } from "./pushNotificationService";

let realtimeInitialized = false;
let cleanupHandlers: Array<() => void> = [];

function initializeRealtime() {
  if (realtimeInitialized) return;

  const forwardEvent = (eventType: string) => (payload: any) => {
    console.log(`Realtime ${eventType} event received:`, payload);

    applyRealtimeNotificationEvent(payload)
      .then((item) => {
        if (!item) return;

        return pushNotificationService.showLocalNotification(
          item.title,
          item.message,
          {
            notificationId: item.id,
            sourceId: item.sourceId,
            sourceEvent: item.sourceEvent,
            realtimeEventType: eventType,
            relatedEntityType: item.relatedEntityType,
            relatedEntityId: item.relatedEntityId,
            type: item.type,
          }
        );
      })
      .catch((error) => {
        console.error(`Failed to apply ${eventType} notification event`, error);
      });
  };

  cleanupHandlers = [
    wsClient.subscribe("booking_created", forwardEvent("booking_created")),
    wsClient.subscribe("booking_updated", forwardEvent("booking_updated")),
    wsClient.subscribe("booking_deleted", forwardEvent("booking_deleted")),
    wsClient.subscribe("ai_alert", forwardEvent("ai_alert")),
  ];

  realtimeInitialized = true;

  pushNotificationService.ensurePermission().catch((error) => {
    console.warn("Notification permission was not granted", error);
  });

  wsClient.connect().catch((error) => {
    console.warn("Notification WebSocket connection failed", error);
  });
}

function resetRealtime() {
  cleanupHandlers.forEach((cleanup) => cleanup());
  cleanupHandlers = [];
  realtimeInitialized = false;
  pushNotificationService.resetDuplicateCache();
}

export const notificationService = {
  initializeRealtime,
  resetRealtime,
  refresh: refreshNotificationCache,
  subscribe: subscribeToNotificationUpdates,
  getNotifications,
  getUnreadCount: getUnreadNotificationCount,
  markAsRead: markNotificationAsRead,
  markAllAsRead: markAllNotificationsAsRead,
};

export type { NotificationFilter };