import { USE_MOCK_API } from "../config/api";
import { request } from "./client";
import type { ApiItemResponse, ApiListResponse } from "../types/api";
import type {
  BackendCareTask,
  CareTask,
  CareTaskPriority,
  CareTaskStatus,
  FetchTasksOptions,
} from "../types/task";

function unwrapList<T>(response: T[] | ApiListResponse<T>): T[] {
  if (Array.isArray(response)) return response;
  if (response && Array.isArray((response as ApiListResponse<T>).data)) {
    return (response as ApiListResponse<T>).data;
  }
  return [];
}

function unwrapItem<T>(response: T | ApiItemResponse<T>): T {
  if (
    response &&
    typeof response === "object" &&
    "data" in response &&
    (response as ApiItemResponse<T>).data !== undefined
  ) {
    return (response as ApiItemResponse<T>).data;
  }
  return response as T;
}

function toNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeStatus(value: unknown): CareTaskStatus {
  const normalized = String(value || "pending").toLowerCase();
  if (["pending", "in_progress", "completed", "cancelled"].includes(normalized)) {
    return normalized as CareTaskStatus;
  }
  return "pending";
}

function normalizePriority(value: unknown): CareTaskPriority {
  const normalized = String(value || "medium").toLowerCase();
  if (["low", "medium", "high", "urgent"].includes(normalized)) {
    return normalized as CareTaskPriority;
  }
  return "medium";
}

export function normalizeTask(item: BackendCareTask): CareTask {
  const id = toNumber(item.id, Date.now());
  const dueDate = item.dueDate ?? item.due_date ?? item.date ?? null;
  const dueTime = item.dueTime ?? item.due_time ?? item.time ?? null;

  return {
    id,
    title: String(item.title ?? item.name ?? "Care activity"),
    description: item.description ?? null,
    taskType: String(item.taskType ?? item.task_type ?? item.category ?? "activity"),
    status: normalizeStatus(item.status),
    priority: normalizePriority(item.priority),
    dueDate,
    dueTime,
    residentId: item.residentId != null ? toNumber(item.residentId) : item.resident_id != null ? toNumber(item.resident_id) : null,
    residentName: item.residentName ?? item.resident_name ?? null,
    assignedToId: item.assignedToId != null ? toNumber(item.assignedToId) : item.assigned_to_id != null ? toNumber(item.assigned_to_id) : null,
    assignedToName: item.assignedToName ?? item.assigned_to_name ?? null,
    createdById: item.createdById != null ? toNumber(item.createdById) : item.created_by_id != null ? toNumber(item.created_by_id) : null,
    createdByName: item.createdByName ?? item.created_by_name ?? null,
    createdAt: item.createdAt ?? item.created_at ?? null,
    updatedAt: item.updatedAt ?? item.updated_at ?? null,
    completedAt: item.completedAt ?? item.completed_at ?? null,
  };
}

function buildQuery(options: FetchTasksOptions = {}) {
  const params = new URLSearchParams();
  if (options.dateFrom) params.set("date_from", options.dateFrom);
  if (options.dateTo) params.set("date_to", options.dateTo);
  if (options.status && options.status !== "all") params.set("status", options.status);
  if (options.residentId != null) params.set("resident_id", String(options.residentId));

  const query = params.toString();
  return query ? `?${query}` : "";
}

const mockTasks: CareTask[] = [
  {
    id: 1,
    title: "Blood pressure check",
    description: "Record today’s blood pressure reading.",
    taskType: "wellness_check",
    status: "pending",
    priority: "high",
    dueDate: new Date().toISOString().slice(0, 10),
    dueTime: "09:00",
  },
  {
    id: 2,
    title: "Medication reminder",
    description: "Confirm morning medication has been taken.",
    taskType: "medication",
    status: "pending",
    priority: "urgent",
    dueDate: new Date().toISOString().slice(0, 10),
    dueTime: "10:30",
  },
];

export async function fetchTasks(options: FetchTasksOptions = {}): Promise<CareTask[]> {
  if (USE_MOCK_API) return mockTasks;

  const response = await request<BackendCareTask[] | ApiListResponse<BackendCareTask>>(
    `/tasks${buildQuery(options)}`
  );
  return unwrapList(response).map(normalizeTask);
}

export async function fetchTodayTasks(): Promise<CareTask[]> {
  if (USE_MOCK_API) return mockTasks;

  const response = await request<BackendCareTask[] | ApiListResponse<BackendCareTask>>("/tasks/today");
  return unwrapList(response).map(normalizeTask);
}

export async function updateTaskStatus(
  taskId: number,
  status: CareTaskStatus
): Promise<CareTask> {
  if (USE_MOCK_API) {
    const existing = mockTasks.find((task) => task.id === taskId) ?? mockTasks[0];
    return { ...existing, id: taskId, status };
  }

  const response = await request<BackendCareTask | ApiItemResponse<BackendCareTask>>(
    `/tasks/${taskId}/status`,
    {
      method: "PATCH",
      body: { status },
    }
  );
  return normalizeTask(unwrapItem(response));
}
