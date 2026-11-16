import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { createEventInCalendarAsync } from "expo-calendar";
import { router, useLocalSearchParams, type ErrorBoundaryProps } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EventHero, HostLine, OrgAvatar, type HostCompany } from "@/components/event-media";
import { EventTypeIcon } from "@/components/event-type-icon";
import { EmptyState } from "@/components/feed/empty-state";
import { EventPrep } from "@/components/event-prep";
import { AttendanceAggregate, GoingButton } from "@/components/attendance";
import { EventConnections } from "@/components/connections/event-connections";
import { Toast, useToast } from "@/components/feed/toast";
import { FriendsGoing } from "@/components/friends-going";
import { AlertIcon, BackIcon, BookmarkIcon, CalendarIcon, CheckIcon, LinkIcon, PeopleIcon, PinIcon, ShareIcon, SparkIcon } from "@/components/icons";
import { colors, EVENT_TYPE_META, INVESTOR_SOME_MIN, layout, radius, shadow, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { INTERESTS } from "@/convex/lib/interests";
import { INVESTORS_LIKELY_MIN } from "@/convex/lib/ranking";
import { convex } from "@/lib/convex";
import { useDeviceId } from "@/lib/device";
import { DEFAULT_DURATION, formatRange, longWhen, SOURCE_LABEL } from "@/lib/format";

const LISTING_SOURCES = new Set(["luma", "devpost", "eventbrite", "meetup"]);

const eventHost = makeFunctionReference<"query", { eventId: Id<"events"> }, HostCompany | null>("events:host");

function useHostCompany(eventId: Id<"events">) {
  const [host, setHost] = useState<HostCompany | undefined>();
  useEffect(() => {
    let live = true;
    convex.query(eventHost, { eventId }).then((h) => live && setHost(h ?? undefined), () => undefined);
    return () => {
      live = false;
    };
  }, [eventId]);
  return host;
}

const back = () => (router.canGoBack() ? router.back() : router.replace("/feed"));

function mapsUrl(event: Doc<"events">) {
  const q = encodeURIComponent([event.venue, event.address ?? event.city].filter(Boolean).join(", "));
  const ll = event.lat !== undefined && event.lng !== undefined ? `${event.lat},${event.lng}` : undefined;
  if (Platform.OS === "ios") return `https://maps.apple.com/?q=${q}${ll ? `&ll=${ll}` : ""}`;
  if (Platform.OS === "android") return ll ? `geo:${ll}?q=${ll}(${q})` : `geo:0,0?q=${q}`;
  return `https://www.google.com/maps/search/?api=1&query=${ll ?? q}`;
}

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.dhead}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back} style={styles.iconBtn}>
          <BackIcon color={colors.ink} />
        </Pressable>
      </View>
      <EmptyState
        tone="danger"
        icon={<AlertIcon color={colors.danger} />}
        title="Couldn't load this event"
        body="Check your connection and try again"
        action={{ label: "Try again", onPress: retry }}
      />
    </SafeAreaView>
  );
}

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: Id<"events"> }>();
  const deviceId = useDeviceId();
  const event = useQuery(api.events.get, { id });
  const saved = useQuery(api.saves.isSaved, deviceId ? { deviceId, eventId: id } : "skip");
  const toggle = useMutation(api.saves.toggle);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast, show, hide } = useToast();
  const hostCompany = useHostCompany(id);

  if (event === undefined) return <ActivityIndicator style={{ flex: 1, backgroundColor: colors.bg }} color={colors.brand} />;
  if (event === null) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.dhead}>
          <Pressable testID="back" accessibilityRole="button" accessibilityLabel="Back" onPress={back} style={styles.iconBtn}>
            <BackIcon color={colors.ink} />
          </Pressable>
        </View>
        <EmptyState icon={<SparkIcon size={22} color={colors.brand} />} title="This event is no longer listed" body="The organizer may have removed or moved it" action={{ label: "Back to events", onPress: back }} />
      </SafeAreaView>
    );
  }

  const meta = EVENT_TYPE_META[event.eventType];
  const source = SOURCE_LABEL[event.source] ?? event.source;
  const tier = event.investorScore >= INVESTORS_LIKELY_MIN ? "high" : event.investorScore >= INVESTOR_SOME_MIN ? "mid" : "low";
  const [day, time] = longWhen(event.startTime, event.endTime);
  const tags = [
    ...event.tags.map((t) => INTERESTS.find((i) => i.id === t)?.label).filter((l) => l !== undefined),
    ...(event.audience.includes("students") ? ["Student-led"] : []),
  ];
  const place = event.isOnline ? "Online" : event.venue ?? event.address ?? event.city;
  const placeSub = event.isOnline ? "Link shared by the host" : [event.venue ? event.address ?? event.city : undefined, "Open in Maps"].filter(Boolean).join(" · ");
  const hosts = event.hosts.filter((h) => h !== event.organizer);

  const onSave = async () => {
    if (!deviceId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const nowSaved = await toggle({ deviceId, eventId: event._id });
      show(nowSaved ? { title: "Saved", body: "Find it in Saved" } : { title: "Removed from saved" });
    } catch {
      setError(saved ? "Couldn't remove it: no connection. It's still saved. Try again" : "Couldn't save: no connection. Try again");
    } finally {
      setSaving(false);
    }
  };

  const onCalendar = async () => {
    try {
      const result = await createEventInCalendarAsync({
        title: event.title,
        startDate: new Date(event.startTime),
        endDate: new Date(event.endTime ?? event.startTime + DEFAULT_DURATION),
        timeZone: event.timezone,
        location: event.isOnline ? event.url : [event.venue, event.address ?? event.city].filter(Boolean).join(", "),
        url: event.url,
        notes: `${event.description.slice(0, 800)}\n\n${event.url}`,
      });
      if (result.action === "saved") show({ title: "Added to calendar" });
    } catch {
      setError("Couldn't open your calendar on this device");
    }
  };

  const onShare = () =>
    Share.share({ title: event.title, message: `${event.title}\n${formatRange(event.startTime, event.endTime)}\n${event.url}`, url: event.url }).catch(() => undefined);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.dhead}>
        <Pressable testID="back" accessibilityRole="button" accessibilityLabel="Back" onPress={back} style={styles.iconBtn}>
          <BackIcon color={colors.ink} />
        </Pressable>
        <View style={styles.kind}>
          <EventTypeIcon eventType={event.eventType} size={14} />
          <Text style={styles.kindText}>{meta.label}</Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={styles.hero}>
          <EventHero event={event}>
            <View style={styles.heroBadge}>
              <EventTypeIcon eventType={event.eventType} size={22} />
            </View>
            <View style={styles.src}>
              <Text style={styles.srcText}>via {source}</Text>
            </View>
          </EventHero>
        </View>

        <Text testID="event-title" style={styles.title}>
          {event.title}
        </Text>
        <HostLine event={{ ...event, hostCompany }} size={24} textStyle={styles.org} style={styles.orgRow} />
        {event.organizer || hostCompany ? null : <View style={{ height: 12 }} />}

        <View style={styles.facts}>
          <View style={styles.fact}>
            <CalendarIcon color={colors.subtle} />
            <View style={{ flex: 1 }}>
              <Text testID="event-date" style={styles.factMain}>
                {day}
              </Text>
              <Text style={styles.factSub}>{time}</Text>
            </View>
          </View>
          <Pressable
            testID="open-maps"
            accessibilityRole={event.isOnline ? "text" : "link"}
            accessibilityLabel={event.isOnline ? "Online event" : `${place}. Open in Maps`}
            disabled={event.isOnline}
            onPress={() => Linking.openURL(mapsUrl(event)).catch(() => setError("Couldn't open Maps"))}
            style={({ pressed }) => [styles.fact, styles.factBorder, pressed && { backgroundColor: colors.secondary }]}
          >
            <PinIcon color={colors.subtle} />
            <View style={{ flex: 1 }}>
              <Text style={styles.factMain}>{place}</Text>
              <Text style={[styles.factSub, !event.isOnline && { color: colors.brandInk }]}>{placeSub}</Text>
            </View>
          </Pressable>
          {hostCompany && hostCompany.name !== event.organizer ? (
            <View testID="host-company" style={[styles.fact, styles.factBorder]}>
              <OrgAvatar uri={hostCompany.logo} name={hostCompany.name} size={20} />
              <View style={{ flex: 1 }}>
                <Text style={styles.factMain}>Hosted by {hostCompany.name}</Text>
                <Text style={styles.factSub}>Verified company</Text>
              </View>
            </View>
          ) : null}
          {hosts.length ? (
            <View style={[styles.fact, styles.factBorder]}>
              <PeopleIcon color={colors.subtle} />
              <View style={{ flex: 1 }}>
                <Text style={styles.factMain}>Hosted by {hosts.slice(0, 3).join(", ")}</Text>
                {hosts.length > 3 ? <Text style={styles.factSub}>and {hosts.length - 3} more</Text> : null}
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Pressable testID="add-to-calendar" accessibilityRole="button" onPress={onCalendar} style={({ pressed }) => [styles.btn, styles.outline, styles.half, pressed && styles.pressed]}>
            <CalendarIcon color={colors.ink} />
            <Text style={styles.btnText}>Add to calendar</Text>
          </Pressable>
          <Pressable testID="share-event" accessibilityRole="button" onPress={onShare} style={({ pressed }) => [styles.btn, styles.outline, styles.half, pressed && styles.pressed]}>
            <ShareIcon color={colors.ink} />
            <Text style={styles.btnText}>Share</Text>
          </Pressable>
        </View>

        <EventPrep key={event._id} event={event} deviceId={deviceId} />

        <View style={{ marginHorizontal: layout.screenPadding, marginTop: 12 }}><GoingButton event={event} /></View>
        <FriendsGoing eventId={event._id} />
        <EventConnections event={event} />
        <View testID="investor-signal" accessibilityLabel="Investor signal" style={[styles.signal, tier === "low" && styles.signalLow]}>
          <View style={styles.signalHead}>
            <Text style={styles.signalTitle}>{tier === "high" ? "Investors likely" : tier === "mid" ? "Some investors" : "Few investors expected"}</Text>
            <Text style={styles.score}>
              <Text style={[styles.scoreNum, tier === "low" && { color: colors.muted }]}>{event.investorScore}</Text>
              <Text style={styles.scoreOf}>/100</Text>
            </Text>
          </View>
          {event.investorSignals.length ? (
            event.investorSignals.map((s) => (
              <View key={s} style={styles.reason}>
                <CheckIcon color={tier === "low" ? colors.muted : colors.gold} />
                <Text style={styles.reasonText}>{s}</Text>
              </View>
            ))
          ) : (
            <Text style={[styles.reasonText, { color: colors.muted }]}>No investor signals in this listing yet</Text>
          )}
          <Text style={styles.note}>Inferred from the listing: format, judges, sponsors, and host. Not confirmed by the organizer</Text>
          <AttendanceAggregate eventId={event._id} />
        </View>

        {event.description ? (
          <View style={styles.dsec}>
            <Text style={styles.dsecH}>About</Text>
            <Text style={styles.about}>{event.description}</Text>
          </View>
        ) : null}

        {tags.length ? (
          <View style={styles.dsec}>
            <Text style={styles.dsecH}>Tags</Text>
            <View style={styles.tags}>
              {tags.map((t) => (
                <View key={t} style={styles.tag}>
                  <Text style={styles.tagText}>{t}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <SafeAreaView edges={["bottom"]} style={styles.actionbar}>
        {error ? (
          <Text testID="detail-error" accessibilityRole="alert" style={styles.err}>
            {error}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Pressable
            testID="save-event"
            accessibilityRole="button"
            accessibilityLabel={saving ? "Saving" : saved ? "Saved" : "Save"}
            accessibilityState={{ selected: !!saved, busy: saving }}
            disabled={!deviceId || saving}
            onPress={onSave}
            style={({ pressed }) => [styles.btn, styles.half, saved ? styles.savedBtn : styles.primary, pressed && styles.pressed]}
          >
            {saving ? (
              <ActivityIndicator size="small" color={saved ? colors.brandInk : colors.white} />
            ) : (
              <BookmarkIcon color={saved ? colors.brandInk : colors.white} filled={!!saved} />
            )}
            <Text style={[styles.btnText, { color: saved ? colors.brandInk : colors.white }]}>{saving ? "Saving" : saved ? "Saved" : "Save"}</Text>
          </Pressable>
          <Pressable
            testID="open-link"
            accessibilityRole="link"
            onPress={() => WebBrowser.openBrowserAsync(event.url)}
            style={({ pressed }) => [styles.btn, styles.outline, styles.half, pressed && styles.pressed]}
          >
            <LinkIcon color={colors.ink} />
            <Text style={styles.btnText} numberOfLines={1}>
              {LISTING_SOURCES.has(event.source) ? `Open on ${source}` : "Open event page"}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
      <Toast toast={toast} onHide={hide} bottom={96} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  dhead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 52, paddingHorizontal: 8 },
  iconBtn: { width: layout.tapTarget, height: layout.tapTarget, alignItems: "center", justifyContent: "center", borderRadius: radius.button },
  kind: { height: 24, paddingHorizontal: 8, borderRadius: radius.tag, backgroundColor: colors.secondary, flexDirection: "row", alignItems: "center", gap: 6 },
  kindText: { ...type.tag, fontWeight: "500", color: colors.muted },
  heroBadge: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", ...shadow.plate },
  hero: { marginHorizontal: layout.screenPadding },
  src: { backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.tag },
  srcText: { fontSize: 12, fontWeight: "500", color: colors.white },
  title: { ...type.detailTitle, color: colors.ink, marginTop: 16, marginHorizontal: layout.screenPadding, marginBottom: 4 },
  org: { fontSize: 14, color: colors.muted },
  orgRow: { marginHorizontal: layout.screenPadding, marginTop: 2, marginBottom: 16, gap: 8 },
  facts: { marginHorizontal: layout.screenPadding, borderRadius: radius.card, backgroundColor: colors.surface, overflow: "hidden", ...shadow.card },
  fact: { flexDirection: "row", gap: 12, paddingVertical: 12, paddingHorizontal: 14, alignItems: "flex-start" },
  factBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  factMain: { fontSize: 14, color: colors.ink },
  factSub: { fontSize: 13, color: colors.subtle, marginTop: 2, ...type.numeric },
  actions: { flexDirection: "row", gap: 8, marginHorizontal: layout.screenPadding, marginTop: 12 },
  btn: { height: layout.buttonHeight, borderRadius: radius.button, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 12 },
  half: { flex: 1 },
  primary: { backgroundColor: colors.brand },
  savedBtn: { backgroundColor: colors.brandSoft, borderWidth: 1, borderColor: colors.brand },
  outline: { backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.lineStrong },
  pressed: { opacity: 0.75 },
  btnText: { fontSize: 15, fontWeight: "500", color: colors.ink, flexShrink: 1 },
  signal: { marginHorizontal: layout.screenPadding, marginTop: 16, padding: 14, borderRadius: radius.card, backgroundColor: colors.goldSoft, gap: 6 },
  signalLow: { backgroundColor: colors.secondary },
  signalHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 },
  signalTitle: { fontSize: 14, fontWeight: "600", color: colors.ink },
  score: { ...type.numeric },
  scoreNum: { fontSize: 22, fontWeight: "600", color: colors.gold, ...type.numeric },
  scoreOf: { fontSize: 13, color: colors.muted },
  reason: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  reasonText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.ink },
  note: { fontSize: 12, lineHeight: 16, color: colors.subtle, marginTop: 6 },
  dsec: { marginHorizontal: layout.screenPadding, marginTop: 20 },
  dsecH: { fontSize: 14, fontWeight: "600", color: colors.ink, marginBottom: 6 },
  about: { fontSize: 14, lineHeight: 21, color: colors.muted },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tagText: { ...type.tag, color: colors.muted },
  tag: { height: 24, paddingHorizontal: 8, borderRadius: radius.tag, backgroundColor: colors.secondary, justifyContent: "center" },
  actionbar: { paddingTop: 0, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.bg },
  err: { fontSize: 13, color: colors.danger, marginHorizontal: layout.screenPadding, marginTop: 10 },
});
