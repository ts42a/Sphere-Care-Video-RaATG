export type NotificationType =
  | "medication"
  | "task"
  | "lab"
  | "handoff"
  | "general";

export type NotificationAction = {
  label: string;
  variant?: "red" | "blue" | "neutral";
  actionType?: "view_details" | "view_results" | "open_task" | "none";
};

export type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timeAgo: string;
  isRead: boolean;
  action?: NotificationAction | null;
};