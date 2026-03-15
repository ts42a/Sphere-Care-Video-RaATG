import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";

type Props = {
  title: string;
};

export default function PageHeader({ title }: Props) {
  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} style={styles.backWrap}>
        <Feather name="arrow-left" size={26} color="#425266" />
      </Pressable>

      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 28,
  },
  backWrap: {
    marginRight: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#425266",
  },
});