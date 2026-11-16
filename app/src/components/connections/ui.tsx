import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { BackIcon, CheckIcon } from "@/components/icons";
import { colors, layout, radius, shadow, space, type } from "@/constants/theme";
import { isPendingVerification, isVerified } from "@/lib/connections";

type Fallback = "/inbox" | "/companies" | "/profile";

export const goBack = (fallback: Fallback = "/inbox") => (router.canGoBack() ? router.back() : router.replace(fallback));

export function ScreenHeader({ title, subtitle, right, fallback }: { title: string; subtitle?: string; right?: ReactNode; fallback?: Fallback }) {
  return (
    <View style={styles.header}>
      <Pressable testID="back" accessibilityRole="button" accessibilityLabel="Back" onPress={() => goBack(fallback)} style={styles.iconBtn}>
        <BackIcon color={colors.ink} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text style={styles.meta} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right ?? <View style={styles.iconBtn} />}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

export function Card({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return <View testID={testID} style={[styles.card, style]}>{children}</View>;
}

export function Notice({ title, body, tone = "neutral", testID }: { title: string; body?: string; tone?: "neutral" | "pending" | "danger"; testID?: string }) {
  return (
    <View testID={testID} accessibilityRole={tone === "danger" ? "alert" : undefined} style={[styles.notice, tone === "pending" && styles.pending, tone === "danger" && styles.danger]}>
      <Text style={[styles.noticeTitle, tone === "danger" && { color: colors.danger }]}>{title}</Text>
      {body ? <Text style={styles.noticeBody}>{body}</Text> : null}
    </View>
  );
}

export function VerificationBadge({ company }: { company: { verified?: boolean } }) {
  if (isVerified(company)) {
    return (
      <View testID="company-verified" style={[styles.pill, { backgroundColor: "rgba(31,157,58,0.12)" }]}>
        <CheckIcon size={12} color={colors.success} />
        <Text style={[styles.pillText, { color: colors.success }]}>Verified</Text>
      </View>
    );
  }
  if (isPendingVerification(company)) {
    return (
      <View testID="company-pending" style={[styles.pill, { backgroundColor: colors.goldSoft }]}>
        <Text style={[styles.pillText, { color: colors.gold }]}>Pending verification</Text>
      </View>
    );
  }
  return null;
}

export function PendingVerificationNotice() {
  return (
    <Notice
      testID="pending-verification"
      tone="pending"
      title="Pending verification"
      body="Scout reviews new companies before they can claim events or reach talent. You can set up your page and invite teammates while you wait"
    />
  );
}

export function Pill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "accent" | "success" }) {
  const color = tone === "accent" ? colors.brandInk : tone === "success" ? colors.success : colors.muted;
  const bg = tone === "accent" ? colors.brandSoft : tone === "success" ? "rgba(31,157,58,0.12)" : colors.secondary;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: layout.screenPadding, paddingBottom: space.xxxl },
  header: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 52, paddingHorizontal: 8 },
  headerTitle: { ...type.cardTitle, fontSize: 17, color: colors.ink },
  iconBtn: { width: layout.tapTarget, height: layout.tapTarget, alignItems: "center", justifyContent: "center", borderRadius: radius.button },
  section: { ...type.label, color: colors.muted, marginTop: space.xl, marginBottom: space.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, ...shadow.card },
  row: { paddingHorizontal: layout.cardPadding, paddingVertical: space.md, gap: space.sm },
  divider: { borderTopWidth: 0.5, borderTopColor: colors.line },
  inline: { flexDirection: "row", alignItems: "center", gap: space.sm },
  actions: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  title: { ...type.bodyStrong, color: colors.ink, flexShrink: 1 },
  body: { ...type.body, color: colors.ink },
  meta: { ...type.meta, color: colors.muted },
  quote: { ...type.meta, color: colors.ink, fontStyle: "italic" },
  error: { ...type.meta, color: colors.danger },
  input: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.input, borderWidth: 1, borderColor: colors.lineStrong, color: colors.ink, fontSize: 15, backgroundColor: colors.surface },
  label: { ...type.label, color: colors.ink, marginBottom: space.xs, marginTop: space.md },
  notice: { padding: layout.cardPadding, borderRadius: radius.card, backgroundColor: colors.secondary, gap: space.xs, marginTop: space.md },
  pending: { backgroundColor: colors.goldSoft },
  danger: { backgroundColor: "rgba(199,51,47,0.08)" },
  noticeTitle: { ...type.label, color: colors.ink },
  noticeBody: { ...type.meta, color: colors.muted },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, height: 22, paddingHorizontal: 8, borderRadius: radius.tag, alignSelf: "flex-start" },
  pillText: { ...type.tag, fontWeight: "500" },
  small: { height: 36, paddingHorizontal: 12 },
});
