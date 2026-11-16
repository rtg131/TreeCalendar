import { Pressable, StyleSheet, Text } from "react-native";

import { Icon } from "@/components/icon";
import { colors, layout, radius, shadow, type } from "@/constants/theme";

type Props = { label: string; selected?: boolean; onPress?: () => void; testID?: string };

export function SelectChip({ label, selected, onPress, testID }: Props) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.on, pressed && { opacity: 0.75 }]}
    >
      {selected ? <Icon name="check" size={14} color={colors.brandInk} strokeWidth={2} /> : null}
      <Text style={[styles.label, selected && styles.labelOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: layout.interestChipHeight,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 0.5,
    borderColor: colors.lineStrong,
    ...shadow.plate,
  },
  on: { backgroundColor: colors.brandSoft, borderColor: colors.brand, borderWidth: 1, shadowOpacity: 0 },
  label: { ...type.body, fontSize: 14, color: colors.ink },
  labelOn: { color: colors.brandInk, fontWeight: "500" },
});
