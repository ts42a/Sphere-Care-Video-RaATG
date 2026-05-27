import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import PageHeader from "../../src/components/PageHeader";
import { bookingService } from "../../src/services/bookingService";
import type { AppointmentType, BookingConfirmation } from "../../src/types/booking";

type BookingTab = "bookNew" | "myAppointments";
type AppointmentGroup = "upcoming" | "past";

function formatDuration(durationMinutes?: number) {
  if (!durationMinutes) return "30 min";
  return `${durationMinutes} min`;
}

function normalizeStatus(status?: string) {
  return String(status ?? "confirmed").toLowerCase();
}

function isPastAppointment(booking: BookingConfirmation) {
  const status = normalizeStatus(booking.status);
  if (["completed", "cancelled", "canceled", "missed"].includes(status)) {
    return true;
  }

  if (!booking.date) return false;

  const appointmentDate = new Date(booking.date);
  if (Number.isNaN(appointmentDate.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  appointmentDate.setHours(0, 0, 0, 0);

  return appointmentDate < today;
}

function formatDateLabel(date: string) {
  if (!date) return "Date TBC";

  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return date;

  return value.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getStatusMeta(status?: string) {
  const normalized = normalizeStatus(status);

  if (normalized === "completed") {
    return {
      label: "Completed",
      badgeStyle: styles.statusCompleted,
      textStyle: styles.statusCompletedText,
    };
  }

  if (normalized === "cancelled" || normalized === "canceled") {
    return {
      label: "Cancelled",
      badgeStyle: styles.statusCancelled,
      textStyle: styles.statusCancelledText,
    };
  }

  if (normalized === "missed") {
    return {
      label: "Missed",
      badgeStyle: styles.statusMissed,
      textStyle: styles.statusMissedText,
    };
  }

  return {
    label: "Confirmed",
    badgeStyle: styles.statusConfirmed,
    textStyle: styles.statusConfirmedText,
  };
}

export default function BookingScreen() {
  const [activeTab, setActiveTab] = useState<BookingTab>("bookNew");
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([]);
  const [appointments, setAppointments] = useState<BookingConfirmation[]>([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [typesError, setTypesError] = useState("");
  const [appointmentsError, setAppointmentsError] = useState("");

  useEffect(() => {
    async function loadAppointmentTypes() {
      try {
        setTypesLoading(true);
        setTypesError("");
        const data = await bookingService.getAppointmentTypes();
        setAppointmentTypes(data);
      } catch (err) {
        console.error("Failed to load appointment types", err);
        setTypesError(
          err instanceof Error
            ? err.message
            : "Failed to load appointment types."
        );
      } finally {
        setTypesLoading(false);
      }
    }

    loadAppointmentTypes();
  }, []);

  useEffect(() => {
    if (activeTab !== "myAppointments") return;

    async function loadAppointments() {
      try {
        setAppointmentsLoading(true);
        setAppointmentsError("");
        const data = await bookingService.getMyBookings();
        setAppointments(data);
      } catch (err) {
        console.error("Failed to load appointments", err);
        setAppointmentsError(
          err instanceof Error ? err.message : "Failed to load appointments."
        );
      } finally {
        setAppointmentsLoading(false);
      }
    }

    loadAppointments();
  }, [activeTab]);

  const upcomingAppointments = useMemo(
    () => appointments.filter((item) => !isPastAppointment(item)),
    [appointments]
  );

  const pastAppointments = useMemo(
    () => appointments.filter((item) => isPastAppointment(item)),
    [appointments]
  );

  function renderBookNew() {
    if (typesLoading) {
      return <ActivityIndicator size="large" color="#46576D" />;
    }

    if (typesError) {
      return <Text style={styles.errorText}>{typesError}</Text>;
    }

    return (
      <View style={styles.grid}>
        {appointmentTypes.map((item) => (
          <Pressable
            key={item.id}
            style={styles.typeCard}
            onPress={() =>
              router.push({
                pathname: "/booking/doctor",
                params: {
                  typeId: item.id,
                  typeTitle: item.title,
                },
              })
            }
          >
            <View style={styles.typeIconWrap}>
              <Ionicons name="help-circle-outline" size={30} color="#3EB7FF" />
            </View>

            <Text style={styles.typeTitle}>{item.title}</Text>
            <Text style={styles.typeDuration}>
              {formatDuration(item.durationMinutes)}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  }

  function renderMyAppointments() {
    if (appointmentsLoading) {
      return <ActivityIndicator size="large" color="#46576D" />;
    }

    if (appointmentsError) {
      return (
        <View style={styles.emptyCard}>
          <Ionicons name="alert-circle-outline" size={30} color="#D9534F" />
          <Text style={styles.emptyTitle}>Unable to load appointments</Text>
          <Text style={styles.emptyDescription}>{appointmentsError}</Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => setActiveTab("bookNew")}
          >
            <Text style={styles.retryText}>Back to Book New</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={styles.appointmentList}>
        <AppointmentSection
          title="Upcoming"
          count={upcomingAppointments.length}
          group="upcoming"
          appointments={upcomingAppointments}
          emptyTitle="No upcoming appointments"
          emptyDescription="Your confirmed appointments will appear here after booking."
        />

        <AppointmentSection
          title="Past Appointments"
          count={pastAppointments.length}
          group="past"
          appointments={pastAppointments}
          emptyTitle="No past appointments"
          emptyDescription="Completed, cancelled, or missed appointments will appear here."
        />

        <Pressable
          style={styles.bookNewButton}
          onPress={() => setActiveTab("bookNew")}
        >
          <Ionicons name="add" size={22} color="#FFFFFF" />
          <Text style={styles.bookNewButtonText}>Book New Appointment</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.screen}>
          <View style={styles.topRow}>
            <PageHeader title="Booking" showBack={false} />
          </View>

          <View style={styles.heroCard}>
            <View style={styles.segmentWrap}>
              <Pressable
                style={[
                  styles.segmentButton,
                  activeTab === "bookNew" && styles.segmentButtonActive,
                ]}
                onPress={() => setActiveTab("bookNew")}
              >
                <Text
                  style={[
                    styles.segmentText,
                    activeTab === "bookNew" && styles.segmentTextActive,
                  ]}
                >
                  Book New
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.segmentButton,
                  activeTab === "myAppointments" && styles.segmentButtonActive,
                ]}
                onPress={() => setActiveTab("myAppointments")}
              >
                <Text
                  style={[
                    styles.segmentText,
                    activeTab === "myAppointments" && styles.segmentTextActive,
                  ]}
                >
                  My Appointments
                </Text>
              </Pressable>
            </View>

            <Text style={styles.heroTitle}>
              {activeTab === "bookNew"
                ? "What brings you in today?"
                : "Your appointments"}
            </Text>
            <Text style={styles.heroSubtitle}>
              {activeTab === "bookNew"
                ? "Select the type of appointment you need"
                : "View upcoming and past appointment details"}
            </Text>
          </View>

          {activeTab === "bookNew" ? renderBookNew() : renderMyAppointments()}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AppointmentSection({
  title,
  count,
  group,
  appointments,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  count: number;
  group: AppointmentGroup;
  appointments: BookingConfirmation[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{count}</Text>
        </View>
      </View>

      {appointments.length > 0 ? (
        appointments.map((item) => (
          <AppointmentCard key={item.bookingId} booking={item} group={group} />
        ))
      ) : (
        <EmptyAppointmentCard
          title={emptyTitle}
          description={emptyDescription}
        />
      )}
    </View>
  );
}

function AppointmentCard({
  booking,
  group,
}: {
  booking: BookingConfirmation;
  group: AppointmentGroup;
}) {
  const statusMeta = getStatusMeta(booking.status);

  return (
    <Pressable
      style={[styles.appointmentCard, group === "past" && styles.pastCard]}
      onPress={() =>
        router.push({
          pathname: "/booking/confirmed",
          params: { bookingId: booking.bookingId },
        })
      }
    >
      <View style={styles.appointmentIconBox}>
        <Ionicons name="calendar-outline" size={24} color="#3EB7FF" />
      </View>

      <View style={styles.appointmentContent}>
        <View style={styles.appointmentTitleRow}>
          <Text style={styles.appointmentTitle} numberOfLines={1}>
            {booking.appointmentType.title}
          </Text>
          <View style={[styles.statusBadge, statusMeta.badgeStyle]}>
            <Text style={[styles.statusText, statusMeta.textStyle]}>
              {statusMeta.label}
            </Text>
          </View>
        </View>

        <Text style={styles.doctorName} numberOfLines={1}>
          {booking.doctor.name}
        </Text>
        <Text style={styles.doctorRole} numberOfLines={1}>
          {booking.doctor.role}
        </Text>

        <View style={styles.infoRow}>
          <Ionicons name="time-outline" size={16} color="#6A7A90" />
          <Text style={styles.infoText} numberOfLines={1}>
            {formatDateLabel(booking.date)}, {booking.time || "Time TBC"}
          </Text>
        </View>

        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={16} color="#6A7A90" />
          <Text style={styles.infoText} numberOfLines={1}>
            {booking.room || "Location TBC"}
          </Text>
        </View>
      </View>

      <Ionicons name="chevron-forward" size={22} color="#9AA3AF" />
    </Pressable>
  );
}

function EmptyAppointmentCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIconBox}>
        <Ionicons name="calendar-clear-outline" size={26} color="#3EB7FF" />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
    </View>
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
    paddingBottom: 32,
  },
  topRow: {
    marginBottom: 0,
  },
  heroCard: {
    borderRadius: 24,
    paddingVertical: 18,
    paddingHorizontal: 18,
    marginBottom: 26,
    backgroundColor: "#E9EEFB",
  },
  segmentWrap: {
    flexDirection: "row",
    backgroundColor: "#DCE6F8",
    borderRadius: 18,
    padding: 4,
    marginBottom: 18,
  },
  segmentButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentButtonActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#6A7A90",
  },
  segmentTextActive: {
    color: "#425266",
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#425266",
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 16,
    color: "#5E6F84",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 18,
  },
  typeCard: {
    width: "47%",
    minHeight: 132,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCE2E8",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 14,
  },
  typeIconWrap: {
    marginBottom: 12,
  },
  typeTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#425266",
    textAlign: "center",
    marginBottom: 6,
  },
  typeDuration: {
    fontSize: 15,
    color: "#6A7A90",
    textAlign: "center",
  },
  appointmentList: {
    gap: 22,
  },
  sectionBlock: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#425266",
  },
  countBadge: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#E9EEFB",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  countText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#425266",
  },
  appointmentCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCE2E8",
    padding: 14,
  },
  pastCard: {
    opacity: 0.86,
  },
  appointmentIconBox: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: "#EAF7FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  appointmentContent: {
    flex: 1,
  },
  appointmentTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  appointmentTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "800",
    color: "#425266",
  },
  doctorName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#425266",
    marginTop: 6,
  },
  doctorRole: {
    fontSize: 13,
    color: "#6A7A90",
    marginTop: 2,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 7,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: "#6A7A90",
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "800",
  },
  statusConfirmed: {
    backgroundColor: "#E7F7EF",
  },
  statusConfirmedText: {
    color: "#2E7D55",
  },
  statusCompleted: {
    backgroundColor: "#EEF2F6",
  },
  statusCompletedText: {
    color: "#425266",
  },
  statusCancelled: {
    backgroundColor: "#FDECEC",
  },
  statusCancelledText: {
    color: "#B4443F",
  },
  statusMissed: {
    backgroundColor: "#FFF2DA",
  },
  statusMissedText: {
    color: "#A56916",
  },
  emptyCard: {
    alignItems: "center",
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCE2E8",
    paddingVertical: 24,
    paddingHorizontal: 18,
  },
  emptyIconBox: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: "#EAF7FF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#425266",
    textAlign: "center",
    marginBottom: 6,
  },
  emptyDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: "#6A7A90",
    textAlign: "center",
  },
  bookNewButton: {
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: "#3EB7FF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  bookNewButtonText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  retryButton: {
    marginTop: 16,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 18,
    backgroundColor: "#E9EEFB",
  },
  retryText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#425266",
  },
  errorText: {
    color: "#D9534F",
    fontSize: 15,
  },
});