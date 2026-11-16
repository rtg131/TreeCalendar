import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import { colors, layout, radius, type } from "@/constants/theme";

type Variant = "primary" | "outline" | "ghost";

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, onPress, variant = "primary", icon, loading, disabled, testID, style }: Props) {
  const tint = variant === "primary" ? colors.white : variant === "outline" ? colors.brand : colors.ink;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.base, styles[variant], (pressed || disabled) && { opacity: disabled ? 0.4 : 0.75 }, style]}
    >
      {loading ? <ActivityIndicator size="small" color={tint} /> : icon}
      <Text style={[styles.label, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: layout.buttonHeight,
    borderRadius: radius.button,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primary: { backgroundColor: colors.brand },
  outline: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brand },
  ghost: { backgroundColor: "transparent" },
  label: { ...type.bodyStrong },
});
