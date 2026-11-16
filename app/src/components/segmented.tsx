import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, shadow, type } from "@/constants/theme";

type Option<T> = { value: T; label: string; testID?: string };

type Props<T> = { options: readonly Option<T>[]; value: T | null; onChange: (value: T) => void; accessibilityLabel?: string };

export function Segmented<T extends string | number>({ options, value, onChange, accessibilityLabel }: Props<T>) {
  return (
    <View style={styles.track} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            testID={o.testID}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(o.value)}
            style={[styles.item, on && styles.itemOn]}
          >
            <Text style={[styles.label, on && styles.labelOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", padding: 3, borderRadius: 12, backgroundColor: colors.secondary },
  item: { flex: 1, height: 38, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  itemOn: { backgroundColor: colors.surface, ...shadow.plate },
  label: { ...type.label, fontSize: 14, color: colors.muted },
  labelOn: { color: colors.ink },
});
