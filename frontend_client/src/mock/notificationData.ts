import type { NotificationItem } from "../types/notification";

export const mockNotifications: NotificationItem[] = [
  {
    id: "notif-1",
    type: "medication",
    title: "Medication Due",
    message: "Patient Anderson – Blood pressure medication due in 15 minutes",
    timeAgo: "2 m ago",
    isRead: false,
    action: {
      label: "View Details",
      variant: "red",
      actionType: "view_details",
    },
  },
  {
    id: "notif-2",
    type: "task",
    title: "Task Completed",
    message: "Morning vitals check completed for all assigned patients",
    timeAgo: "5 m ago",
    isRead: false,
    action: null,
  },
  {
    id: "notif-3",
    type: "lab",
    title: "Lab Results Available",
    message: "New lab results are ready for review",
    timeAgo: "10 m ago",
    isRead: false,
    action: {
      label: "View Results",
      variant: "blue",
      actionType: "view_results",
    },
  },
  {
    id: "notif-4",
    type: "handoff",
    title: "Shift Handoff",
    message: "Evening shift handoff scheduled in 30 minutes",
    timeAgo: "15 m ago",
    isRead: true,
    action: null,
  },
];