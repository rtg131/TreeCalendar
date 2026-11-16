import { useMutation, useQuery } from "convex/react";
import { Redirect, router, type ErrorBoundaryProps } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EventThumb, HostLine } from "@/components/event-media";
import { EventTypeBadge } from "@/components/event-type-icon";
import EventMap from "@/components/map/event-map";
import { mapEvents, markerGroups, selectedEvent } from "@/components/map/model";
import { EVENT_TYPE_META, palettes, radius, type, type Palette } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import { DEFAULT_RADIUS_KM, RADIUS_OPTIONS, radiusLabel, useDeviceId } from "@/lib/device";
import { formatDistance, formatRange } from "@/lib/format";
import { AREAS, cityPlace, locateDevice, type Place } from "@/lib/profile";

type Filter = "all" | "investors" | "week" | "hackathons" | "pitch" | "networking";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "For you" }, { id: "investors", label: "Investors likely" },
  { id: "week", label: "This week" }, { id: "hackathons", label: "Hackathons" },
  { id: "pitch", label: "Pitch" }, { id: "networking", label: "Networking" },
];

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return <SafeAreaView style={{ flex: 1, padding: 24, backgroundColor: palettes.light.bg, justifyContent: "center", gap: 16 }}>
    <Text style={{ ...type.screenTitle, color: palettes.light.ink }}>Couldn’t load the map</Text>
    <Text style={{ color: palettes.light.muted }}>Check your connection and try again. Your feed is still available.</Text>
    <Pressable accessibilityRole="button" onPress={retry} style={{ padding: 12 }}><Text>Try again</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => router.navigate("/feed")} style={{ padding: 12 }}><Text>Go to feed</Text></Pressable>
  </SafeAreaView>;
}

export default function MapDiscovery() {
  const dark = useColorScheme() === "dark";
  const palette = dark ? palettes.dark : palettes.light;
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const deviceId = useDeviceId();
  const profile = useQuery(api.users.get, deviceId ? { deviceId } : "skip");
  const radiusKm = profile?.radiusKm ?? DEFAULT_RADIUS_KM;
  const [filter, setFilter] = useState<Filter>("all");
  const feed = useQuery(api.feed.ranked, deviceId ? { deviceId, filter, radiusKm } : "skip");
  const saves = useQuery(api.saves.list, deviceId ? { deviceId } : "skip");
  const upsert = useMutation(api.users.upsert);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recenter, setRecenter] = useState(0);
  const [showAreas, setShowAreas] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mapped = useMemo(() => mapEvents(feed?.events ?? []), [feed]);
  const savedIds = useMemo(() => new Set((saves ?? []).map((event) => String(event._id))), [saves]);
  const markers = useMemo(() => {
    const types = new Map(mapped.events.map((event) => [String(event._id), event.eventType]));
    return markerGroups(mapped.events, savedIds).map((group) => ({ ...group, eventTypes: group.ids.map((id) => types.get(id)!) }));
  }, [mapped, savedIds]);
  const selected = selectedEvent(mapped.events, selectedId);
  const center = profile ? { lat: profile.lat, lng: profile.lng } : AREAS[0];

  async function changeArea(place?: Place, km = radiusKm) {
    if (!profile || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const { _id, _creationTime, updatedAt, name, email, phone, affiliation, linkedin, ...fields } = profile;
      await upsert({ ...fields, ...place, radiusKm: km });
      setRecenter((value) => value + 1);
      setShowAreas(false);
    } catch {
      setNotice("Couldn’t update your search area. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function locateCurrentArea() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      locateDevice(),
      new Promise<{ error: string }>((resolve) => {
        timer = setTimeout(() => resolve({ error: "Location is taking too long. Pick a city instead." }), 15000);
      }),
    ]);
    clearTimeout(timer);
    if ("error" in result) {
      setNotice(result.error);
      setShowAreas(true);
      setBusy(false);
      return;
    }
    try {
      if (profile) {
        const { _id, _creationTime, updatedAt, name, email, phone, affiliation, linkedin, ...fields } = profile;
        await upsert({ ...fields, ...result.place, radiusKm });
        setRecenter((value) => value + 1);
      }
    } catch {
      setNotice("Couldn’t update your search area. Pick a city or try again.");
    } finally {
      setBusy(false);
    }
  }

  if (profile === null || feed === null) return <Redirect href="/onboarding" />;

  return <SafeAreaView edges={["top"]} style={styles.safe}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
    <View style={styles.header}>
      <View><Text style={styles.eyebrow}>FIND YOUR NEXT ROOM</Text><Text style={styles.title}>Explore the map</Text></View>
      <Pressable accessibilityRole="button" testID="map-feed" onPress={() => router.navigate("/feed")} style={styles.button}><Text style={styles.action}>List ↗</Text></Pressable>
    </View>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAreas }} testID="map-area" onPress={() => setShowAreas(!showAreas)} style={styles.area}>
        <Text numberOfLines={1} style={styles.label}>◎ {profile?.city ?? "Bay Area"} · {radiusLabel(radiusKm)} ▾</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Recenter map on selected search area" onPress={() => setRecenter((value) => value + 1)} style={styles.button}><Text style={styles.action}>Recenter</Text></Pressable>
    </View>
    {showAreas && <View style={styles.areas}>
      <Text style={styles.meta}>Search area · also updates your feed</Text>
      <ScrollView horizontal contentContainerStyle={styles.chips} showsHorizontalScrollIndicator={false}>
        {AREAS.map((area) => <Pressable key={area.name} disabled={busy} accessibilityRole="button" onPress={() => void changeArea(cityPlace(area.name)!)} style={styles.chip}><Text style={styles.label}>{area.name}</Text></Pressable>)}
      </ScrollView>
      <Pressable disabled={busy} accessibilityRole="button" testID="map-use-location" onPress={() => void locateCurrentArea()} style={styles.button}><Text style={styles.action}>{busy ? "Updating area…" : "Use my current location"}</Text></Pressable>
    </View>}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.chips}>
      {FILTERS.map((item) => <Pressable key={item.id} testID={`map-filter-${item.id}`} accessibilityRole="button" accessibilityState={{ selected: filter === item.id }} onPress={() => setFilter(item.id)} style={[styles.chip, filter === item.id && styles.activeChip]}><Text style={[styles.label, filter === item.id && styles.action]}>{item.label}</Text></Pressable>)}
    </ScrollView>
    <View style={styles.row}>
      <Text style={styles.meta}>Within</Text>
      {RADIUS_OPTIONS.map((option) => <Pressable key={option.km} disabled={busy} accessibilityRole="button" accessibilityState={{ selected: radiusKm === option.km }} onPress={() => void changeArea(undefined, option.km)} style={[styles.smallChip, radiusKm === option.km && styles.activeChip]}><Text style={styles.label}>{option.label}</Text></Pressable>)}
    </View>
    {notice && <Text accessibilityRole="alert" testID="map-notice" style={styles.notice}>{notice}</Text>}
    <View style={styles.map}>
      {feed === undefined || !profile ? <View style={styles.center}><ActivityIndicator color={palette.brand} /><Text style={styles.meta}>Loading event locations…</Text></View> :
        <EventMap center={center} radiusKm={radiusKm} recenter={recenter} markers={markers} selectedId={selected?._id} onSelect={setSelectedId} palette={palette} dark={dark} />}
    </View>
    <View style={styles.footer}>
      <Text testID="map-count" style={styles.label}>{mapped.events.length} located events · a gold dot marks saved events</Text>
      <Text style={styles.meta}>Top 60 feed results, ranked by your interests. Moving the map doesn’t search a new area.</Text>
      {(mapped.online > 0 || mapped.unlocated > 0) && <Text testID="map-excluded" style={styles.meta}>{mapped.online} online · {mapped.unlocated} without coordinates — available in List.</Text>}
      {selected ? <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} testID="map-event-selector">
          {mapped.events.map((event, index) => <Pressable key={event._id} accessibilityRole="button" accessibilityLabel={`Select ${event.title}`} accessibilityState={{ selected: event._id === selected._id }} onPress={() => setSelectedId(event._id)} style={[styles.smallChip, event._id === selected._id && styles.activeChip]}><Text style={styles.label}>{index + 1}{savedIds.has(event._id) ? " ★" : ""}</Text></Pressable>)}
        </ScrollView>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${selected.title}`} testID="map-event-card" onPress={() => router.push({ pathname: "/event/[id]", params: { id: selected._id } })} style={styles.card}>
          <View style={styles.cardTop}><View style={styles.kind}><EventTypeBadge eventType={selected.eventType} size={22} /><Text style={styles.eventType}>{EVENT_TYPE_META[selected.eventType].label.toUpperCase()}</Text></View><Text style={styles.action}>{savedIds.has(selected._id) ? "Saved ★" : "View event ↗"}</Text></View>
          <View style={styles.cardBody}>
            <EventThumb testID="map-event-thumb" event={selected} size={64} />
            <View style={styles.cardText}>
              <Text numberOfLines={2} style={styles.cardTitle}>{selected.title}</Text>
              <HostLine event={selected} size={16} palette={palette} />
              <Text style={styles.meta}>{formatRange(selected.startTime, selected.endTime)}</Text>
              <Text numberOfLines={1} style={styles.meta}>{selected.venue ?? selected.city} · {formatDistance(selected.distanceKm, false)}</Text>
            </View>
          </View>
          <Text style={selected.investorScore >= 70 ? styles.signal : styles.meta}>{selected.investorScore >= 70 ? "↗ Investors likely" : "Investor signal"} · {selected.investorScore}/100 · estimate, not attendance</Text>
        </Pressable>
        {Platform.OS === "android" && <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`https://www.openstreetmap.org/?mlat=${selected.lat}&mlon=${selected.lng}#map=16/${selected.lat}/${selected.lng}`)} style={styles.button}><Text style={styles.action}>Open selected event on map ↗</Text></Pressable>}
      </> : feed !== undefined && <View testID="map-empty" style={styles.empty}><Text style={styles.cardTitle}>{feed.events.length ? "No map locations in these results" : "No events in this search"}</Text><Text style={styles.meta}>Try another filter, widen the radius, or use List for online and unlocated events.</Text></View>}
    </View>
    </ScrollView>
  </SafeAreaView>;
}

const makeStyles = (p: Palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: p.bg },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { color: p.brandInk, fontSize: 10, fontWeight: "600", letterSpacing: 1.6, marginBottom: 4 },
  title: { ...type.screenTitle, color: p.ink },
  row: { paddingHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 10 },
  area: { flex: 1, paddingVertical: 10 },
  label: { ...type.label, color: p.ink },
  meta: { ...type.tag, color: p.muted },
  action: { ...type.label, color: p.brandInk },
  button: { padding: 10, minHeight: 44, justifyContent: "center" },
  areas: { paddingHorizontal: 20, gap: 4, paddingBottom: 8 },
  chips: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  filterScroll: { flexGrow: 0, paddingLeft: 20, marginBottom: 10 },
  chip: { borderRadius: radius.pill, paddingHorizontal: 12, minHeight: 38, justifyContent: "center", borderColor: p.lineStrong, borderWidth: 1, backgroundColor: p.surface },
  smallChip: { borderRadius: radius.pill, paddingHorizontal: 12, minHeight: 36, justifyContent: "center", borderColor: p.lineStrong, borderWidth: 1 },
  activeChip: { backgroundColor: p.brandSoft, borderColor: p.brand },
  notice: { ...type.meta, color: p.danger, paddingHorizontal: 20, paddingBottom: 8 },
  map: { flex: 1, minHeight: 180, overflow: "hidden", backgroundColor: p.secondary },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: 5 },
  card: { backgroundColor: p.surface, borderRadius: radius.card, padding: 14, gap: 6, borderWidth: 1, borderColor: p.lineStrong },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  cardTitle: { ...type.cardTitle, color: p.ink },
  cardBody: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  cardText: { flex: 1, minWidth: 0, gap: 4 },
  kind: { flexDirection: "row", alignItems: "center", gap: 8 },
  eventType: { fontSize: 10, fontWeight: "600", color: p.muted, letterSpacing: 1 },
  signal: { ...type.tag, color: p.gold },
  empty: { paddingVertical: 12, gap: 6 },
});
