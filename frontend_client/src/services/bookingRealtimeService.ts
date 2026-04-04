import { wsClient } from "./wsClient";
import type { ScheduleResponse, TimeSlot } from "../types/booking";

type WatchScheduleOptions = {
  doctorId: string;
  date: string;
  onUpdate: (update: Pick<ScheduleResponse, "date" | "availableDates" | "timeSlots" | "version">) => void;
};

function normalizeRealtimeSlot(item: any): TimeSlot {
  const label =
    item?.label ??
    item?.time ??
    item?.displayTime ??
    (item?.start && item?.end ? `${item.start} - ${item.end}` : "Unknown time");

  return {
    id: String(item?.id ?? item?.timeSlotId ?? item?.slotId ?? label),
    label: String(label),
    available: Boolean(item?.available ?? item?.isAvailable ?? true),
  };
}

export async function watchBookingSchedule({
  doctorId,
  date,
  onUpdate,
}: WatchScheduleOptions) {
  const watchPayload = { doctorId, date };
  const sendWatch = () => {
    wsClient.send("schedule.watch", watchPayload);
  };

  await wsClient.connect();

  const unsubscribeOpen = wsClient.subscribeOpen(sendWatch);
  const unsubscribeUpdate = wsClient.subscribe("schedule.updated", (payload) => {
    const sameDoctor = payload?.doctorId === doctorId;
    const sameDate = payload?.date === date;

    if (!sameDoctor || !sameDate) return;

    const version =
      typeof payload?.version === "number"
        ? payload.version
        : Number(payload?.version ?? 0) || 0;

    const availableDates = Array.isArray(payload?.availableDates)
      ? payload.availableDates.map((item: unknown) => String(item))
      : [];

    const timeSlots = Array.isArray(payload?.timeSlots)
      ? payload.timeSlots.map(normalizeRealtimeSlot)
      : [];

    onUpdate({
      date: String(payload?.date ?? date),
      availableDates,
      timeSlots,
      version,
    });
  });

  sendWatch();

  return () => {
    wsClient.send("schedule.unwatch", watchPayload);
    unsubscribeUpdate();
    unsubscribeOpen();
  };
}