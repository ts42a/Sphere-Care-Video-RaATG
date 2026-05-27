import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import type { CareTask } from "../types/task";
import { formatTaskTime, isCancelledTask, isCompletedTask, taskDateFromParts } from "../utils/taskUtils";

const TASK_REMINDER_CHANNEL_ID = "spherecare-task-reminders";
const REMINDER_PREFIX = "spherecare-task-reminder";

let configured = false;
let permissionRequested = false;

function configureHandler() {
  if (configured) return;

  Notifications.setNotificationHandler({
    handleNotification: async () =>
      ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowAlert: false,
      } as any),
  });

  configured = true;
}

async function ensurePermission() {
  configureHandler();

  if (Platform.OS === "web") return false;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(TASK_REMINDER_CHANNEL_ID, {
      name: "Task reminders",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: "default",
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  const current = await Notifications.getPermissionsAsync();

  if (
    current.granted ||
    current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  ) {
    return true;
  }

  if (permissionRequested) return false;
  permissionRequested = true;

  const requested = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });

  return (
    requested.granted ||
    requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

function reminderData(task: CareTask) {
  return {
    type: "task_due",
    target: "task",
    task_id: task.id,
    taskReminder: true,
    reminderKey: `${REMINDER_PREFIX}-${task.id}`,
  };
}

async function cancelExistingTaskReminders(taskIds?: number[]) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const idSet = taskIds ? new Set(taskIds.map(String)) : null;

  await Promise.all(
    scheduled
      .filter((item) => {
        const data = item.content.data as any;
        if (!data?.taskReminder) return false;
        if (!idSet) return true;
        return idSet.has(String(data.task_id));
      })
      .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier))
  );
}

async function scheduleTask(task: CareTask) {
  if (isCompletedTask(task) || isCancelledTask(task)) return;

  const dueAt = taskDateFromParts(task.dueDate, task.dueTime);
  if (!dueAt || dueAt.getTime() <= Date.now()) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: "Task due now",
      body: `${task.title || "Care activity"} · ${formatTaskTime(task.dueTime)}`,
      sound: "default",
      data: reminderData(task),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: dueAt,
      channelId: TASK_REMINDER_CHANNEL_ID,
    } as any,
  });
}

async function syncTaskReminders(tasks: CareTask[]) {
  try {
    const allowed = await ensurePermission();
    if (!allowed) return;

    const upcoming = tasks.filter((task) => {
      if (isCompletedTask(task) || isCancelledTask(task)) return false;
      const dueAt = taskDateFromParts(task.dueDate, task.dueTime);
      return Boolean(dueAt && dueAt.getTime() > Date.now());
    });

    await cancelExistingTaskReminders(upcoming.map((task) => task.id));
    await Promise.all(upcoming.map(scheduleTask));
  } catch (error) {
    console.warn("Failed to sync task reminders", error);
  }
}

async function cancelTaskReminder(taskId: number) {
  try {
    await cancelExistingTaskReminders([taskId]);
  } catch (error) {
    console.warn("Failed to cancel task reminder", error);
  }
}

export const taskReminderService = {
  syncTaskReminders,
  cancelTaskReminder,
};