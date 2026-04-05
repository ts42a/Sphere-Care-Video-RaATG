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
import type { AlertRealtimePayload, BookingRealtimePayload } from "../types/notification";

let realtimeInitialized = false;
let cleanupHandlers: Array<() => void> = [];

function initializeRealtime() {
  if (realtimeInitialized) return;

  const forwardBooking = (payload: BookingRealtimePayload) => {
    console.log("Realtime booking event received:", payload);
    applyRealtimeNotificationEvent(payload).catch((error) => {
      console.error("Failed to apply booking notification event", error);
    });
  };

  const forwardAlert = (payload: AlertRealtimePayload) => {
    console.log("Realtime alert event received:", payload);
    applyRealtimeNotificationEvent(payload).catch((error) => {
      console.error("Failed to apply alert notification event", error);
    });
  };

  cleanupHandlers = [
    wsClient.subscribe("booking_created", forwardBooking),
    wsClient.subscribe("booking_updated", forwardBooking),
    wsClient.subscribe("booking_deleted", forwardBooking),
    wsClient.subscribe("ai_alert", forwardAlert),
  ];

  realtimeInitialized = true;
}

function resetRealtime() {
  cleanupHandlers.forEach((cleanup) => cleanup());
  cleanupHandlers = [];
  realtimeInitialized = false;
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