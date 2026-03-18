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
import BottomNav from "../../src/components/BottomNav";
import PageHeader from "../../src/components/PageHeader";
import BookingCalendar from "../../src/components/BookingCalendar";
import {
  ScheduleResponse,
  TimeSlot,
  createBooking,
  getSchedule,
} from "../../src/api/booking";

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

export default function ScheduleScreen() {
  const params = useLocalSearchParams<{
    typeId?: string;
    typeTitle?: string;
    doctorId?: string;
  }>();

  const typeId = params.typeId ?? "";
  const typeTitle = params.typeTitle ?? "";
  const doctorId = params.doctorId ?? "";

  const [scheduleData, setScheduleData] = useState<ScheduleResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const today = useMemo(() => new Date(), []);
  const minDate = useMemo(() => toDateKey(today), [today]);
  const maxDate = useMemo(() => toDateKey(addDays(today, 28)), [today]);

  const [visibleMonth, setVisibleMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );

  useEffect(() => {
    async function loadSchedule() {
      try {
        setLoading(true);
        setError("");
        const data = await getSchedule(doctorId, typeId);
        setScheduleData(data);

        const firstValidDate =
          data.availableDates.find((date) => date >= minDate && date <= maxDate) ?? "";

        setSelectedDate(firstValidDate);

        if (firstValidDate) {
          const d = new Date(firstValidDate);
          setVisibleMonth(new Date(d.getFullYear(), d.getMonth(), 1));
        }
      } catch (err) {
        setError("Failed to load schedule.");
      } finally {
        setLoading(false);
      }
    }

    if (doctorId && typeId) {
      loadSchedule();
    }
  }, [doctorId, typeId, minDate, maxDate]);

  const doctor = scheduleData?.doctor;

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

  async function handleNext() {
    if (!selectedDate || !selectedSlot || !doctorId || !typeId || !doctor) return;

    try {
      setSubmitting(true);

      const result = await createBooking({
        doctorId,
        typeId,
        typeTitle,
        doctorName: doctor.name,
        doctorRole: doctor.role,
        date: selectedDate,
        time: selectedSlot.label,
      });

      router.push({
        pathname: "/booking/confirmed",
        params: {
          bookingId: result.bookingId,
        },
      });
    } catch (err) {
      setError("Failed to create booking.");
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
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : doctor ? (
            <>
              <View style={styles.doctorCard}>
                <View style={styles.avatarWrap} />
                <View style={styles.doctorInfo}>
                  <Text style={styles.doctorName}>{doctor.name}</Text>
                  <Text style={styles.doctorRole}>
                    {doctor.specialty || doctor.role}
                  </Text>
                  <Text style={styles.price}>{doctor.price}</Text>
                </View>
                <View style={styles.rightInfo}>
                  <Text style={styles.dateText}>
                    {selectedDate ? formatDateLabel(selectedDate) : ""}
                  </Text>
                  <Text style={styles.metaText}>★ {doctor.rating}</Text>
                  <Text style={styles.metaText}>⌛ {doctor.experience}</Text>
                </View>
              </View>

              <BookingCalendar
                visibleMonth={visibleMonth}
                availableDates={scheduleData.availableDates}
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
              </View>

              <View style={styles.timeGrid}>
                {scheduleData.timeSlots.map((slot) => {
                  const active = selectedSlot?.id === slot.id;
                  return (
                    <Pressable
                      key={slot.id}
                      style={[styles.timeBtn, active && styles.timeBtnSelected]}
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

              <View style={styles.footerRow}>
                <Pressable
                  style={styles.backAction}
                  onPress={() => router.back()}
                >
                  <Feather name="arrow-left" size={20} color="#1D2740" />
                  <Text style={styles.backActionText}>Back</Text>
                </Pressable>

                <Pressable
                  style={styles.nextAction}
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

      <BottomNav active="booking" />
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
  rightWrap: {
    position: "absolute",
    right: 0,
    top: 2,
    flexDirection: "row",
    gap: 18,
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
  price: {
    fontSize: 15,
    color: "#1D2740",
  },
  rightInfo: {
    alignItems: "flex-end",
  },
  dateText: {
    color: "#FF8A2B",
    fontSize: 15,
    marginBottom: 8,
  },
  metaText: {
    color: "#1D2740",
    fontSize: 14,
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
  timeBtnText: {
    fontSize: 15,
    fontWeight: "600",
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
});