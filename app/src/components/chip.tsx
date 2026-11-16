import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { colors, layout, radius } from "@/constants/theme";

type Props = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
  size?: "filter" | "interest";
  icon?: ReactNode;
};

export function Chip({ label, selected, onPress, testID, size = "interest", icon }: Props) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={size === "filter" ? 5 : 2}
      style={({ pressed }) => [styles.chip, size === "filter" ? styles.filter : styles.interest, selected && styles.selected, pressed && { opacity: 0.7 }]}
    >
      {icon}
      <Text style={[styles.label, size === "filter" && styles.filterLabel, selected && styles.selectedLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 0.5,
    borderColor: colors.lineStrong,
  },
  interest: { height: layout.interestChipHeight, paddingHorizontal: 14 },
  filter: { height: layout.filterChipHeight, paddingHorizontal: 12 },
  selected: { backgroundColor: colors.brandSoft, borderColor: colors.brand, borderWidth: 1 },
  label: { fontSize: 14, color: colors.ink },
  filterLabel: { fontSize: 13 },
  selectedLabel: { color: colors.brandInk, fontWeight: "500" },
});
