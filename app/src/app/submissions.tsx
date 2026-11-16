import { useQuery } from "convex/react";
import { router, type ErrorBoundaryProps } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "@/components/feed/empty-state";
import { AlertIcon, BackIcon, LinkIcon } from "@/components/icons";
import { LinkedEvent } from "@/components/links/linked-event";
import { STATUS_COLOR, StatusIcon } from "@/components/links/status-icon";
import { colors, layout, radius, shadow, space, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useDeviceId } from "@/lib/device";
import { linkParts, STATUS_LABEL, timeAgo } from "@/lib/links";

const back = () => (router.canGoBack() ? router.back() : router.replace("/profile"));

function Header() {
  return (
    <View style={styles.dhead}>
      <Pressable testID="back" accessibilityRole="button" accessibilityLabel="Back" onPress={back} style={styles.iconBtn}>
        <BackIcon color={colors.ink} />
      </Pressable>
      <Pressable testID="submissions-add" accessibilityRole="button" onPress={() => router.push("/submit")} style={styles.linkBtn}>
        <Text style={styles.linkText}>Add an event</Text>
      </Pressable>
    </View>
  );
}

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaView style={styles.safe}>
      <Header />
      <EmptyState tone="danger" icon={<AlertIcon color={colors.danger} />} title="Couldn't load your submissions" body="Check your connection and try again" action={{ label: "Try again", onPress: retry }} />
    </SafeAreaView>
  );
}

function SubmissionRow({ item }: { item: Doc<"link_submissions"> }) {
  const { host, path } = linkParts(item.url);
  return (
    <View testID={`submission-${item._id}`} style={styles.card}>
      <View style={styles.top}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.host} numberOfLines={1}>
            {host}
          </Text>
          {path ? (
            <Text style={styles.path} numberOfLines={1}>
              {path}
            </Text>
          ) : null}
        </View>
        <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
      </View>
      <View style={styles.status}>
        <StatusIcon status={item.status} size={14} />
        <Text testID={`submission-status-${item.status}`} style={[styles.statusText, { color: STATUS_COLOR[item.status] }]}>
          {item.status === "pending" ? "Checking the page" : STATUS_LABEL[item.status]}
          {item.eventIds.length > 1 ? ` · ${item.eventIds.length} events` : ""}
        </Text>
      </View>
      {item.error ? <Text style={styles.reason}>{item.error}</Text> : null}
      {item.eventIds.length ? (
        <View style={styles.events}>
          {item.eventIds.map((id) => (
            <LinkedEvent key={id} id={id} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function SubmissionsScreen() {
  const deviceId = useDeviceId();
  const items = useQuery(api.links.mine, deviceId ? { deviceId } : "skip");

  return (
    <SafeAreaView style={styles.safe}>
      <Header />
      <FlatList
        testID="submissions-list"
        data={items ?? []}
        keyExtractor={(s) => s._id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: layout.cardGap }} />}
        ListHeaderComponent={
          <View style={{ paddingBottom: space.md }}>
            <Text style={styles.title} accessibilityRole="header">
              My submissions
            </Text>
            {items?.length ? <Text style={styles.meta}>Your {items.length === 50 ? "50 newest" : items.length} links</Text> : null}
          </View>
        }
        ListEmptyComponent={
          items === undefined ? (
            <ActivityIndicator style={{ marginTop: 48 }} color={colors.brand} />
          ) : (
            <EmptyState
              testID="submissions-empty"
              icon={<LinkIcon size={22} color={colors.brand} />}
              title="No links yet"
              body="Know an event Scout is missing? Paste its link and we'll add it"
              action={{ label: "Add an event", onPress: () => router.push("/submit"), testID: "submissions-empty-add" }}
            />
          )
        }
        renderItem={({ item }) => <SubmissionRow item={item} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  dhead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 52, paddingHorizontal: 8 },
  iconBtn: { width: layout.tapTarget, height: layout.tapTarget, alignItems: "center", justifyContent: "center", borderRadius: radius.button },
  linkBtn: { height: layout.tapTarget, paddingHorizontal: 12, justifyContent: "center" },
  linkText: { ...type.label, color: colors.brand },
  list: { paddingHorizontal: layout.screenPadding, paddingBottom: space.xxxl },
  title: { ...type.screenTitle, color: colors.ink },
  meta: { fontSize: 12, color: colors.subtle, marginTop: space.xs },
  card: { padding: layout.cardPadding, borderRadius: radius.card, backgroundColor: colors.surface, gap: space.sm, ...shadow.card },
  top: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  host: { ...type.cardTitle, color: colors.ink },
  path: { ...type.meta, color: colors.muted },
  time: { ...type.meta, ...type.numeric, color: colors.subtle },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusText: { ...type.label },
  reason: { ...type.meta, color: colors.muted },
  events: { gap: layout.cardGap, marginTop: space.xs },
});
