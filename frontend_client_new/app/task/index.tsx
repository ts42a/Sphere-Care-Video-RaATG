import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Ionicons, Feather} from "@expo/vector-icons";
import PageHeader from "../../src/components/PageHeader";
import { router } from "expo-router";
import HeaderBar from "../../src/components/HeaderBar";
import TaskCard from "../../src/components/TaskCard";
import BottomNav from "../../src/components/BottomNav";

export default function TaskScreen() {
  const filters = ["All", "Medication", "Exercise", "Meal"];
  const activeFilter = "All";

  const tasks = [
    {
      id: 1,
      category: "Medication",
      name: "Vitamin D 1000 IU after breakfast",
      time: "8:00",
      type: "green" as const,
      icon: (
        <Ionicons name="medical-outline" size={26} color="#27C27F" />
      ),
    },
    {
      id: 2,
      category: "Exercise",
      name: "Morning walk for 20 minutes",
      time: "8:30",
      type: "orange" as const,
      icon: <Feather name="activity" size={24} color="#FF932D" />,
    },
    {
      id: 3,
      category: "Meal",
      name: "Prepare low salt lunch",
      time: "12:00",
      type: "red" as const,
      icon: (
        <Ionicons name="restaurant-outline" size={26} color="#F15F5F" />
      ),
    },
    {
      id: 4,
      category: "Medication",
      name: "Blood pressure tablet after dinner",
      time: "19:00",
      type: "green" as const,
      icon: (
        <Ionicons name="medical-outline" size={26} color="#27C27F" />
      ),
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.screen}>
          <PageHeader title="Task" />

          <View style={styles.aiCard}>
            <View style={styles.aiIconWrap}>
              <Text style={styles.aiIconText}>AI</Text>
            </View>

            <View style={styles.aiContent}>
              <Text style={styles.aiText}>
                Need help planning today’s tasks and reminders?
              </Text>

              <Pressable>
                <Text style={styles.aiLink}>Ask AI assistant</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {filters.map((filter) => {
              const isActive = filter === activeFilter;
              return (
                <Pressable
                  key={filter}
                  style={[
                    styles.filterBtn,
                    isActive && styles.filterBtnActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterBtnText,
                      isActive && styles.filterBtnTextActive,
                    ]}
                  >
                    {filter}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

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

      <BottomNav active="task" />
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 22,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#425266",
  },
  topSpacer: {
    width: 36,
  },
  aiCard: {
    backgroundColor: "#E9EEFB",
    borderRadius: 22,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 18,
  },
  aiIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: "#526273",
    justifyContent: "center",
    alignItems: "center",
  },
  aiIconText: {
    fontSize: 20,
    fontWeight: "700",
    color: "#526273",
  },
  aiContent: {
    flex: 1,
  },
  aiText: {
    color: "#526273",
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 10,
  },
  aiLink: {
    color: "#FF8A2B",
    fontSize: 15,
    fontWeight: "600",
  },
  filterRow: {
    gap: 12,
    paddingBottom: 8,
    marginBottom: 18,
  },
  filterBtn: {
    backgroundColor: "#F0F1F4",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  filterBtnActive: {
    backgroundColor: "#46576D",
  },
  filterBtnText: {
    color: "#526273",
    fontSize: 15,
    fontWeight: "500",
  },
  filterBtnTextActive: {
    color: "#FFFFFF",
  },
  taskList: {
    gap: 16,
    paddingBottom: 20,
  },
});