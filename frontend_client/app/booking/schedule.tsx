import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import PageHeader from "../../src/components/PageHeader";
import BookingCalendar from "../../src/components/BookingCalendar";
import { bookingService } from "../../src/services/bookingService";
import { wsClient } from "../../src/services/wsClient";
import type { ScheduleResponse, TimeSlot } from "../../src/types/booking";

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(baseDate: Date, days: number) {
  const next = new Date(baseDate);
  next.setDate(baseDate.getDate() + days);
  return next;
}

function getNextWeekdayDateKey() {
  const date = new Date();
  date.setDate(date.getDate() + 1);

  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }

  return toDateKey(date);
}

function normalizeRealtimeSlot(item: any): TimeSlot {
  const start =
    typeof item?.start === "string"
      ? item.start
      : typeof item?.start_time === "string"
        ? item.start_time
        : undefined;

  const end =
    typeof item?.end === "string"
      ? item.end
      : typeof item?.end_time === "string"
        ? item.end_time
        : undefined;

  const label =
    item?.label ??
    item?.time ??
    item?.displayTime ??
    (start && end ? `${start} - ${end}` : "Unknown time");

  return {
    id: String(item?.id ?? item?.timeSlotId ?? item?.slotId ?? label),
    label: String(label),
    available: Boolean(item?.available ?? item?.isAvailable ?? true),
    start,
    end,
  };
}

function parseTimeToMinutes(value?: string) {
  if (!value) return Number.POSITIVE_INFINITY;

  const normalized = value.trim();
  const twentyFourHourMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);

  if (twentyFourHourMatch) {
    const hours = Number(twentyFourHourMatch[1]);
    const minutes = Number(twentyFourHourMatch[2]);
    return hours * 60 + minutes;
  }

  const twelveHourMatch = normalized.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);

  if (twelveHourMatch) {
    let hours = Number(twelveHourMatch[1]);
    const minutes = Number(twelveHourMatch[2]);
    const meridiem = twelveHourMatch[3].toUpperCase();

    if (meridiem === "PM" && hours !== 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;

    return hours * 60 + minutes;
  }

  return Number.POSITIVE_INFINITY;
}

function getSlotStartMinutes(slot: TimeSlot) {
  return parseTimeToMinutes(slot.start ?? slot.label);
}

function getSlotPeriod(slot: TimeSlot) {
  const minutes = getSlotStartMinutes(slot);

  if (minutes < 12 * 60) return "Morning";
  if (minutes < 17 * 60) return "Afternoon";

  return "Evening";
}

export default function ScheduleScreen() {
  const params = useLocalSearchParams<{
    typeId?: string;
    typeTitle?: string;
    doctorId?: string;
  }>();

  const typeId = params.typeId ?? "";
  const typeTitle = params.typeTitle ?? "";
  const doctorId = params.doctorId ?? "";

  const initialDate = useMemo(() => getNextWeekdayDateKey(), []);
  const today = useMemo(() => new Date(), []);
  const minDate = useMemo(() => toDateKey(today), [today]);
  const maxDate = useMemo(() => toDateKey(addDays(today, 28)), [today]);

  const [scheduleData, setScheduleData] = useState<ScheduleResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshingTimes, setRefreshingTimes] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const d = parseLocalDate(initialDate);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  useEffect(() => {
    if (!selectedDate) return;

    const d = parseLocalDate(selectedDate);
    setVisibleMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelectedSlot(null);
  }, [selectedDate]);

  useEffect(() => {
    if (!doctorId || !selectedDate) {
      setLoading(false);
      setError("Missing booking details.");
      return;
    }

    let active = true;

    async function loadSchedule() {
      const firstLoad = scheduleData === null;

      try {
        if (firstLoad) {
          setLoading(true);
        } else {
          setRefreshingTimes(true);
        }

        setError("");

        const data = await bookingService.getSchedule(doctorId, selectedDate);
        if (!active) return;

        setScheduleData(data);

        if (
          Array.isArray(data.availableDates) &&
          data.availableDates.length > 0 &&
          !data.availableDates.includes(selectedDate)
        ) {
          const fallbackDate = data.availableDates[0];
          if (fallbackDate && fallbackDate !== selectedDate) {
            setSelectedDate(fallbackDate);
          }
        }
      } catch (err) {
        if (active) {
          setError("Failed to load schedule.");
        }
      } finally {
        if (active) {
          setLoading(false);
          setRefreshingTimes(false);
        }
      }
    }

    loadSchedule();

    return () => {
      active = false;
    };
  }, [doctorId, selectedDate]);

  useEffect(() => {
    if (!doctorId || !selectedDate) return;

    let unsubscribe = () => {};

    async function watchSchedule() {
      try {
        await wsClient.connect();

        wsClient.send("schedule.watch", {
          doctorId,
          date: selectedDate,
        });

        unsubscribe = wsClient.subscribe("schedule.updated", (payload) => {
          const sameDoctor = payload?.doctorId === doctorId;
          const sameDate = payload?.date === selectedDate;

          if (!sameDoctor || !sameDate) return;

          setScheduleData((prev) => {
            if (!prev) return prev;

            const nextVersion =
              typeof payload?.version === "number"
                ? payload.version
                : Number(payload?.version ?? 0) || 0;

            if (nextVersion > 0 && nextVersion <= prev.version) {
              return prev;
            }

            const nextTimeSlots = Array.isArray(payload?.timeSlots)
              ? payload.timeSlots.map(normalizeRealtimeSlot)
              : prev.timeSlots;

            const nextAvailableDates = Array.isArray(payload?.availableDates)
              ? payload.availableDates.map((date: unknown) => String(date))
              : prev.availableDates;

            return {
              ...prev,
              date: String(payload?.date ?? prev.date),
              availableDates: nextAvailableDates,
              timeSlots: nextTimeSlots,
              version: nextVersion > 0 ? nextVersion : prev.version + 1,
            };
          });
        });
      } catch (err) {
        console.error("Failed to watch booking schedule", err);
      }
    }

    watchSchedule();

    return () => {
      wsClient.send("schedule.unwatch", {
        doctorId,
        date: selectedDate,
      });
      unsubscribe();
    };
  }, [doctorId, selectedDate]);

  useEffect(() => {
    if (!selectedSlot || !scheduleData) return;

    const stillValid = scheduleData.timeSlots.find(
      (slot) => slot.id === selectedSlot.id && slot.available
    );

    if (!stillValid) {
      setSelectedSlot(null);
    }
  }, [scheduleData?.timeSlots, selectedSlot, scheduleData]);

  const doctor = scheduleData?.doctor;

  const availableSlots = useMemo(() => {
    return (scheduleData?.timeSlots ?? [])
      .filter((slot) => slot.available)
      .sort((a, b) => getSlotStartMinutes(a) - getSlotStartMinutes(b));
  }, [scheduleData?.timeSlots]);

  const timeSlotGroups = useMemo(() => {
    const groups = [
      {
        title: "Morning",
        description: "Before 12:00 PM",
        slots: [] as TimeSlot[],
      },
      {
        title: "Afternoon",
        description: "12:00 PM to 5:00 PM",
        slots: [] as TimeSlot[],
      },
      {
        title: "Evening",
        description: "After 5:00 PM",
        slots: [] as TimeSlot[],
      },
    ];

    availableSlots.forEach((slot) => {
      const period = getSlotPeriod(slot);
      const group = groups.find((item) => item.title === period);
      group?.slots.push(slot);
    });

    return groups.filter((group) => group.slots.length > 0);
  }, [availableSlots]);

  function formatDateLabel(dateString: string) {
    const date = parseLocalDate(dateString);
    return date.toLocaleDateString("en-AU", {
      month: "short",
      day: "numeric",
    });
  }

  function formatDateFull(dateString: string) {
    const date = parseLocalDate(dateString);
    return date.toLocaleDateString("en-AU", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function changeMonth(offset: number) {
    const next = new Date(
      visibleMonth.getFullYear(),
      visibleMonth.getMonth() + offset,
      1
    );
    setVisibleMonth(next);
  }

  async function reloadCurrentSchedule() {
    if (!doctorId || !selectedDate) return;

    const data = await bookingService.getSchedule(doctorId, selectedDate);
    setScheduleData(data);
    setSelectedSlot(null);
  }

  async function handleNext() {
    if (!selectedDate || !selectedSlot || !doctorId || !typeId) return;

    try {
      setSubmitting(true);
      setError("");

      const result = await bookingService.createBooking({
        appointmentTypeId: typeId,
        doctorId,
        date: selectedDate,
        timeSlotId: selectedSlot.id,
      });

      router.push({
        pathname: "/booking/confirmed",
        params: {
          bookingId: result.bookingId,
        },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create booking.";

      if (message.toLowerCase().includes("no longer available")) {
        setError(
          "This time slot is no longer available. Please choose another one."
        );

        try {
          await reloadCurrentSchedule();
        } catch {
          setError(
            "This time slot is no longer available. Please refresh and try again."
          );
        }
      } else {
        setError(message || "Failed to create booking.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.screen}>
          <View style={styles.topRow}>
            <PageHeader title="Booking" />
          </View>

          {loading ? (
            <ActivityIndicator size="large" color="#46576D" />
          ) : error && !doctor ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : doctor ? (
            <>
              <View style={styles.doctorCard}>
                <View style={styles.avatarWrap} />
                <View style={styles.doctorInfo}>
                  <Text style={styles.doctorName}>{doctor.name}</Text>
                  <Text style={styles.doctorRole}>{doctor.role}</Text>
                  <Text style={styles.typeText}>{typeTitle || "Appointment"}</Text>
                </View>
                <View style={styles.rightInfo}>
                  <Text style={styles.dateText}>
                    {selectedDate ? formatDateLabel(selectedDate) : ""}
                  </Text>
                </View>
              </View>

              <BookingCalendar
                visibleMonth={visibleMonth}
                availableDates={scheduleData?.availableDates ?? []}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                onPrevMonth={() => changeMonth(-1)}
                onNextMonth={() => changeMonth(1)}
                minDate={minDate}
                maxDate={maxDate}
              />

              <View style={styles.scheduleSummaryCard}>
                <View style={styles.scheduleSummaryTop}>
                  <View style={styles.scheduleSummaryIcon}>
                    <Feather name="clock" size={18} color="#6B7A90" />
                  </View>

                  <View style={styles.scheduleSummaryText}>
                    <Text style={styles.scheduleEyebrow}>Available times</Text>
                    <Text style={styles.scheduleDoctorName}>{doctor.name}</Text>
                    <Text style={styles.scheduleDate}>
                      {selectedDate ? formatDateFull(selectedDate) : ""}
                    </Text>
                  </View>

                  {refreshingTimes ? (
                    <ActivityIndicator size="small" color="#6B7A90" />
                  ) : null}
                </View>
              </View>

              {error ? <Text style={styles.inlineErrorText}>{error}</Text> : null}

              <View style={styles.timeSection}>
                {availableSlots.length === 0 ? (
                  <Text style={styles.emptyText}>
                    No available time slots for this doctor on this date.
                  </Text>
                ) : (
                  timeSlotGroups.map((group) => (
                    <View key={group.title} style={styles.timeGroup}>
                      <View style={styles.timeGroupHeader}>
                        <Text style={styles.timeGroupTitle}>{group.title}</Text>
                        <Text style={styles.timeGroupDescription}>
                          {group.description}
                        </Text>
                      </View>

                      <View style={styles.timeGrid}>
                        {group.slots.map((slot) => {
                          const active = selectedSlot?.id === slot.id;

                          return (
                            <Pressable
                              key={slot.id}
                              style={[
                                styles.timeBtn,
                                active && styles.timeBtnSelected,
                              ]}
                              onPress={() => setSelectedSlot(slot)}
                            >
                              <Text
                                style={[
                                  styles.timeBtnText,
                                  active && styles.timeBtnTextSelected,
                                ]}
                              >
                                {slot.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.footerRow}>
                <Pressable style={styles.backAction} onPress={() => router.back()}>
                  <Feather name="arrow-left" size={20} color="#1D2740" />
                  <Text style={styles.backActionText}>Back</Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.nextAction,
                    (!selectedSlot || submitting) && styles.nextActionDisabled,
                  ]}
                  onPress={handleNext}
                  disabled={!selectedSlot || submitting}
                >
                  <Text style={styles.nextActionText}>
                    {submitting ? "Saving..." : "Next"}
                  </Text>
                  <Feather name="arrow-right" size={20} color="#FFFFFF" />
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F7F7",
  },
  scrollContent: {
    flexGrow: 1,
  },
  screen: {
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  topRow: {
    marginBottom: 28,
  },
  doctorCard: {
    flexDirection: "row",
    backgroundColor: "#F1F3F6",
    borderRadius: 20,
    padding: 18,
    marginBottom: 26,
    alignItems: "center",
  },
  avatarWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#D8D8D8",
    marginRight: 16,
  },
  doctorInfo: {
    flex: 1,
  },
  doctorName: {
    fontSize: 18,
    fontFamily: "Montserrat-Bold",
    color: "#1D2740",
    marginBottom: 4,
  },
  doctorRole: {
    fontSize: 14,
    fontFamily: "OpenSans-Regular",
    color: "#5E6D81",
    marginBottom: 6,
  },
  typeText: {
    fontSize: 14,
    fontFamily: "OpenSans-Regular",
    color: "#6B7A90",
  },
  rightInfo: {
    alignItems: "flex-end",
  },
  dateText: {
    color: "#FF8A2B",
    fontSize: 14,
    fontFamily: "OpenSans-Regular",
  },
  scheduleSummaryCard: {
    backgroundColor: "#F1F3F6",
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 20,
  },

  scheduleSummaryTop: {
    flexDirection: "row",
    alignItems: "center",
  },

  scheduleSummaryIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },

  scheduleSummaryText: {
    flex: 1,
  },

  scheduleEyebrow: {
    fontSize: 13,
    fontFamily: "OpenSans-Regular",
    color: "#7A8798",
    marginBottom: 2,
  },

  scheduleDoctorName: {
    fontSize: 19,
    fontFamily: "Montserrat-Bold",
    color: "#46576D",
    marginBottom: 2,
  },

  scheduleDate: {
    fontSize: 14,
    fontFamily: "OpenSans-Regular",
    color: "#6B7A90",
    lineHeight: 20,
  },
  timeSection: {
    marginBottom: 90,
  },
  timeGroup: {
    marginBottom: 24,
  },
  timeGroupHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  timeGroupTitle: {
    fontSize: 16,
    fontFamily: "Montserrat-Bold",
    color: "#1D2740",
  },
  timeGroupDescription: {
    fontSize: 12,
    fontFamily: "OpenSans-Regular",
    color: "#8A95A5",
  },
  timeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 14,
  },
  timeBtn: {
    width: "47%",
    borderWidth: 1,
    borderColor: "#D8DDE4",
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  timeBtnSelected: {
    backgroundColor: "#465A72",
    borderColor: "#465A72",
  },
  timeBtnText: {
    fontSize: 15,
    fontFamily: "Montserrat-Bold",
    color: "#1D2740",
    textAlign: "center",
  },
  timeBtnTextSelected: {
    color: "#FFFFFF",
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  backAction: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#D8DDE4",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: "#FFFFFF",
  },
  backActionText: {
    marginLeft: 8,
    fontSize: 15,
    fontFamily: "Montserrat-Bold",
    color: "#1D2740",
  },
  nextAction: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0D1633",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  nextActionDisabled: {
    opacity: 0.55,
  },
  nextActionText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontFamily: "Montserrat-Bold",
    marginRight: 8,
  },
  errorText: {
    color: "#D9534F",
    fontSize: 15,
    fontFamily: "OpenSans-Regular",
  },
  inlineErrorText: {
    color: "#D9534F",
    fontSize: 14,
    fontFamily: "OpenSans-Regular",
    marginBottom: 14,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: "OpenSans-Regular",
    color: "#6A7487",
    marginTop: 4,
    lineHeight: 22,
  },
});
