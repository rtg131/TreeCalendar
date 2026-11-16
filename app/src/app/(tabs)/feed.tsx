import { useConvex, useQuery } from "convex/react";
import { Redirect, router, type ErrorBoundaryProps } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Chip } from "@/components/chip";
import { AttendancePrompt } from "@/components/attendance";
import { EventCard } from "@/components/event-card";
import { EmptyState } from "@/components/feed/empty-state";
import { Segmented } from "@/components/segmented";
import { SkeletonCards } from "@/components/feed/skeleton";
import { AddEventButton } from "@/components/links/add-event-button";
import { AlertIcon, PinIcon, SearchIcon, SignalIcon } from "@/components/icons";
import { colors, layout, radius, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import { RADIUS_OPTIONS, radiusLabel, useDeviceId, useSearchRadius } from "@/lib/device";
import { groupBySection } from "@/lib/format";

type Filter = "all" | "investors" | "week" | "hackathons" | "pitch" | "networking";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "investors", label: "Investors likely" },
  { id: "week", label: "This week" },
  { id: "hackathons", label: "Hackathons" },
  { id: "pitch", label: "Pitch" },
  { id: "networking", label: "Networking" },
];

const RADII = RADIUS_OPTIONS.map((o) => ({ value: o.km, label: o.label, testID: `radius-${o.km}` }));
const WIDEST_KM = Math.max(...RADIUS_OPTIONS.map((o) => o.km));

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={[styles.apphead, styles.pad]}>
        <Text style={styles.h1}>For you</Text>
      </View>
      <EmptyState
        testID="feed-error"
        tone="danger"
        icon={<AlertIcon color={colors.danger} />}
        title="Couldn't load events"
        body={error.message.includes("network") || error.message.includes("fetch") ? "No connection. Check your network and try again" : "Something went wrong on our side. Try again in a moment"}
        action={{ label: "Try again", onPress: retry, testID: "feed-retry" }}
      />
    </SafeAreaView>
  );
}

export default function Feed() {
  const deviceId = useDeviceId();
  const convex = useConvex();
  const [filter, setFilter] = useState<Filter>("all");
  const { radiusKm, setRadiusKm } = useSearchRadius();
  const [refreshing, setRefreshing] = useState(false);
  const [slow, setSlow] = useState(false);
  const args = deviceId ? { deviceId, filter, radiusKm } : "skip";
  const feed = useQuery(api.feed.ranked, args);

  useEffect(() => {
    if (feed !== undefined) return;
    const t = setTimeout(() => setSlow(true), 8000);
    return () => {
      clearTimeout(t);
      setSlow(false);
    };
  }, [feed]);

  const events = useMemo(() => feed?.events ?? [], [feed]);
  const sections = useMemo(() => groupBySection(events), [events]);

  if (feed === null) return <Redirect href="/onboarding" />;

  const onRefresh = async () => {
    if (!deviceId) return;
    setRefreshing(true);
    try {
      await convex.query(api.feed.ranked, { deviceId, filter, radiusKm });
    } finally {
      setRefreshing(false);
    }
  };

  const radius = radiusLabel(radiusKm);

  const header = (
    <View>
      <View style={styles.apphead}>
        <Text style={styles.h1}>For you</Text>
        <Pressable
          testID="location-pill"
          accessibilityRole="button"
          accessibilityLabel={`Location ${feed?.city ?? ""}, ${radius}. Change`}
          onPress={() => router.push("/profile")}
          style={styles.locbtn}
        >
          <PinIcon size={14} color={colors.brand} />
          <Text style={styles.locText} numberOfLines={1}>
            {feed?.city ?? "Nearby"} · {radius}
          </Text>
        </Pressable>
        <AddEventButton />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {FILTERS.map((f) => (
          <Chip
            key={f.id}
            size="filter"
            testID={`filter-${f.id}`}
            label={f.label}
            selected={filter === f.id}
            onPress={() => setFilter(f.id)}
            icon={f.id === "investors" ? <SignalIcon size={13} color={filter === f.id ? colors.brandInk : colors.gold} /> : undefined}
          />
        ))}
      </ScrollView>
      <View style={styles.radiusRow}>
        <Text style={styles.radiusLabel}>Within</Text>
        <View style={{ flex: 1 }}>
          <Segmented accessibilityLabel="Distance" options={RADII} value={radiusKm} onChange={setRadiusKm} />
        </View>
      </View>
      {feed && events.length ? (
        <Text testID="feed-meta" style={styles.meta}>
          {events.length} events · ranked by interest, date, and distance
        </Text>
      ) : null}
      <AttendancePrompt />
    </View>
  );

  const empty =
    feed === undefined ? (
      <View>
        <SkeletonCards />
        {slow ? <Text style={styles.slow}>Still connecting. Check your connection</Text> : null}
      </View>
    ) : filter !== "all" ? (
      <EmptyState
        testID="feed-empty-filter"
        icon={<SearchIcon color={colors.brand} />}
        title="Nothing matches this filter"
        body="Try another filter or clear it to see everything"
        action={{ label: "Clear filter", onPress: () => setFilter("all"), testID: "clear-filter" }}
      />
    ) : (
      <EmptyState
        testID="feed-empty"
        icon={<SearchIcon color={colors.brand} />}
        title="No events near you yet"
        body="We check new listings every hour. Try a wider area or add interests"
        action={
          radiusKm < WIDEST_KM
            ? { label: "Search the whole Bay Area", onPress: () => setRadiusKm(WIDEST_KM), testID: "widen" }
            : { label: "Add interests", onPress: () => router.push("/profile"), testID: "add-interests" }
        }
      />
    );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <SectionList
        testID="feed-list"
        sections={sections}
        keyExtractor={(e) => e._id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: layout.cardGap }} />}
        renderSectionHeader={({ section }) => (
          <Text testID={`section-${section.title}`} accessibilityRole="header" style={styles.sectionHead}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => <EventCard event={item} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} colors={[colors.brand]} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: layout.screenPadding, paddingBottom: 40 },
  apphead: { flexDirection: "row", alignItems: "center", gap: 8, height: 52 },
  pad: { paddingHorizontal: layout.screenPadding },
  h1: { ...type.screenTitle, color: colors.ink, flex: 1 },
  locbtn: { flexDirection: "row", alignItems: "center", gap: 4, height: 32, maxWidth: 200, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.secondary },
  locText: { fontSize: 13, fontWeight: "500", color: colors.ink },
  filters: { gap: 8, paddingTop: 8, paddingBottom: 12, paddingRight: layout.screenPadding },
  radiusRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 12 },
  radiusLabel: { ...type.meta, fontWeight: "500", color: colors.muted },
  meta: { fontSize: 12, color: colors.subtle, paddingBottom: 4 },
  sectionHead: { fontSize: 13, fontWeight: "600", color: colors.muted, paddingTop: 14, paddingBottom: 8 },
  slow: { ...type.meta, color: colors.muted, textAlign: "center", marginTop: 16 },
});
