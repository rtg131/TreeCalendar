import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, layout, radius, type } from "@/constants/theme";

type Props = {
  icon: ReactNode;
  title: string;
  body: string;
  action?: { label: string; onPress: () => void; testID?: string };
  tone?: "neutral" | "danger";
  testID?: string;
};

export function EmptyState({ icon, title, body, action, tone = "neutral", testID }: Props) {
  return (
    <View testID={testID} style={styles.wrap}>
      <View style={[styles.glyph, tone === "danger" && { backgroundColor: "rgba(199,51,47,0.1)" }]}>{icon}</View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {action ? (
        <Pressable testID={action.testID} accessibilityRole="button" onPress={action.onPress} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}>
          <Text style={styles.btnText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: 56, paddingHorizontal: 24, gap: 6 },
  glyph: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title: { ...type.bodyStrong, fontSize: 16, color: colors.ink, textAlign: "center" },
  body: { ...type.meta, fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 19 },
  btn: {
    marginTop: 12,
    height: layout.buttonHeight,
    paddingHorizontal: 16,
    borderRadius: radius.button,
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 0.5,
    borderColor: colors.lineStrong,
  },
  btnText: { ...type.bodyStrong, color: colors.ink },
});
