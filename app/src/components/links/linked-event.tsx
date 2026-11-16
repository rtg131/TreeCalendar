import { useQuery } from "convex/react";
import { StyleSheet, Text, View } from "react-native";

import { EventCard } from "@/components/event-card";
import { colors, layout, radius, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function LinkedEvent({ id }: { id: Id<"events"> }) {
  const event = useQuery(api.events.get, { id });
  if (event === undefined) return <View style={styles.placeholder} />;
  if (event === null) return <Text style={styles.gone}>This event is no longer listed</Text>;
  return <EventCard event={event} />;
}

const styles = StyleSheet.create({
  placeholder: { height: 84, borderRadius: radius.card, backgroundColor: colors.secondary },
  gone: { ...type.meta, color: colors.muted, paddingVertical: layout.cardPadding / 2 },
});
