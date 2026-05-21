import type { CareTask } from "../types/task";

export type TaskDateRange = "today" | "past3" | "future3";

const DATE_KEY_LENGTH = 10;
const OVERDUE_GRACE_MINUTES = 30;

export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function dateRangeForTaskFilter(range: TaskDateRange) {
  const today = new Date();

  if (range === "past3") {
    return {
      dateFrom: dateKey(addDays(today, -3)),
      dateTo: dateKey(addDays(today, -1)),
    };
  }

  if (range === "future3") {
    return {
      dateFrom: dateKey(addDays(today, 1)),
      dateTo: dateKey(addDays(today, 3)),
    };
  }

  const todayKey = dateKey(today);
  return { dateFrom: todayKey, dateTo: todayKey };
}

export function isSameDateKey(value?: string | null, target = dateKey()) {
  return String(value ?? "").slice(0, DATE_KEY_LENGTH) === target;
}

export function minutesFromTime(value?: string | null) {
  if (!value) return Number.MAX_SAFE_INTEGER;

  const [hourRaw, minuteRaw] = String(value).split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return Number.MAX_SAFE_INTEGER;
  }

  return hour * 60 + minute;
}

export function nowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export function isCompletedTask(task: CareTask) {
  return task.status === "completed";
}

export function isCancelledTask(task: CareTask) {
  return task.status === "cancelled";
}

export function isTaskOverdue(task: CareTask, now = new Date()) {
  if (isCompletedTask(task) || isCancelledTask(task)) return false;
  if (!task.dueDate) return false;

  const taskDate = String(task.dueDate).slice(0, DATE_KEY_LENGTH);
  const today = dateKey(now);

  if (taskDate < today) return true;
  if (taskDate > today) return false;
  if (!task.dueTime) return false;

  return nowMinutes() >= minutesFromTime(task.dueTime) + OVERDUE_GRACE_MINUTES;
}

export function shouldDimTask(task: CareTask, range: TaskDateRange = "today") {
  if (isCompletedTask(task)) return true;
  if (range === "past3") return true;
  return isTaskOverdue(task);
}

export function formatTaskTime(value?: string | null) {
  return value ? String(value).slice(0, 5) : "Any time";
}

export function formatTaskCategory(value?: string | null) {
  const normalized = String(value || "activity").toLowerCase();

  if (["meal_support", "meal"].includes(normalized)) return "Meal";
  if (normalized === "hydration") return "Hydration";
  if (["mobility", "mobility_assist", "exercise"].includes(normalized)) return "Exercise";
  if (normalized === "medication") return "Medication";
  if (normalized === "doctor_followup") return "Follow up";
  if (normalized === "wellness_check") return "Wellness";
  if (normalized === "hygiene_support") return "Hygiene";
  if (normalized === "social") return "Social";

  return normalized.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function sortTasksByTime(tasks: CareTask[]) {
  return [...tasks].sort((a, b) => {
    const dateCompare = String(a.dueDate ?? "9999-99-99").localeCompare(String(b.dueDate ?? "9999-99-99"));
    if (dateCompare !== 0) return dateCompare;

    const timeCompare = minutesFromTime(a.dueTime) - minutesFromTime(b.dueTime);
    if (timeCompare !== 0) return timeCompare;

    return (a.id ?? 0) - (b.id ?? 0);
  });
}

export function sortHomeTodayTasks(tasks: CareTask[]) {
  const visible = tasks.filter((task) => !isCancelledTask(task));
  const upcoming: CareTask[] = [];
  const lowerPriority: CareTask[] = [];

  for (const task of visible) {
    if (isCompletedTask(task) || isTaskOverdue(task)) {
      lowerPriority.push(task);
    } else {
      upcoming.push(task);
    }
  }

  return [...sortTasksByTime(upcoming), ...sortTasksByTime(lowerPriority)];
}

export function taskDateFromParts(date?: string | null, time?: string | null) {
  if (!date || !time) return null;

  const dateText = String(date).slice(0, DATE_KEY_LENGTH);
  const timeText = String(time).slice(0, 5);
  const parsed = new Date(`${dateText}T${timeText}:00`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function taskGroupLabel(task: CareTask, range: TaskDateRange) {
  if (!task.dueDate) return "No date";

  const today = dateKey();
  const taskDate = String(task.dueDate).slice(0, DATE_KEY_LENGTH);

  if (range === "today" || taskDate === today) return "Today";

  const labels: Record<string, string> = {
    [dateKey(addDays(new Date(), -1))]: "Yesterday",
    [dateKey(addDays(new Date(), -2))]: "2 days ago",
    [dateKey(addDays(new Date(), -3))]: "3 days ago",
    [dateKey(addDays(new Date(), 1))]: "Tomorrow",
    [dateKey(addDays(new Date(), 2))]: "2 days later",
    [dateKey(addDays(new Date(), 3))]: "3 days later",
  };

  return labels[taskDate] || taskDate;
}

export function groupTasksByDate(tasks: CareTask[], range: TaskDateRange) {
  const groups = new Map<string, CareTask[]>();

  for (const task of tasks) {
    const label = taskGroupLabel(task, range);
    groups.set(label, [...(groups.get(label) || []), task]);
  }

  return Array.from(groups.entries()).map(([label, items]) => ({
    label,
    tasks: sortTasksByTime(items),
  }));
}
