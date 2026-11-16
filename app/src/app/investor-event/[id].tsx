import { useMutation, useQuery } from "convex/react";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { AttendanceAggregate, GoingButton } from "@/components/attendance";
import { investorTier } from "@/components/investor-badge";
import { SignalPanel } from "@/components/investor/signal-panel";
import { colors, EVENT_TYPE_META, layout, radius, shadow, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { scout } from "@/convex/lib/scouting";
import { useDeviceId } from "@/lib/device";
import { formatRange, SOURCE_LABEL } from "@/lib/format";

const turnoutLabel = (d: number) => (d >= 0.8 ? "Mostly students" : d >= 0.5 ? "Strong student turnout" : "Some students");

export default function InvestorEventDetail() {
  const { id } = useLocalSearchParams<{ id: Id<"events"> }>();
  const deviceId = useDeviceId();
  const event = useQuery(api.events.get, { id });
  const saved = useQuery(api.saves.isSaved, deviceId ? { deviceId, eventId: id } : "skip");
  const toggle = useMutation(api.saves.toggle);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  if (event === undefined) return <ActivityIndicator style={{ flex: 1, backgroundColor: colors.bg }} color={colors.brand} />;
  if (event === null) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.missing}>This event is no longer listed</Text>
      </SafeAreaView>
    );
  }

  const s = scout(event, now);
  const high = investorTier(event.investorScore) === "high";
  const source = SOURCE_LABEL[event.source] ?? event.source;
  const turnout = Math.round(s.studentDensity * 100);

  const onSave = async () => {
    if (!deviceId) return;
    setSaving(true);
    setError(null);
    try {
      await toggle({ deviceId, eventId: id });
    } catch {
      setError("Couldn't save: no connection. Try again");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <View style={styles.bar}>
        <Pressable
          testID="back"
          accessibilityRole="button"
          accessibilityLabel="Back to scouting"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/investor"))}
          style={styles.back}
        >
          <Icon name="chevron-left" size={22} />
        </Pressable>
        <Text style={styles.kind}>{EVENT_TYPE_META[event.eventType].label}</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={[styles.hero, high && styles.heroGold]}>
          <Icon name="trending-up" size={36} color={high ? colors.gold : colors.brand} />
          <Text style={styles.src}>via {source}</Text>
        </View>
        <Text testID="event-title" style={styles.title}>
          {event.title}
        </Text>
        <Text style={styles.org}>{[event.organizer, s.school].filter(Boolean).join(" · ")}</Text>

        <View style={styles.facts}>
          <View style={styles.fact}>
            <Icon name="calendar" size={18} color={colors.subtle} />
            <Text style={styles.factMain}>{formatRange(event.startTime, event.endTime)}</Text>
          </View>
          <View style={[styles.fact, styles.factBorder]}>
            <Icon name="map-pin" size={18} color={colors.subtle} />
            <View style={{ flex: 1 }}>
              <Text style={styles.factMain}>{event.isOnline ? "Online" : event.venue ?? event.city}</Text>
              {!event.isOnline && event.venue ? <Text style={styles.factSub}>{event.city}</Text> : null}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <SignalPanel score={event.investorScore} reasons={event.investorSignals} />
          <AttendanceAggregate eventId={event._id} />
          <GoingButton event={event} />
        </View>

        <View testID="student-turnout" style={[styles.section, styles.turnout]}>
          <View style={styles.turnoutHead}>
            <View style={styles.turnoutLabel}>
              <Icon name="graduation-cap" size={16} color={colors.brand} />
              <Text style={styles.h2}>{turnoutLabel(s.studentDensity)}</Text>
            </View>
            <Text style={styles.turnoutNum}>{turnout}</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${turnout}%` }]} />
          </View>
          <Text style={styles.factSub}>
            {s.school ? `Campus event at ${s.school}. ` : ""}Estimated from the audience, venue, and wording of the listing
          </Text>
        </View>

        {event.hosts.length ? (
          <View style={styles.section}>
            <Text style={styles.h2}>Hosts</Text>
            <Text style={styles.p}>{event.hosts.join(", ")}</Text>
          </View>
        ) : null}

        {event.description ? (
          <View style={styles.section}>
            <Text style={styles.h2}>About</Text>
            <Text style={styles.p}>{event.description}</Text>
          </View>
        ) : null}
      </ScrollView>
      <SafeAreaView edges={["bottom"]} style={styles.action}>
        {error ? <Text style={styles.err}>{error}</Text> : null}
        <View style={styles.btns}>
          <Pressable testID="save" accessibilityRole="button" disabled={saving} onPress={onSave} style={[styles.btn, saved ? styles.saved : styles.primary]}>
            {saving ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <>
                <Icon name={saved ? "bookmark-filled" : "bookmark"} size={18} color={saved ? colors.brandInk : colors.white} />
                <Text style={[styles.btnText, { color: saved ? colors.brandInk : colors.white }]}>{saved ? "Saved" : "Save"}</Text>
              </>
            )}
          </Pressable>
          <Pressable testID="open-link" accessibilityRole="button" onPress={() => WebBrowser.openBrowserAsync(event.url)} style={[styles.btn, styles.outline]}>
            <Icon name="external-link" size={18} />
            <Text style={styles.btnText}>{source === "Luma" || source === "Devpost" ? `Open on ${source}` : "Open listing"}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  missing: { ...type.body, padding: 24, color: colors.ink },
  bar: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8 },
  back: { width: layout.tapTarget, height: layout.tapTarget, alignItems: "center", justifyContent: "center" },
  kind: { ...type.tag, marginRight: 12, height: 22, lineHeight: 22, paddingHorizontal: 8, borderRadius: radius.tag, overflow: "hidden", backgroundColor: colors.secondary, color: colors.muted },
  hero: { marginHorizontal: layout.screenPadding, height: 120, borderRadius: radius.lg, backgroundColor: colors.brandSoft, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", padding: 14 },
  heroGold: { backgroundColor: colors.goldSoft },
  src: { ...type.tag, fontWeight: "500", color: colors.muted, backgroundColor: colors.surface, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.tag, overflow: "hidden" },
  title: { ...type.detailTitle, color: colors.ink, marginTop: 16, marginHorizontal: layout.screenPadding, marginBottom: 4 },
  org: { ...type.meta, fontSize: 14, color: colors.muted, marginHorizontal: layout.screenPadding, marginBottom: 16 },
  facts: { ...shadow.card, marginHorizontal: layout.screenPadding, borderRadius: radius.card, backgroundColor: colors.surface },
  fact: { flexDirection: "row", gap: 12, paddingVertical: 12, paddingHorizontal: 14, alignItems: "flex-start" },
  factBorder: { borderTopWidth: 0.5, borderTopColor: colors.line },
  factMain: { ...type.meta, fontSize: 14, color: colors.ink, flex: 1 },
  factSub: { ...type.meta, color: colors.muted, marginTop: 2 },
  section: { marginTop: 16, marginHorizontal: layout.screenPadding },
  turnout: { ...shadow.card, padding: 14, gap: 6, borderRadius: radius.card, backgroundColor: colors.surface },
  turnoutHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  turnoutLabel: { flexDirection: "row", alignItems: "center", gap: 6 },
  turnoutNum: { ...type.numeric, fontSize: 14, fontWeight: "600", color: colors.ink },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.secondary, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.brand },
  h2: { ...type.label, fontSize: 14, fontWeight: "600", color: colors.ink, marginBottom: 2 },
  p: { ...type.meta, fontSize: 14, lineHeight: 21, color: colors.muted },
  action: { paddingHorizontal: layout.screenPadding, paddingTop: 12, paddingBottom: 8, gap: 6, borderTopWidth: 0.5, borderTopColor: colors.line, backgroundColor: colors.surface },
  btns: { flexDirection: "row", gap: 8 },
  btn: { flex: 1, height: layout.buttonHeight, borderRadius: radius.button, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  primary: { backgroundColor: colors.brand },
  saved: { backgroundColor: colors.brandSoft, borderWidth: 1, borderColor: colors.brand },
  outline: { backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.lineStrong },
  btnText: { ...type.bodyStrong, color: colors.ink },
  err: { ...type.meta, color: colors.danger },
});
