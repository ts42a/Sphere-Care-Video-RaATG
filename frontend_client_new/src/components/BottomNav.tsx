import { router } from "expo-router";
import { View, StyleSheet, Pressable } from "react-native";
import { Ionicons, Feather, MaterialCommunityIcons } from "@expo/vector-icons";

type BottomNavProps = {
  active?: "home" | "call" | "booking" | "task" | "message";
};

export default function BottomNav({ active = "home" }: BottomNavProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.nav}>
        <NavItem
          active={active === "home"}
          onPress={() => router.push("/")}
          icon={
            <Ionicons
              name="home-outline"
              size={30}
              color={active === "home" ? "#FFFFFF" : "#5E6B82"}
            />
          }
        />

        <NavItem
          active={active === "call"}
          onPress={() => router.push("./call")}
          icon={
            <Feather
              name="phone-call"
              size={28}
              color={active === "call" ? "#FFFFFF" : "#5E6B82"}
            />
          }
        />

        <NavItem
          active={active === "booking"}
          onPress={() => router.push("./booking")}
          icon={
            <Ionicons
              name="calendar-outline"
              size={30}
              color={active === "booking" ? "#FFFFFF" : "#5E6B82"}
            />
          }
        />

        <NavItem
          active={active === "task"}
          onPress={() => router.push("./task")}
          icon={
            <Ionicons
              name="document-text-outline"
              size={28}
              color={active === "task" ? "#FFFFFF" : "#5E6B82"}
            />
          }
        />

        <NavItem
          active={active === "message"}
          onPress={() => router.push("./call")}
          icon={
            <MaterialCommunityIcons
              name="message-text-outline"
              size={29}
              color={active === "message" ? "#FFFFFF" : "#5E6B82"}
            />
          }
        />
      </View>

      <View style={styles.indicator} />
    </View>
  );
}

type NavItemProps = {
  active: boolean;
  onPress: () => void;
  icon: React.ReactNode;
};

function NavItem({ active, onPress, icon }: NavItemProps) {
  return (
    <Pressable style={styles.item} onPress={onPress}>
      {icon}
      <View style={active ? styles.dot : styles.dotHidden} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#081936",
    paddingTop: 18,
    paddingHorizontal: 26,
    paddingBottom: 10,
  },
  nav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  item: {
    width: 46,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#27C27F",
    marginTop: 6,
  },
  dotHidden: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "transparent",
    marginTop: 6,
  },
  indicator: {
    width: 134,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#F6F6F6",
    alignSelf: "center",
    marginTop: 14,
  },
});