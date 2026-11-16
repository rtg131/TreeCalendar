import { useQuery } from "convex/react";
import { StyleSheet, Text, View } from "react-native";

import { PeopleIcon } from "@/components/icons";
import { colors, layout, radius, shadow, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDeviceId } from "@/lib/device";
import { displayName } from "@/lib/friends";

export function FriendsGoing({ eventId }: { eventId: Id<"events"> }) {
  const deviceId = useDeviceId();
  const going = useQuery(api.friends.goingTo, deviceId ? { deviceId, eventId } : "skip");
  if (!going?.length) return null;
  const names = going.map(displayName);
  const shown = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
  return (
    <View testID="friends-going" accessibilityLabel={`Friends going: ${names.join(", ")}`} style={styles.row}>
      <PeopleIcon size={18} color={colors.brand} />
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{going.length === 1 ? "1 friend going" : `${going.length} friends going`}</Text>
        <Text style={styles.names}>{shown}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: layout.screenPadding, marginTop: 12, padding: layout.cardPadding, borderRadius: radius.card, backgroundColor: colors.surface, ...shadow.card },
  label: { ...type.label, color: colors.ink },
  names: { ...type.meta, color: colors.muted },
});
