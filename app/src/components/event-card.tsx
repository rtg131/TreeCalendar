import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { EventThumb, HostLine, type HostCompany } from "@/components/event-media";
import { EventTypeBadge } from "@/components/event-type-icon";
import { InvestorBadge } from "@/components/investor-badge";
import { GoingButton } from "@/components/attendance";
import { colors, EVENT_TYPE_META, layout, radius, shadow, type } from "@/constants/theme";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { INTERESTS } from "@/convex/lib/interests";
import { dateBadge, formatDistance, relativeDay } from "@/lib/format";

export type CardEvent = {
  _id: Id<"events">;
  title: string;
  startTime: number;
  endTime?: number;
  city: string;
  isOnline: boolean;
  eventType: Doc<"events">["eventType"];
  investorScore: number;
  distanceKm?: number | null;
  matched?: string[];
  audience?: Doc<"events">["audience"];
  imageUrl?: string;
  organizer?: string;
  organizerLogoUrl?: string;
  hostCompany?: HostCompany;
};

const interestLabel = (id: string) => INTERESTS.find((i) => i.id === id)?.label ?? id;

type Props = { event: CardEvent; accessory?: ReactNode; dimmed?: boolean };

export function EventCard({ event, accessory, dimmed }: Props) {
  const badge = dateBadge(event.startTime);
  const where = event.distanceKm === undefined && !event.isOnline ? event.city : formatDistance(event.distanceKm ?? null, event.isOnline);
  const matched = (event.matched ?? []).slice(0, 2).map(interestLabel);
  const tags = [...matched];
  if (event.audience?.includes("students")) tags.push("Student-led");
  return (
    <View style={[styles.card, dimmed && styles.dimmed]}>
      <Pressable
        testID={`event-card-${event._id}`}
        accessibilityRole="button"
        accessibilityLabel={event.title}
        onPress={() => router.push({ pathname: "/event/[id]", params: { id: event._id } })}
        style={({ pressed }) => [styles.press, !!accessory && { paddingRight: 44 }, pressed && styles.pressed]}
      >
        <EventThumb testID={`event-thumb-${event._id}`} event={event} size={72}>
          <View style={styles.date}>
            <Text style={styles.month}>{badge.month}</Text>
            <Text style={styles.day}>{badge.day}</Text>
          </View>
        </EventThumb>
        <View style={styles.body}>
          <View style={styles.kind}>
            <EventTypeBadge eventType={event.eventType} size={20} />
            <Text style={styles.kindText}>{EVENT_TYPE_META[event.eventType].label}</Text>
          </View>
          <Text style={styles.title} numberOfLines={2}>
            {event.title}
          </Text>
          <HostLine event={event} size={16} />
          <Text style={styles.sub} numberOfLines={1}>
            {relativeDay(event.startTime, event.endTime)}
            {where ? ` · ${where}` : ""}
          </Text>
          <View style={styles.row}>
            {tags.map((t) => (
              <View key={t} style={styles.tag}>
                <Text style={styles.tagText}>{t}</Text>
              </View>
            ))}
            <InvestorBadge score={event.investorScore} />
          </View>
        </View>
      </Pressable>
      {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
      <GoingButton event={event} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, backgroundColor: colors.surface, overflow: "hidden", ...shadow.card },
  press: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: layout.cardPadding },
  pressed: { backgroundColor: "#F7F7F8" },
  accessory: { position: "absolute", top: 8, right: 8 },
  dimmed: { opacity: 0.6 },
  date: { position: "absolute", left: 4, bottom: 4, flexDirection: "row", alignItems: "baseline", gap: 3, paddingHorizontal: 5, paddingVertical: 1, borderRadius: radius.xs, backgroundColor: colors.surface, ...shadow.plate },
  month: { fontSize: 10, fontWeight: "600", letterSpacing: 0.3, color: colors.brand },
  day: { fontSize: 13, fontWeight: "600", lineHeight: 17, color: colors.ink, ...type.numeric },
  body: { flex: 1, minWidth: 0, gap: 4 },
  kind: { flexDirection: "row", alignItems: "center", gap: 6 },
  kindText: { ...type.tag, fontWeight: "500", color: colors.muted },
  title: { ...type.cardTitle, color: colors.ink, letterSpacing: -0.15 },
  sub: { ...type.meta, ...type.numeric, color: colors.muted },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4 },
  tag: { height: 22, paddingHorizontal: 8, borderRadius: radius.tag, backgroundColor: colors.secondary, justifyContent: "center" },
  tagText: { ...type.tag, color: colors.muted },
});
