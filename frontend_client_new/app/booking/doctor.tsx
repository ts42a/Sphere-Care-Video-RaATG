import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import BottomNav from "../../src/components/BottomNav";
import PageHeader from "../../src/components/PageHeader";
import { bookingService } from "../../src/services/bookingService";
import type { Doctor } from "../../src/types/booking";

export default function DoctorsScreen() {
  const params = useLocalSearchParams<{
    typeId?: string;
    typeTitle?: string;
  }>();

  const typeId = params.typeId ?? "";
  const typeTitle = params.typeTitle ?? "Appointment";

  const [filter, setFilter] = useState<"All" | "Available" | "Unavailable">(
    "All"
  );
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadDoctors() {
      try {
        setLoading(true);
        setError("");
        const data = await bookingService.getDoctorsByType(typeId);
        setDoctors(data);
      } catch (err) {
        setError("Failed to load doctors.");
      } finally {
        setLoading(false);
      }
    }

    if (typeId) {
      loadDoctors();
    }
  }, [typeId]);

  const filteredDoctors = doctors.filter((doctor) => {
    if (filter === "Available") return doctor.available;
    if (filter === "Unavailable") return !doctor.available;
    return true;
  });

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

          <View style={styles.headerBlock}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerTitle}>Select a Doctor</Text>
              <Text style={styles.headerSubtitle}>
                Showing available doctors for {typeTitle}
              </Text>
            </View>
            <Ionicons name="help-circle-outline" size={26} color="#6D7A88" />
          </View>

          <View style={styles.filterRow}>
            {["All", "Available", "Unavailable"].map((item) => {
              const active = filter === item;
              return (
                <Pressable
                  key={item}
                  style={[styles.filterBtn, active && styles.filterBtnActive]}
                  onPress={() =>
                    setFilter(item as "All" | "Available" | "Unavailable")
                  }
                >
                  <Text
                    style={[styles.filterText, active && styles.filterTextActive]}
                  >
                    {item}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {loading ? (
            <ActivityIndicator size="large" color="#46576D" />
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : (
            <View style={styles.list}>
              {filteredDoctors.map((doctor) => (
                <View key={doctor.id} style={styles.doctorCard}>
                  <View
                    style={[
                      styles.avatarWrap,
                      !doctor.available && styles.avatarWrapDisabled,
                    ]}
                  >
                    <Feather name="user" size={28} color="#FFFFFF" />
                  </View>

                  <View style={styles.doctorInfo}>
                    <Text style={styles.doctorName}>{doctor.name}</Text>
                    <Text style={styles.doctorRole}>{doctor.role}</Text>
                    <Text
                      style={[
                        styles.statusText,
                        doctor.available
                          ? styles.statusAvailable
                          : styles.statusUnavailable,
                      ]}
                    >
                      ● {doctor.available ? "Available now" : "Unavailable"}
                    </Text>
                  </View>

                  <Pressable
                    style={[
                      styles.bookBtn,
                      !doctor.available && styles.bookBtnDisabled,
                    ]}
                    disabled={!doctor.available}
                    onPress={() =>
                      router.push({
                        pathname: "/booking/schedule",
                        params: {
                          typeId,
                          typeTitle,
                          doctorId: doctor.id,
                        },
                      })
                    }
                  >
                    <Text
                      style={[
                        styles.bookBtnText,
                        !doctor.available && styles.bookBtnTextDisabled,
                      ]}
                    >
                      Book
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
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
  headerBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  headerTextWrap: {
    flex: 1,
    marginHorizontal: 14,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#425266",
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 15,
    color: "#697A90",
  },
  filterRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
  },
  filterBtn: {
    backgroundColor: "#ECEDEF",
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D6D9DE",
  },
  filterBtnActive: {
    backgroundColor: "#46576D",
    borderColor: "#46576D",
  },
  filterText: {
    fontSize: 15,
    color: "#62738A",
    fontWeight: "500",
  },
  filterTextActive: {
    color: "#FFFFFF",
  },
  list: {
    gap: 14,
  },
  doctorCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCE2E8",
    borderRadius: 22,
    padding: 18,
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
    marginRight: 18,
  },
  avatarWrapDisabled: {
    backgroundColor: "#A8B0BD",
  },
  doctorInfo: {
    flex: 1,
  },
  doctorName: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1D2740",
    marginBottom: 4,
  },
  doctorRole: {
    fontSize: 15,
    color: "#667892",
    marginBottom: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: "500",
  },
  statusAvailable: {
    color: "#15B97A",
  },
  statusUnavailable: {
    color: "#9AA3AF",
  },
  bookBtn: {
    backgroundColor: "#46576D",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  bookBtnDisabled: {
    backgroundColor: "#D4DCE7",
  },
  bookBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  bookBtnTextDisabled: {
    color: "#9DA6B4",
  },
  errorText: {
    color: "#D9534F",
    fontSize: 15,
  },
});