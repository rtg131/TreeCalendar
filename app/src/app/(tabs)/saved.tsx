import { useMutation, useQuery } from "convex/react";
import { router, type ErrorBoundaryProps } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EventCard } from "@/components/event-card";
import { EmptyState } from "@/components/feed/empty-state";
import { Segmented } from "@/components/segmented";
import { SkeletonCards } from "@/components/feed/skeleton";
import { Toast, useToast } from "@/components/feed/toast";
import { AlertIcon, BookmarkIcon } from "@/components/icons";
import { colors, layout, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDeviceId } from "@/lib/device";
import { isPast } from "@/lib/format";

type Tab = "upcoming" | "past";

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={[styles.apphead, { paddingHorizontal: layout.screenPadding }]}>
        <Text style={styles.h1}>Saved</Text>
      </View>
      <EmptyState tone="danger" icon={<AlertIcon color={colors.danger} />} title="Couldn't load saved events" body="Check your connection and try again" action={{ label: "Try again", onPress: retry }} />
    </SafeAreaView>
  );
}

export default function Saved() {
  const deviceId = useDeviceId();
  const saved = useQuery(api.saves.list, deviceId ? { deviceId } : "skip");
  const toggle = useMutation(api.saves.toggle);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [pending, setPending] = useState<Id<"events"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast, show, hide } = useToast();
  const [now] = useState(() => Date.now());

  const { upcoming, past } = useMemo(() => {
    const all = saved ?? [];
    return {
      upcoming: all.filter((e) => !isPast(e.startTime, e.endTime, now)),
      past: all.filter((e) => isPast(e.startTime, e.endTime, now)).reverse(),
    };
  }, [saved, now]);
  const data = tab === "upcoming" ? upcoming : past;

  const unsave = async (eventId: Id<"events">, title: string) => {
    if (!deviceId) return;
    setPending(eventId);
    setError(null);
    try {
      await toggle({ deviceId, eventId });
      show({ title: "Removed from saved", body: title, action: { label: "Undo", onPress: () => toggle({ deviceId, eventId }).catch(() => setError("Couldn't undo: no connection. Try again")) } });
    } catch {
      setError("Couldn't remove it: no connection. It's still saved. Try again");
    } finally {
      setPending(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FlatList
        testID="saved-list"
        data={data}
        keyExtractor={(e) => e._id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: layout.cardGap }} />}
        renderItem={({ item }) => (
          <EventCard
            event={item}
            dimmed={tab === "past"}
            accessory={
              <Pressable
                testID={`unsave-${item._id}`}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.title} from saved`}
                hitSlop={8}
                disabled={pending === item._id}
                onPress={() => unsave(item._id, item.title)}
                style={styles.unsave}
              >
                {pending === item._id ? <ActivityIndicator size="small" color={colors.brand} /> : <BookmarkIcon size={20} color={colors.brand} filled />}
              </Pressable>
            }
          />
        )}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.apphead}>
              <Text style={styles.h1}>Saved</Text>
            </View>
            <Segmented
              accessibilityLabel="Saved events"
              value={tab}
              onChange={setTab}
              options={[
                { value: "upcoming", label: `Upcoming${saved ? ` · ${upcoming.length}` : ""}`, testID: "saved-upcoming" },
                { value: "past", label: `Past${saved ? ` · ${past.length}` : ""}`, testID: "saved-past" },
              ]}
            />
            {error ? (
              <Text accessibilityRole="alert" style={styles.err}>
                {error}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          saved === undefined ? (
            <SkeletonCards count={3} />
          ) : tab === "upcoming" ? (
            <EmptyState
              testID="saved-empty"
              icon={<BookmarkIcon size={22} color={colors.brand} />}
              title="No saved events yet"
              body="Tap Save on an event and it shows up here"
              action={{ label: "Browse events", onPress: () => router.navigate("/feed"), testID: "browse-events" }}
            />
          ) : (
            <EmptyState icon={<BookmarkIcon size={22} color={colors.brand} />} title="No past events" body="Events you saved move here after they end" />
          )
        }
      />
      <Toast toast={toast} onHide={hide} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  h1: { ...type.screenTitle, color: colors.ink },
  list: { paddingHorizontal: layout.screenPadding, paddingBottom: 96 },
  header: { paddingBottom: 14, gap: 4 },
  apphead: { height: 52, justifyContent: "center" },
  unsave: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  err: { fontSize: 13, color: colors.danger, marginTop: 8 },
});
