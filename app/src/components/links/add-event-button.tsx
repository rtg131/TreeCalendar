import { router } from "expo-router";
import { Pressable, StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";

import { colors, radius } from "@/constants/theme";

export function AddEventButton() {
  return (
    <Pressable
      testID="feed-add-event"
      accessibilityRole="button"
      accessibilityLabel="Add an event"
      hitSlop={6}
      onPress={() => router.push("/submit")}
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}
    >
      <Svg width={16} height={16} viewBox="0 0 16 16">
        <Path d="M8 3v10M3 8h10" stroke={colors.ink} strokeWidth={1.75} strokeLinecap="round" />
      </Svg>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.secondary, alignItems: "center", justifyContent: "center" },
});
