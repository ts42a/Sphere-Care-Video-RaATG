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
    return scheduleData?.timeSlots ?? [];
  }, [scheduleData?.timeSlots]);

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
      month: "short",
      day: "numeric",
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
        setError("This time slot is no longer available. Please choose another one.");

        try {
          await reloadCurrentSchedule();
        } catch {
          setError("This time slot is no longer available. Please refresh and try again.");
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

              <View style={styles.availableHeader}>
                <Feather name="clock" size={24} color="#68778C" />
                <Text style={styles.availableTitle}>
                  Available Times
                  {selectedDate ? ` · ${formatDateFull(selectedDate)}` : ""}
                </Text>
                {refreshingTimes ? (
                  <ActivityIndicator size="small" color="#68778C" />
                ) : null}
              </View>

              {error ? <Text style={styles.inlineErrorText}>{error}</Text> : null}

              <View style={styles.timeGrid}>
                {availableSlots.length === 0 ? (
                  <Text style={styles.emptyText}>
                    No available time slots for this date.
                  </Text>
                ) : (
                  availableSlots.map((slot) => {
                    const active = selectedSlot?.id === slot.id;
                    const disabled = !slot.available;

                    return (
                      <Pressable
                        key={slot.id}
                        style={[
                          styles.timeBtn,
                          active && styles.timeBtnSelected,
                          disabled && styles.timeBtnDisabled,
                        ]}
                        onPress={() => setSelectedSlot(slot)}
                        disabled={disabled}
                      >
                        <Text
                          style={[
                            styles.timeBtnText,
                            active && styles.timeBtnTextSelected,
                            disabled && styles.timeBtnTextDisabled,
                          ]}
                        >
                          {slot.label}
                        </Text>
                      </Pressable>
                    );
                  })
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
    fontSize: 17,
    color: "#1D2740",
    marginBottom: 3,
  },
  doctorRole: {
    fontSize: 14,
    color: "#1D2740",
    marginBottom: 8,
  },
  typeText: {
    fontSize: 15,
    color: "#5E6D81",
  },
  rightInfo: {
    alignItems: "flex-end",
  },
  dateText: {
    color: "#FF8A2B",
    fontSize: 15,
    marginBottom: 8,
  },
  availableHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },
  availableTitle: {
    fontSize: 18,
    color: "#425266",
    marginLeft: 10,
    flex: 1,
  },
  timeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 14,
    marginBottom: 110,
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
  timeBtnDisabled: {
    backgroundColor: "#F2F4F7",
    borderColor: "#E1E6EC",
  },
  timeBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1D2740",
    textAlign: "center",
  },
  timeBtnTextSelected: {
    color: "#FFFFFF",
  },
  timeBtnTextDisabled: {
    color: "#A5AFBC",
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
    fontSize: 16,
    color: "#1D2740",
    fontWeight: "500",
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
    fontSize: 16,
    fontWeight: "600",
    marginRight: 8,
  },
  errorText: {
    color: "#D9534F",
    fontSize: 15,
  },
  inlineErrorText: {
    color: "#D9534F",
    fontSize: 14,
    marginBottom: 14,
  },
  emptyText: {
    fontSize: 15,
    color: "#6A7487",
    marginTop: 4,
  },
});