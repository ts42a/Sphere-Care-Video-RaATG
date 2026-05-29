export type CareTaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type CareTaskPriority = "low" | "medium" | "high" | "urgent";

export type CareTaskType =
  | "activity"
  | "medication"
  | "meal"
  | "meal_support"
  | "hydration"
  | "mobility"
  | "mobility_assist"
  | "exercise"
  | "doctor_followup"
  | "wellness_check"
  | "hygiene_support"
  | "social"
  | string;

export type CareTask = {
  id: number;
  title: string;
  description?: string | null;
  taskType: CareTaskType;
  status: CareTaskStatus;
  priority: CareTaskPriority;
  dueDate?: string | null;
  dueTime?: string | null;
  residentId?: number | null;
  residentName?: string | null;
  assignedToId?: number | null;
  assignedToName?: string | null;
  createdById?: number | null;
  createdByName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
};

export type BackendCareTask = {
  id?: number | string;
  title?: string | null;
  name?: string | null;
  description?: string | null;
  task_type?: string | null;
  taskType?: string | null;
  category?: string | null;
  status?: string | null;
  priority?: string | null;
  due_date?: string | null;
  dueDate?: string | null;
  date?: string | null;
  due_time?: string | null;
  dueTime?: string | null;
  time?: string | null;
  resident_id?: number | string | null;
  residentId?: number | string | null;
  resident_name?: string | null;
  residentName?: string | null;
  assigned_to_id?: number | string | null;
  assignedToId?: number | string | null;
  assigned_to_name?: string | null;
  assignedToName?: string | null;
  created_by_id?: number | string | null;
  createdById?: number | string | null;
  created_by_name?: string | null;
  createdByName?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
  completed_at?: string | null;
  completedAt?: string | null;
};

export type FetchTasksOptions = {
  dateFrom?: string;
  dateTo?: string;
  status?: CareTaskStatus | "all";
  residentId?: number | string;
};
