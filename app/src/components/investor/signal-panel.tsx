import { StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/icon";
import { investorTier } from "@/components/investor-badge";
import { colors, radius, type } from "@/constants/theme";

export function SignalPanel({ score, reasons }: { score: number; reasons: string[] }) {
  const tier = investorTier(score);
  return (
    <View testID="investor-signal" accessibilityLabel="Investor signal" style={[styles.panel, tier === "low" && styles.low]}>
      <View style={styles.head}>
        <Text style={styles.label}>{tier === "high" ? "Investors likely" : tier === "mid" ? "Some investors" : "Few investors expected"}</Text>
        <Text style={[styles.num, tier === "low" && { color: colors.muted }]}>{score}</Text>
      </View>
      {reasons.length ? (
        reasons.map((r) => (
          <View key={r} style={styles.li}>
            <Icon name="check" size={14} color={colors.gold} strokeWidth={2} />
            <Text style={styles.reason}>{r}</Text>
          </View>
        ))
      ) : (
        <Text style={[styles.reason, { color: colors.muted }]}>No investor signals in this listing</Text>
      )}
      <Text style={styles.note}>Inferred from the listing: format, judges, sponsors, and host. Not confirmed by the organizer</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: 14, borderRadius: radius.card, backgroundColor: colors.goldSoft, gap: 6 },
  low: { backgroundColor: colors.secondary },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
  label: { ...type.label, fontSize: 14, fontWeight: "600", color: colors.ink },
  num: { ...type.numeric, fontSize: 22, fontWeight: "600", color: colors.gold },
  li: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  reason: { ...type.meta, flex: 1, color: colors.ink },
  note: { ...type.tag, color: colors.muted, marginTop: 4 },
});
