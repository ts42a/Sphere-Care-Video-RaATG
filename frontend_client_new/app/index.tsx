import { router } from "expo-router";
import { Ionicons, Feather } from "@expo/vector-icons";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from "react-native";
import HeaderBar from "../src/components/HeaderBar";
import ReminderCard from "../src/components/ReminderCard";
import QuickActionCard from "../src/components/QuickActionCard";
import TaskCard from "../src/components/TaskCard";
import BottomNav from "../src/components/BottomNav";

export default function HomeScreen() {
  const tasks = [
  {
    id: 1,
    category: "Medication",
    name: "Name of the medication in full",
    time: "8:00",
    type: "green" as const,
    icon: <Ionicons name="medical-outline" size={26} color="#27C27F" />,
  },
  {
    id: 2,
    category: "Medication",
    name: "Name of the medication in full",
    time: "8:00",
    type: "orange" as const,
    icon: <Feather name="activity" size={24} color="#FF932D" />,
  },
  {
    id: 3,
    category: "Medication",
    name: "Name of the medication in full",
    time: "8:00",
    type: "red" as const,
    icon: <Ionicons name="restaurant-outline" size={26} color="#F15F5F" />,
  },
];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.homeScreen}>
          <HeaderBar userName="Name" />

          <ReminderCard
            title="Time to check your"
            highlight="Blood pressure"
            primaryText="Check Now"
            secondaryText="Remind Later"
          />

          <View style={styles.quickActionsRow}>
            <QuickActionCard
                bigTitle="CALL"
                smallTitle="Someone"
                variant="purple"
                icon={<Feather name="phone-call" size={28} color="#B6BCEB" />}
                onPress={() => router.push("./call")}
            />
            <QuickActionCard
                bigTitle="BOOKING"
                smallTitle="Manage"
                variant="mint"
                icon={<Feather name="calendar" size={28} color="#9FD3C7" />}
                onPress={() => router.push("./booking")}
            />
          </View>

          <View style={styles.taskHeader}>
            <Text style={styles.taskHeaderTitle}>Today’s Task</Text>
            <Pressable
              style={styles.taskAddBtn}
              onPress={() => router.push("./task")}
            >
              <Text style={styles.taskAddBtnText}>+</Text>
            </Pressable>
          </View>

          <View style={styles.taskList}>
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                category={task.category}
                name={task.name}
                time={task.time}
                type={task.type}
                icon={task.icon}
              />
            ))}
          </View>
        </View>
      </ScrollView>

      <BottomNav active="home" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f7f7f7",
  },
  scrollContent: {
    flexGrow: 1,
  },
  homeScreen: {
    paddingTop: 32,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  quickActionsRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 72,
  },
  taskHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  taskHeaderTitle: {
    fontSize: 32,
    color: "#425266",
    fontWeight: "500",
  },
  taskAddBtn: {
    width: 36,
    height: 36,
    backgroundColor: "#46576d",
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  taskAddBtnText: {
    color: "#ffffff",
    fontSize: 24,
    lineHeight: 24,
  },
  taskList: {
    gap: 16,
    paddingBottom: 24,
  },
});