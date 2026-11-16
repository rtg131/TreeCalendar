import { StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/icon";
import { colors, type } from "@/constants/theme";

export function Brand({ size = 24 }: { size?: number }) {
  return (
    <View style={styles.row} accessibilityRole="header">
      <Icon name="compass" size={size} color={colors.brand} strokeWidth={1.75} />
      <Text style={[styles.text, size > 24 && { fontSize: size * 0.9, lineHeight: size * 1.1 }]}>Scout</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  text: { ...type.brand, color: colors.ink },
});
