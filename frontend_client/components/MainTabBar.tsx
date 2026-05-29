import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { View, StyleSheet, Pressable } from "react-native";
import { Ionicons, Feather, MaterialCommunityIcons } from "@expo/vector-icons";

type TabRouteName = "index" | "call" | "booking" | "task" | "messages";

export default function MainTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.nav}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const routeName = route.name as TabRouteName;

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          const accessibilityLabel =
            descriptors[route.key].options.tabBarAccessibilityLabel;

          return (
            <Pressable
              key={route.key}
              style={styles.item}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={accessibilityLabel}
            >
              {renderIcon(routeName, isFocused)}
              <View style={isFocused ? styles.dot : styles.dotHidden} />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.indicator} />
    </View>
  );
}

function renderIcon(routeName: TabRouteName, isFocused: boolean) {
  const color = isFocused ? "#FFFFFF" : "#5E6B82";

  switch (routeName) {
    case "index":
      return <Ionicons name="home-outline" size={30} color={color} />;

    case "call":
      return <Feather name="phone-call" size={28} color={color} />;

    case "booking":
      return <Ionicons name="calendar-outline" size={30} color={color} />;

    case "task":
      return (
        <Ionicons name="document-text-outline" size={28} color={color} />
      );

    case "messages":
      return (
        <MaterialCommunityIcons
          name="message-text-outline"
          size={29}
          color={color}
        />
      );

    default:
      return <Ionicons name="ellipse-outline" size={26} color={color} />;
  }
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