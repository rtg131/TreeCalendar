import { StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/icon";
import { colors, INVESTOR_SOME_MIN, radius, type } from "@/constants/theme";
import { INVESTORS_LIKELY_MIN } from "@/convex/lib/ranking";

export function investorTier(score: number) {
  return score >= INVESTORS_LIKELY_MIN ? "high" : score >= INVESTOR_SOME_MIN ? "mid" : "low";
}

export function InvestorBadge({ score, variant = "badge" }: { score: number; variant?: "badge" | "meter" }) {
  if (variant === "meter") return <InvestorMeter score={score} />;
  const tier = investorTier(score);
  if (tier === "low") return null;
  return (
    <View testID="investor-badge" style={[styles.badge, tier === "mid" && styles.mid]}>
      {tier === "high" ? <Icon name="trending-up" size={12} color={colors.gold} strokeWidth={2} /> : null}
      <Text style={[styles.text, tier === "mid" && styles.midText]}>{tier === "high" ? "Investors likely" : "Some investors"}</Text>
    </View>
  );
}

export function InvestorMeter({ score }: { score: number }) {
  const on = Math.round(score / 20);
  return (
    <View testID="investor-meter" accessible accessibilityLabel={`Investor score ${score} of 100`} style={styles.meter}>
      <View style={styles.bars}>
        {[4, 6, 8, 10, 12].map((h, i) => (
          <View key={h} style={[styles.bar, { height: h }, i < on && styles.barOn]} />
        ))}
      </View>
      <Text style={styles.meterText}>{score}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", gap: 4, height: 22, paddingHorizontal: 8, borderRadius: radius.tag, backgroundColor: colors.goldSoft },
  mid: { backgroundColor: colors.secondary },
  text: { ...type.tag, color: colors.gold, fontWeight: "600" },
  midText: { fontWeight: "500" },
  meter: { flexDirection: "row", alignItems: "center", gap: 6, height: 22 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 12 },
  bar: { width: 3, borderRadius: 1, backgroundColor: colors.lineStrong },
  barOn: { backgroundColor: colors.gold },
  meterText: { ...type.tag, ...type.numeric, color: colors.gold, fontWeight: "600" },
});
