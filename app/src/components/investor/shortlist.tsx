import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { InvestorMeter } from "@/components/investor-badge";
import { openInvestorEvent } from "@/components/investor/investor-card";
import type { InvestorEvent } from "@/components/investor/scouting";
import { colors, layout, radius, shadow, type } from "@/constants/theme";
import { relativeDay } from "@/lib/format";

export function WeekShortlist({ items }: { items: InvestorEvent[] }) {
  if (!items.length) return null;
  return (
    <View testID="week-shortlist" style={styles.wrap}>
      <Text style={styles.heading}>Worth attending this week</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((event) => (
          <Pressable
            key={event._id}
            testID={`shortlist-${event._id}`}
            accessibilityRole="button"
            accessibilityLabel={event.title}
            onPress={() => openInvestorEvent(event._id)}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
          >
            <View style={styles.top}>
              <Text style={styles.when} numberOfLines={1}>
                {relativeDay(event.startTime, event.endTime)}
              </Text>
              <InvestorMeter score={event.investorScore} />
            </View>
            <Text style={styles.title} numberOfLines={2}>
              {event.title}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {[event.school, event.organizer].filter(Boolean).join(" · ")}
            </Text>
            {event.reasons[0] ? (
              <Text style={styles.reason} numberOfLines={1}>
                {event.reasons[0]}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  heading: { ...type.label, color: colors.ink, paddingHorizontal: layout.screenPadding, marginBottom: 8 },
  row: { paddingHorizontal: layout.screenPadding, gap: layout.cardGap },
  card: { ...shadow.card, width: 248, padding: layout.cardPadding, gap: 4, borderRadius: radius.card, backgroundColor: colors.surface, borderColor: colors.goldSoft, borderWidth: 1 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  when: { ...type.tag, flex: 1, fontWeight: "500", color: colors.brand },
  title: { ...type.cardTitle, color: colors.ink, minHeight: 40 },
  sub: { ...type.meta, color: colors.muted },
  reason: { ...type.tag, color: colors.gold, fontWeight: "500", marginTop: 2 },
});
