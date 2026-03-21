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
import BottomNav from "../../src/components/BottomNav";
import PageHeader from "../../src/components/PageHeader";
import { bookingService } from "../../src/services/bookingService";
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
      } catch (err) {
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
    } catch (err) {
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
                      Status: {confirmation.status} ✓
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

              <Pressable style={styles.secondaryBtn}>
                <Feather name="bell" size={20} color="#425266" />
                <Text style={styles.secondaryBtnText}>Set Reminder</Text>
              </Pressable>
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
    marginBottom: 30,
  },
  rightWrap: {
    position: "absolute",
    right: 0,
    top: 2,
    flexDirection: "row",
    gap: 18,
  },
  successWrap: {
    alignItems: "center",
    marginBottom: 28,
  },
  successCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#1EBE83",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 18,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1D2740",
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 16,
    color: "#6A7A90",
    textAlign: "center",
  },
  detailCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCE2E8",
    borderRadius: 22,
    padding: 20,
    marginBottom: 18,
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  detailTitle: {
    marginLeft: 12,
    fontSize: 18,
    fontWeight: "700",
    color: "#1D2740",
  },
  detailBody: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  avatarWrap: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: "#3E5167",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 18,
  },
  detailTextWrap: {
    flex: 1,
  },
  doctorName: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1D2740",
    marginBottom: 2,
  },
  doctorRole: {
    fontSize: 15,
    color: "#667892",
    marginBottom: 14,
  },
  infoLine: {
    fontSize: 16,
    color: "#1D2740",
    marginBottom: 8,
  },
  roomLine: {
    fontSize: 15,
    color: "#6A7A90",
    marginBottom: 10,
  },
  statusLine: {
    fontSize: 15,
    color: "#14B97A",
    fontWeight: "500",
  },
  noteCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCE2E8",
    borderRadius: 22,
    padding: 20,
    marginBottom: 26,
  },
  noteHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  noteTitle: {
    marginLeft: 10,
    fontSize: 18,
    fontWeight: "700",
    color: "#1D2740",
  },
  noteText: {
    fontSize: 16,
    color: "#6A7A90",
    lineHeight: 23,
  },
  primaryBtn: {
    backgroundColor: "#465A72",
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    marginBottom: 18,
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 10,
  },
  secondaryBtn: {
    borderWidth: 1.5,
    borderColor: "#46576D",
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  secondaryBtnText: {
    color: "#425266",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 10,
  },
  errorText: {
    color: "#D9534F",
    fontSize: 15,
  },
});