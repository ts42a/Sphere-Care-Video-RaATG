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
import { router } from "expo-router";
import { useEffect, useState } from "react";
import BottomNav from "../../src/components/BottomNav";
import PageHeader from "../../src/components/PageHeader";

import { bookingService } from "../../src/services/bookingService";
import type { AppointmentType } from "../../src/types/booking";

export default function BookingScreen() {
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadAppointmentTypes() {
      try {
        setLoading(true);
        setError("");
        const data = await bookingService.getAppointmentTypes();
        setAppointmentTypes(data);
      } catch (err) {
        setError("Failed to load appointment types.");
      } finally {
        setLoading(false);
      }
    }

    loadAppointmentTypes();
  }, []);

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

          <View style={styles.heroCard}>
            <Text style={styles.heroTitle}>What brings you in today?</Text>
            <Text style={styles.heroSubtitle}>
              Select the type of appointment you need
            </Text>
          </View>

          {loading ? (
            <ActivityIndicator size="large" color="#46576D" />
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : (
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
                    <Ionicons
                      name="help-circle-outline"
                      size={28}
                      color="#3EB7FF"
                    />
                  </View>

                  <Text style={styles.typeTitle}>{item.title}</Text>
                  <Text style={styles.typeDuration}>{item.duration}</Text>
                </Pressable>
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
  heroCard: {
    borderRadius: 24,
    paddingVertical: 22,
    paddingHorizontal: 20,
    marginBottom: 26,
    backgroundColor: "#E9EEFB",
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
  errorText: {
    color: "#D9534F",
    fontSize: 15,
  },
});