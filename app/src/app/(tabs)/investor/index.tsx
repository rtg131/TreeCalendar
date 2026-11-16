import { useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { FilterRow, type Option } from "@/components/investor/filter-bar";
import { InvestorCard } from "@/components/investor/investor-card";
import { applyFilters, schoolsIn, weekShortlist, type DateFilter, type Filters, type TypeFilter } from "@/components/investor/scouting";
import { WeekShortlist } from "@/components/investor/shortlist";
import { colors, layout, radius, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import { useDeviceId } from "@/lib/device";

const TYPES: Option<TypeFilter>[] = [
  { value: "all", label: "All types" },
  { value: "pitch", label: "Pitch and demo" },
  { value: "hackathon", label: "Hackathons" },
  { value: "networking", label: "Networking" },
];

const DATES: Option<DateFilter>[] = [
  { value: "any", label: "Any date" },
  { value: "week", label: "This week" },
  { value: "month", label: "Next 30 days" },
];

const ALL = "all";
const INITIAL: Filters = { school: null, type: "all", date: "any" };

export default function InvestorHome() {
  const deviceId = useDeviceId();
  const result = useQuery(api.investor.ranked, deviceId ? { deviceId } : "skip");
  const [filters, setFilters] = useState<Filters>(INITIAL);
  const [now] = useState(() => Date.now());

  const ranked = useMemo(() => result?.events ?? [], [result]);
  const shortlist = useMemo(() => weekShortlist(ranked, now), [ranked, now]);
  const visible = useMemo(() => applyFilters(ranked, filters, now), [ranked, filters, now]);
  const schools: Option<string>[] = [{ value: ALL, label: "All schools" }, ...schoolsIn(ranked).map((s) => ({ value: s, label: s }))];
  const filtered = filters.school !== null || filters.type !== "all" || filters.date !== "any";

  if (result === undefined) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </SafeAreaView>
    );
  }

  const header = (
    <View>
      <Text style={styles.h1}>Scouting</Text>
      <View style={styles.mode}>
        <Icon name="trending-up" size={14} color={colors.gold} />
        <Text style={styles.modeText}>Investor mode: student events by investor score</Text>
      </View>
      {!filtered ? <WeekShortlist items={shortlist} /> : null}
      <FilterRow label="School" options={schools} value={filters.school ?? ALL} onChange={(v) => setFilters((f) => ({ ...f, school: v === ALL ? null : v }))} />
      <FilterRow label="Type" options={TYPES} value={filters.type} onChange={(t) => setFilters((f) => ({ ...f, type: t }))} />
      <FilterRow label="Date" options={DATES} value={filters.date} onChange={(date) => setFilters((f) => ({ ...f, date }))} />
      <Text style={styles.meta}>{visible.length} student {visible.length === 1 ? "event" : "events"} · sorted by investor score and student turnout</Text>
    </View>
  );

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <FlatList
        testID="investor-list"
        data={visible}
        keyExtractor={(e) => e._id}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <InvestorCard event={item} />
          </View>
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.glyph}>
              <Icon name="trending-up" size={22} color={colors.gold} />
            </View>
            <Text style={styles.emptyLine}>{filtered ? "Nothing matches these filters" : "No student events yet"}</Text>
            <Text style={styles.emptySub}>{filtered ? "Try another school or date, or clear the filters" : "We check new listings every 30 minutes"}</Text>
            {filtered ? (
              <Pressable testID="clear-filters" accessibilityRole="button" onPress={() => setFilters(INITIAL)} style={styles.clear}>
                <Text style={styles.clearText}>Clear filters</Text>
              </Pressable>
            ) : null}
          </View>
        }
        contentContainerStyle={{ paddingBottom: 32 }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  h1: { ...type.screenTitle, color: colors.ink, paddingHorizontal: layout.screenPadding, paddingVertical: 12 },
  mode: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: layout.screenPadding, marginBottom: 14 },
  modeText: { ...type.tag, fontWeight: "500", color: colors.gold },
  meta: { ...type.tag, color: colors.subtle, paddingHorizontal: layout.screenPadding, paddingTop: 8, paddingBottom: 8 },
  item: { paddingHorizontal: layout.screenPadding, paddingBottom: layout.cardGap },
  empty: { alignItems: "center", paddingVertical: 56, paddingHorizontal: 24, gap: 6 },
  glyph: { width: 48, height: 48, borderRadius: radius.card, backgroundColor: colors.goldSoft, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  emptyLine: { ...type.bodyStrong, fontSize: 16, color: colors.ink },
  emptySub: { ...type.meta, color: colors.muted, textAlign: "center" },
  clear: { marginTop: 12, height: layout.buttonHeight, paddingHorizontal: 16, borderRadius: radius.button, justifyContent: "center", borderWidth: 0.5, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  clearText: { ...type.bodyStrong, color: colors.ink },
});
