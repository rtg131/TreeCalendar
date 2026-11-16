import { useMutation, useQuery } from "convex/react";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/button";
import { EventThumb, HostLine } from "@/components/event-media";
import { SelectChip } from "@/components/select-chip";
import { colors, layout, radius, shadow, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { errorCode, errorCopy } from "@/lib/connections";
import { clearDraft, readDraft, writeDraft, type CheckInDraft } from "@/lib/check-in-draft";
import { useDeviceId } from "@/lib/device";
import { isPast, relativeDay } from "@/lib/format";

export function useAttendanceNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") setNow(Date.now()); });
    return () => { clearInterval(timer); listener.remove(); };
  }, []);
  return now;
}

export function GoingButton({ event }: { event: { _id: Id<"events">; startTime: number; endTime?: number } }) {
  const deviceId = useDeviceId();
  const mine = useQuery(api.attendance.mine, deviceId ? { deviceId } : "skip");
  const setGoing = useMutation(api.attendance.setGoing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useAttendanceNow();
  const going = mine?.some((a) => a.eventId === event._id && a.going) ?? false;
  if (isPast(event.startTime, event.endTime, now)) return null;
  return (
    <View>
      <Pressable
        testID={`going-${event._id}`}
        accessibilityRole="button"
        accessibilityLabel={going ? "Going. Tap to cancel" : "I'm going"}
        accessibilityState={{ selected: going, busy, disabled: busy || !mine }}
        disabled={busy || !mine}
        onPress={async () => {
          if (!deviceId || busy) return;
          setBusy(true); setError(null);
          try { await setGoing({ deviceId, eventId: event._id, going: !going }); }
          catch (e) { setError(errorCode(e) === "event_ended" ? errorCopy(e) : "Couldn't update going. Check your connection and try again"); }
          finally { setBusy(false); }
        }}
        style={[styles.going, going && styles.selected]}
      >
        <Text style={styles.goingLabel}>{busy ? "Updating…" : going ? "✓ Going" : "I'm going"}</Text>
        <Text style={styles.meta}>{going ? "Tap to cancel" : "More than a save"}</Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function AttendancePrompt() {
  const deviceId = useDeviceId();
  const now = useAttendanceNow();
  const pending = useQuery(api.attendance.pending, deviceId ? { deviceId, now } : "skip");
  const [last, setLast] = useState<{ deviceId: string | null; events: typeof pending }>({ deviceId, events: pending });
  if ((deviceId && last.deviceId !== deviceId) || (pending !== undefined && last.events !== pending)) {
    setLast({ deviceId, events: pending });
  }
  const event = (pending ?? last.events)?.[0];
  return event ? <CheckIn key={event._id} event={event} /> : null;
}

function CheckIn({ event }: { event: Doc<"events"> }) {
  const deviceId = useDeviceId();
  const respond = useMutation(api.attendance.respond);
  const dismiss = useMutation(api.attendance.dismiss);
  const [{ attended, rating, investors, note }, setDraft] = useState(() => readDraft(event._id));
  const update = (patch: Partial<CheckInDraft>) => setDraft(writeDraft(event._id, patch));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const send = async (action: "no" | "yes" | "dismiss") => {
    if (!deviceId || busy) return;
    setBusy(true); setError(false);
    try {
      if (action === "dismiss") await dismiss({ deviceId, eventId: event._id });
      else await respond({ deviceId, eventId: event._id, attended: action === "yes", ...(action === "yes" ? { rating, investors, note } : {}) });
      clearDraft(event._id);
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  return (
    <View testID="attendance-prompt" style={styles.card}>
      <Text style={styles.eyebrow}>THE ROOM, REVIEWED</Text>
      <Text style={styles.heading}>{attended ? "Was it worth it?" : "Did you make it?"}</Text>
      <View style={styles.checkInEvent}>
        <EventThumb event={event} size={44} />
        <View style={styles.historyText}>
          <Text style={styles.eventTitle}>{event.title}</Text>
          <HostLine event={event} size={16} />
        </View>
      </View>
      {!attended ? (
        <View style={styles.row}>
          <Button testID="attendance-no" label="Didn't go" variant="outline" disabled={busy} style={styles.half} onPress={() => void send("no")} />
          <Button testID="attendance-yes" label="Yes, I went" disabled={busy} style={styles.half} onPress={() => update({ attended: true })} />
        </View>
      ) : (
        <>
          <Text style={styles.meta}>Worth your time · 1 is not really, 10 is absolutely</Text>
          <RatingPicker value={rating} onChange={(n) => update({ rating: n })} />
          <Text style={styles.label}>Were investors or recruiters there?</Text>
          <View style={styles.row}>
            {([ ["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"] ] as const).map(([value, label]) => <SelectChip key={value} testID={`investors-${value}`} label={label} selected={investors === value} onPress={() => update({ investors: value })} />)}
          </View>
          <TextInput testID="attendance-note" accessibilityLabel="One-line note (optional)" placeholder="One thing to remember (optional)" placeholderTextColor={colors.muted} value={note} onChangeText={(v) => update({ note: v.replace(/[\r\n]/g, " ") })} maxLength={240} style={styles.input} />
          <Button testID="submit-attendance" label="Save my check-in" loading={busy} disabled={!rating || !investors} onPress={() => void send("yes")} />
          <Text style={styles.meta}>Your note stays private. Only counts and averages are shared</Text>
        </>
      )}
      {error ? <Text accessibilityRole="alert" style={styles.error}>Couldn&apos;t save your check-in. Try again</Text> : null}
      <Button testID="dismiss-attendance" label="Skip this check-in" variant="ghost" disabled={busy} onPress={() => void send("dismiss")} />
    </View>
  );
}

const RATINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function RatingPicker({ value, onChange }: { value?: number; onChange: (n: number) => void }) {
  return (
    <View testID="worth-picker" accessibilityRole="radiogroup" accessibilityLabel="Worth it, 1 to 10" style={styles.picker}>
      {RATINGS.map((n) => {
        const on = value === n;
        return (
          <Pressable
            key={n}
            testID={`worth-${n}`}
            accessibilityRole="radio"
            accessibilityLabel={`${n} out of 10`}
            accessibilityState={{ checked: on }}
            onPress={() => onChange(n)}
            style={({ pressed }) => [styles.pick, on && styles.pickOn, pressed && !on && { opacity: 0.6 }]}
          >
            <Text style={[styles.pickLabel, on && styles.pickLabelOn]}>{n}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function AttendanceAggregate({ eventId }: { eventId: Id<"events"> }) {
  const aggregate = useQuery(api.attendance.aggregate, { eventId });
  if (!aggregate) return null;
  return (
    <View testID="attendance-aggregate" style={styles.aggregate}>
      <Text style={styles.label}>{aggregate.averageWorthIt.toFixed(1)}/10 worth it · {aggregate.ratingCount} ratings</Text>
      <Text style={styles.confirmed}>{aggregate.investorConfirmations > 0 ? `Investors or recruiters confirmed by ${aggregate.investorConfirmations} attendee${aggregate.investorConfirmations === 1 ? "" : "s"}` : "No investor or recruiter confirmations from attendees"}</Text>
      <Text style={styles.meta}>Reported by attendees · separate from the inferred score</Text>
    </View>
  );
}

export function AttendanceHistory() {
  const deviceId = useDeviceId();
  const history = useQuery(api.attendance.history, deviceId ? { deviceId } : "skip");
  return (
    <View testID="attendance-history" style={{ marginTop: 24, gap: 10 }}>
      <Text style={styles.heading}>Events attended</Text>
      <Text style={styles.meta}>Your private, self-reported attendance record</Text>
      {history === undefined ? <Text style={styles.meta}>Loading your history…</Text> : history.length === 0 ? <Text style={styles.meta}>Your first room is waiting. Mark an event Going, then check in after it ends</Text> : history.map((item) => (
        <Pressable key={item.event._id} accessibilityRole="button" onPress={() => router.push({ pathname: "/event/[id]", params: { id: item.event._id } })} style={styles.historyItem}>
          <EventThumb event={item.event} size={56} />
          <View style={styles.historyText}>
            <Text style={styles.eventTitle}>{item.event.title}</Text>
            <HostLine event={item.event} size={16} />
            <Text style={styles.meta}>{relativeDay(item.event.startTime, item.event.endTime)} · {item.rating ?? "—"}/10 worth it</Text>
            {item.note ? <Text style={styles.note}>{item.note}</Text> : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, marginVertical: 12, borderRadius: radius.card, backgroundColor: colors.surface, gap: 10, ...shadow.card, borderColor: colors.brand },
  eyebrow: { ...type.tag, fontWeight: "500", letterSpacing: 1, color: colors.brandInk },
  heading: { ...type.cardTitle, fontSize: 18, color: colors.ink },
  eventTitle: { ...type.bodyStrong, color: colors.ink },
  label: { ...type.label, color: colors.ink },
  meta: { ...type.tag, color: colors.muted },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  half: { flex: 1 },
  picker: { flexDirection: "row", gap: 3, padding: 3, borderRadius: radius.button + 2, backgroundColor: colors.secondary },
  pick: { flex: 1, minWidth: 0, height: layout.tapTarget, borderRadius: radius.button - 2, alignItems: "center", justifyContent: "center" },
  pickOn: { backgroundColor: colors.brand },
  pickLabel: { ...type.label, ...type.numeric, fontSize: 15, color: colors.ink },
  pickLabelOn: { color: colors.white },
  input: { minHeight: 44, paddingHorizontal: 12, borderRadius: radius.input, borderWidth: 1, borderColor: colors.lineStrong, color: colors.ink, fontSize: 14 },
  error: { ...type.meta, color: colors.danger, padding: 8 },
  going: { minHeight: 44, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 0.5, borderColor: colors.line },
  selected: { backgroundColor: colors.brandSoft },
  goingLabel: { ...type.label, color: colors.brandInk },
  aggregate: { gap: 6, paddingTop: 12, marginTop: 8, borderTopWidth: 0.5, borderColor: colors.lineStrong },
  confirmed: { ...type.meta, color: colors.gold },
  historyItem: { flexDirection: "row", alignItems: "flex-start", padding: 14, borderRadius: radius.card, backgroundColor: colors.surface, gap: 12, ...shadow.card },
  historyText: { flex: 1, minWidth: 0, gap: 4 },
  checkInEvent: { flexDirection: "row", alignItems: "center", gap: 10 },
  note: { ...type.meta, color: colors.ink },
});
