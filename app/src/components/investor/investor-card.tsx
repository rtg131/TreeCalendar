import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/icon";
import { InvestorMeter } from "@/components/investor-badge";
import type { InvestorEvent } from "@/components/investor/scouting";
import { colors, EVENT_TYPE_META, layout, radius, shadow, type } from "@/constants/theme";
import { dateBadge, relativeDay } from "@/lib/format";

export const openInvestorEvent = (id: string) => router.push({ pathname: "/investor-event/[id]", params: { id } });

export function InvestorCard({ event }: { event: InvestorEvent }) {
  const { school, reasons } = event;
  const badge = dateBadge(event.startTime);
  return (
    <Pressable
      testID={`investor-card-${event._id}`}
      accessibilityRole="button"
      accessibilityLabel={event.title}
      onPress={() => openInvestorEvent(event._id)}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.tile}>
        <Text style={styles.month}>{badge.month}</Text>
        <Text style={styles.day}>{badge.day}</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {event.title}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {relativeDay(event.startTime, event.endTime)} · {event.isOnline ? "Online" : event.city}
        </Text>
        {event.organizer ? (
          <Text style={styles.sub} numberOfLines={1}>
            {event.organizer}
          </Text>
        ) : null}
        <View style={styles.row}>
          <InvestorMeter score={event.investorScore} />
          <Text style={styles.tag}>{EVENT_TYPE_META[event.eventType].label}</Text>
          {school ? <Text style={styles.tag}>{school}</Text> : null}
        </View>
        {reasons.length ? (
          <View style={styles.why}>
            <Icon name="trending-up" size={13} color={colors.gold} />
            <Text style={styles.whyText} numberOfLines={2}>
              {reasons.slice(0, 2).join(" · ")}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { ...shadow.card, flexDirection: "row", gap: 12, padding: layout.cardPadding, borderRadius: radius.card, backgroundColor: colors.surface },
  tile: { width: 52, height: 56, borderRadius: radius.sm, backgroundColor: colors.secondary, alignItems: "center", justifyContent: "center" },
  month: { fontSize: 11, fontWeight: "600", color: colors.brand, letterSpacing: 0.3 },
  day: { ...type.numeric, fontSize: 22, lineHeight: 24, fontWeight: "600", color: colors.ink, marginTop: 2 },
  body: { flex: 1, gap: 4 },
  title: { ...type.cardTitle, color: colors.ink },
  sub: { ...type.meta, color: colors.muted },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4 },
  tag: { ...type.tag, height: 22, lineHeight: 22, paddingHorizontal: 8, borderRadius: radius.tag, overflow: "hidden", backgroundColor: colors.secondary, color: colors.muted },
  why: { flexDirection: "row", gap: 6, alignItems: "flex-start", marginTop: 2 },
  whyText: { ...type.tag, flex: 1, color: colors.muted },
});
