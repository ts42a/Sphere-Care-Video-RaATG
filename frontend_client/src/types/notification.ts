export type NotificationType =
  | "appointment"
  | "alert"
  | "reminder"
  | "general"
  | "message"
  | "medication"
  | "task"
  | "lab"
  | "handoff";

export type NotificationAction = {
  label: string;
  variant?: "red" | "blue" | "neutral";
  actionType?: "view_details" | "view_results" | "open_task" | "open_conversation" | "none";
};

export type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timeAgo: string;
  isRead: boolean;
  action?: NotificationAction | null;
  sourceId?: number;
  sourceEvent?: string;
  relatedEntityType?: string | null;
  relatedEntityId?: number | null;
  createdAt?: string;
};

export type BackendNotification = {
  id: number;
  category: string;
  title: string;
  body: string;
  is_priority: boolean;
  related_entity_type?: string | null;
  related_entity_id?: number | null;
  created_at: string;
};

export type BookingRealtimePayload = {
  type: "booking_created" | "booking_updated" | "booking_deleted";
  booking?: {
    id: number;
    appointment_date?: string;
    start_time?: string;
    doctor_name?: string;
    booking_type?: string;
    status?: string;
    resident_id?: number;
    resident?: { full_name?: string | null } | null;
  };
  booking_id?: number;
};

export type AlertRealtimePayload = {
  type: "ai_alert";
  alert: {
    id: number;
    title?: string;
    description?: string;
    alert_type?: string;
  };
};

export type TaskRealtimePayload = {
  type: "task.created" | "task.updated" | "task.deleted";
  task?: {
    id: number;
    title?: string;
    description?: string | null;
    task_type?: string;
    due_date?: string | null;
    due_time?: string | null;
    status?: string;
    priority?: string;
    resident_name?: string | null;
  };
  task_id?: number;
  resident_id?: number;
};
