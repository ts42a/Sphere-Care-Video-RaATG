import { wsClient } from "./wsClient";
import type { ScheduleResponse, TimeSlot } from "../types/booking";

type WatchScheduleOptions = {
  doctorId: string;
  date: string;
  onUpdate: (update: Pick<ScheduleResponse, "date" | "availableDates" | "timeSlots" | "version">) => void;
};

function makeFallbackSlotId(item: any, label: string, index: number) {
  const rawStart = item?.start ?? item?.start_time ?? "";
  const rawEnd = item?.end ?? item?.end_time ?? "";
  const seed = `${rawStart}-${rawEnd}-${label}-${index}`
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9:_-]/g, "")
    .toLowerCase();

  return `slot-${seed || index}`;
}

function normalizeRealtimeSlot(item: any, index: number): TimeSlot {
  const label =
    item?.label ??
    item?.time ??
    item?.displayTime ??
    (item?.start && item?.end ? `${item.start} - ${item.end}` : "Unknown time");

  const id =
    item?.id ??
    item?.timeSlotId ??
    item?.time_slot_id ??
    item?.slotId ??
    item?.slot_id ??
    makeFallbackSlotId(item, String(label), index);

  return {
    id: String(id),
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
      ? payload.timeSlots.map((slot: any, index: number) => normalizeRealtimeSlot(slot, index))
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