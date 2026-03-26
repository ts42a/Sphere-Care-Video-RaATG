import {
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  type NotificationFilter,
} from "../api/notification";

export const notificationService = {
  getNotifications,
  getUnreadCount: getUnreadNotificationCount,
  markAsRead: markNotificationAsRead,
  markAllAsRead: markAllNotificationsAsRead,
};

export type { NotificationFilter };