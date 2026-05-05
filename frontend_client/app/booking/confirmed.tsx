import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Feather, Ionicons, MaterialIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import * as Calendar from "expo-calendar";
import PageHeader from "../../src/components/PageHeader";
import { bookingService } from "../../src/services/bookingService";
import { wsClient } from "../../src/services/wsClient";
import type { BookingConfirmation } from "../../src/types/booking";

export default function ConfirmedScreen() {
  const params = useLocalSearchParams<{
    bookingId?: string;
  }>();

  const bookingId = params.bookingId ?? "";

  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadConfirmation() {
      try {
        setLoading(true);
        setError("");
        const data = await bookingService.getBookingConfirmation(bookingId);
        setConfirmation(data);
      } catch {
        setError("Failed to load booking confirmation.");
      } finally {
        setLoading(false);
      }
    }

    if (bookingId) {
      loadConfirmation();
    } else {
      setLoading(false);
      setError("Missing booking ID.");
    }
  }, [bookingId]);

  useEffect(() => {
    if (!bookingId) return;

    let unsubscribe = () => {};

    async function watchBookingUpdates() {
      try {
        await wsClient.connect();
        unsubscribe = wsClient.subscribe("booking.updated", async (payload) => {
          if (String(payload?.bookingId) !== String(bookingId)) return;

          try {
            const latest = await bookingService.getBookingConfirmation(bookingId);
            setConfirmation(latest);
          } catch (err) {
            console.error("Failed to refresh booking confirmation", err);
          }
        });
      } catch (err) {
        console.error("Failed to subscribe booking updates", err);
      }
    }

    watchBookingUpdates();

    return () => {
      unsubscribe();
    };
  }, [bookingId]);

  function buildDateRange(dateString: string, timeRange: string) {
    const [startTime, endTime] = timeRange.split(" - ");
    const baseDate = new Date(dateString);

    const [startHourMinute, startMeridiem] = startTime.split(" ");
    const [startHourRaw, startMinuteRaw] = startHourMinute.split(":");
    let startHour = Number(startHourRaw);
    const startMinute = Number(startMinuteRaw);

    if (startMeridiem === "PM" && startHour !== 12) startHour += 12;
    if (startMeridiem === "AM" && startHour === 12) startHour = 0;

    const [endHourMinute, endMeridiem] = endTime.split(" ");
    const [endHourRaw, endMinuteRaw] = endHourMinute.split(":");
    let endHour = Number(endHourRaw);
    const endMinute = Number(endMinuteRaw);

    if (endMeridiem === "PM" && endHour !== 12) endHour += 12;
    if (endMeridiem === "AM" && endHour === 12) endHour = 0;

    const startDate = new Date(baseDate);
    startDate.setHours(startHour, startMinute, 0, 0);

    const endDate = new Date(baseDate);
    endDate.setHours(endHour, endMinute, 0, 0);

    return { startDate, endDate };
  }

  async function getOrCreateCalendarId() {
    const { status } = await Calendar.requestCalendarPermissionsAsync();

    if (status !== "granted") {
      throw new Error("Calendar permission not granted");
    }

    const calendars = await Calendar.getCalendarsAsync(
      Calendar.EntityTypes.EVENT
    );
    const existing = calendars.find((cal) => cal.title === "SphereCare");

    if (existing) {
      return existing.id;
    }

    const defaultCalendar = await Calendar.getDefaultCalendarAsync();

    return await Calendar.createCalendarAsync({
      title: "SphereCare",
      color: "#46576D",
      entityType: Calendar.EntityTypes.EVENT,
      sourceId: defaultCalendar.source.id,
      source: defaultCalendar.source,
      name: "SphereCare",
      ownerAccount: "personal",
      accessLevel: Calendar.CalendarAccessLevel.OWNER,
    });
  }

  async function handleAddToCalendar() {
    if (!confirmation) return;

    try {
      const calendarId = await getOrCreateCalendarId();
      const { startDate, endDate } = buildDateRange(
        confirmation.date,
        confirmation.time
      );

      await Calendar.createEventAsync(calendarId, {
        title: `Appointment with ${confirmation.doctor.name}`,
        startDate,
        endDate,
        location: confirmation.room,
        notes: `${confirmation.appointmentType.title}\n${confirmation.doctor.role}`,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      Alert.alert("Success", "Appointment added to your calendar.");
    } catch {
      Alert.alert("Error", "Unable to add this booking to calendar.");
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
          ) : confirmation ? (
            <>
              <View style={styles.successWrap}>
                <View style={styles.successCircle}>
                  <Feather name="check" size={30} color="#FFFFFF" />
                </View>
                <Text style={styles.successTitle}>Booking Confirmed!</Text>
                <Text style={styles.successSubtitle}>
                  Your appointment has been successfully scheduled.
                </Text>
              </View>

              <View style={styles.detailCard}>
                <View style={styles.detailHeader}>
                  <Ionicons
                    name="help-circle-outline"
                    size={28}
                    color="#3EB7FF"
                  />
                  <Text style={styles.detailTitle}>Appointment Details</Text>
                </View>

                <View style={styles.detailBody}>
                  <View style={styles.avatarWrap}>
                    <Feather name="user" size={28} color="#FFFFFF" />
                  </View>

                  <View style={styles.detailTextWrap}>
                    <Text style={styles.doctorName}>
                      {confirmation.doctor.name}
                    </Text>
                    <Text style={styles.doctorRole}>
                      {confirmation.doctor.role}
                    </Text>
                    <Text style={styles.infoLine}>{confirmation.date}</Text>
                    <Text style={styles.infoLine}>{confirmation.time}</Text>
                    <Text style={styles.roomLine}>{confirmation.room}</Text>
                    <Text style={styles.statusLine}>
                      Status: {confirmation.status}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.noteCard}>
                <View style={styles.noteHeader}>
                  <MaterialIcons
                    name="chat-bubble-outline"
                    size={22}
                    color="#9AA3AF"
                  />
                  <Text style={styles.noteTitle}>Additional Notes</Text>
                </View>
                <Text style={styles.noteText}>
                  Please arrive 10 minutes early and bring your ID.
                </Text>
              </View>

              <Pressable style={styles.primaryBtn} onPress={handleAddToCalendar}>
                <Feather name="calendar" size={20} color="#FFFFFF" />
                <Text style={styles.primaryBtnText}>Add to Calendar</Text>
              </Pressable>

              <Pressable style={styles.secondaryBtn} onPress={() => router.push("/notifications") }>
                <Feather name="bell" size={20} color="#425266" />
                <Text style={styles.secondaryBtnText}>Open Notifications</Text>
              </Pressable>

              <Pressable style={styles.homeBtn} onPress={() => router.replace("/(tab)") }>
                <Feather name="home" size={20} color="#FFFFFF" />
                <Text style={styles.homeBtnText}>Back to Home</Text>
              </Pressable>
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
    marginBottom: 30,
  },
  successWrap: {
    alignItems: "center",
    marginBottom: 28,
  },
  successCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#1E9E63",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#425266",
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 15,
    color: "#6D7A88",
    textAlign: "center",
  },
  detailCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E1E6EC",
    padding: 20,
    marginBottom: 18,
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
    gap: 10,
  },
  detailTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#425266",
  },
  detailBody: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatarWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#3E5167",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  detailTextWrap: {
    flex: 1,
  },
  doctorName: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1D2740",
    marginBottom: 4,
  },
  doctorRole: {
    fontSize: 14,
    color: "#5E6D81",
    marginBottom: 10,
  },
  infoLine: {
    fontSize: 15,
    color: "#425266",
    marginBottom: 4,
  },
  roomLine: {
    fontSize: 15,
    color: "#425266",
    marginBottom: 6,
  },
  statusLine: {
    fontSize: 15,
    color: "#1E9E63",
    fontWeight: "600",
  },
  noteCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E1E6EC",
    padding: 18,
    marginBottom: 18,
  },
  noteHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    gap: 8,
  },
  noteTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#425266",
  },
  noteText: {
    fontSize: 14,
    color: "#6A7487",
    lineHeight: 20,
  },
  primaryBtn: {
    backgroundColor: "#0D1633",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryBtn: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    borderWidth: 1,
    borderColor: "#D8DDE4",
  },
  secondaryBtnText: {
    color: "#425266",
    fontSize: 16,
    fontWeight: "600",
  },
  homeBtn: {
    backgroundColor: "#425266",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  homeBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  errorText: {
    color: "#D9534F",
    fontSize: 15,
  },
});