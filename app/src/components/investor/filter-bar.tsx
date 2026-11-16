import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import { colors, layout, radius, shadow, type } from "@/constants/theme";

export type Option<T extends string> = { value: T; label: string };

export function FilterRow<T extends string>({ label, options, value, onChange }: { label: string; options: Option<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel={label} contentContainerStyle={styles.row}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={`filter-${label.toLowerCase()}-${o.value.toLowerCase().replace(/\s+/g, "-")}`}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.chip, on && styles.on]}
          >
            <Text style={[styles.text, on && styles.onText]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: layout.screenPadding, gap: 8, paddingVertical: 4 },
  chip: { ...shadow.plate, height: layout.filterChipHeight, paddingHorizontal: 12, borderRadius: radius.pill, justifyContent: "center", backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.lineStrong },
  on: { backgroundColor: colors.brandSoft, borderColor: colors.brand, borderWidth: 1 },
  text: { ...type.meta, color: colors.ink },
  onText: { color: colors.brandInk, fontWeight: "500" },
});
