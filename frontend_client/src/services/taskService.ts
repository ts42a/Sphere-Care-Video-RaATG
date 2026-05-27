import { fetchTasks, fetchTodayTasks, updateTaskStatus } from "../api/task";
import { wsClient } from "./wsClient";
import { taskReminderService } from "./taskReminderService";
import type { CareTask, CareTaskStatus } from "../types/task";

async function getTasks(options?: Parameters<typeof fetchTasks>[0]): Promise<CareTask[]> {
  const tasks = await fetchTasks(options);
  taskReminderService.syncTaskReminders(tasks).catch(() => {});
  return tasks;
}

async function getTodayTasks(): Promise<CareTask[]> {
  const tasks = await fetchTodayTasks();
  taskReminderService.syncTaskReminders(tasks).catch(() => {});
  return tasks;
}

async function updateStatus(taskId: number, status: CareTaskStatus) {
  const updated = await updateTaskStatus(taskId, status);

  if (updated.status === "completed" || updated.status === "cancelled") {
    taskReminderService.cancelTaskReminder(updated.id).catch(() => {});
  }

  return updated;
}

export const taskService = {
  getTasks,
  getTodayTasks,
  updateStatus,
  markInProgress: (taskId: number) => updateStatus(taskId, "in_progress"),
  markCompleted: (taskId: number) => updateStatus(taskId, "completed"),
  subscribeRealtime(listener: () => void) {
    const cleanups = [
      wsClient.subscribe("task.created", listener),
      wsClient.subscribe("task.updated", listener),
      wsClient.subscribe("task.deleted", listener),
    ];
    wsClient.connect().catch((error) => {
      console.warn("Task WebSocket connection failed", error);
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  },
};

export type { CareTaskStatus };
