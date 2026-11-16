import * as Clipboard from "expo-clipboard";
import { useAction } from "convex/react";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { BackIcon } from "@/components/icons";
import { LinkedEvent } from "@/components/links/linked-event";
import { STATUS_COLOR, StatusIcon } from "@/components/links/status-icon";
import { colors, layout, radius, shadow, space, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDeviceId } from "@/lib/device";
import { checkLink } from "@/lib/links";

type Result = { status: "added" | "duplicate" | "needs_review" | "rejected"; eventIds: Id<"events">[]; reason?: string };

const back = () => (router.canGoBack() ? router.back() : router.replace("/feed"));

const SOURCES = ["Luma", "Eventbrite", "Devpost", "Meetup", "club pages"];

function headline(result: Result) {
  const n = result.eventIds.length;
  if (result.status === "added") return n > 1 ? `Added ${n} events to Scout` : "Added to Scout";
  if (result.status === "duplicate") return n > 1 ? `Scout already lists these ${n} events` : "Scout already lists this event";
  if (result.status === "needs_review") return "Sent for review";
  return "Couldn't add this link";
}

function detail(result: Result) {
  if (result.status === "added") return "Thanks. It's on Scout now for everyone nearby";
  if (result.status === "duplicate") return "Nothing new to add. Here's the listing we have";
  if (result.status === "needs_review") return result.reason ? `${result.reason}. We'll take a look by hand` : "We couldn't read it automatically. We'll take a look by hand";
  return result.reason ?? "This link can't be added";
}

export default function SubmitScreen() {
  const deviceId = useDeviceId();
  const submitLink = useAction(api.links.submit);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const paste = async () => {
    const clip = (await Clipboard.getStringAsync()).trim();
    if (!clip) return setError("Your clipboard is empty. Copy an event link first");
    setText(clip);
    setError(null);
    setResult(null);
  };

  const submit = async () => {
    const checked = checkLink(text);
    if ("error" in checked) return setError(checked.error);
    if (!deviceId) return;
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      setResult(await submitLink({ deviceId, url: checked.url }));
    } catch {
      setError("Couldn't send the link: no connection. Try again");
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setText("");
    setResult(null);
    setError(null);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.dhead}>
        <Pressable testID="back" accessibilityRole="button" accessibilityLabel="Back" onPress={back} style={styles.iconBtn}>
          <BackIcon color={colors.ink} />
        </Pressable>
        <Pressable testID="open-submissions" accessibilityRole="button" onPress={() => router.push("/submissions")} style={styles.linkBtn}>
          <Text style={styles.linkText}>My submissions</Text>
        </Pressable>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title} accessibilityRole="header">
            Add an event
          </Text>
          <Text style={styles.lede}>{"Paste a link to an event we're missing. Scout reads the page and adds it to the feed"}</Text>

          <Text style={styles.label}>Event link</Text>
          <View style={[styles.field, error ? styles.fieldError : null]}>
            <TextInput
              testID="link-input"
              accessibilityLabel="Event link"
              value={text}
              onChangeText={(t) => {
                setText(t);
                setError(null);
                setResult(null);
              }}
              onSubmitEditing={submit}
              placeholder="lu.ma/your-event"
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              editable={!submitting}
              style={styles.input}
            />
            <Pressable testID="paste-link" accessibilityRole="button" accessibilityLabel="Paste from clipboard" disabled={submitting} onPress={paste} style={styles.paste} hitSlop={6}>
              <Text style={styles.pasteText}>Paste</Text>
            </Pressable>
          </View>
          <Text testID="link-error" style={styles.error} accessibilityRole="alert">
            {error ?? ""}
          </Text>
          <Text style={styles.hint}>Works with {SOURCES.join(", ")}. Public events in the Bay Area only. Up to 10 links an hour</Text>

          <Button testID="submit-link" label={submitting ? "Reading the page" : "Add event"} loading={submitting} onPress={submit} style={{ marginTop: space.xl }} />
          {submitting ? <Text style={styles.wait}>This can take a few seconds</Text> : null}

          {result ? (
            <View testID={`result-${result.status}`} style={styles.result}>
              <View style={styles.resultHead}>
                <StatusIcon status={result.status} size={18} />
                <Text style={[styles.resultTitle, { color: result.status === "rejected" ? STATUS_COLOR.rejected : colors.ink }]}>{headline(result)}</Text>
              </View>
              <Text style={styles.resultBody}>{detail(result)}</Text>
              {result.eventIds.length ? (
                <View style={styles.events}>
                  {result.eventIds.map((id) => (
                    <LinkedEvent key={id} id={id} />
                  ))}
                </View>
              ) : null}
              <Button testID="add-another" variant="ghost" label="Add another link" onPress={reset} />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  dhead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 52, paddingHorizontal: 8 },
  iconBtn: { width: layout.tapTarget, height: layout.tapTarget, alignItems: "center", justifyContent: "center", borderRadius: radius.button },
  linkBtn: { height: layout.tapTarget, paddingHorizontal: 12, justifyContent: "center" },
  linkText: { ...type.label, color: colors.brand },
  content: { paddingHorizontal: layout.screenPadding, paddingBottom: space.xxxl },
  title: { ...type.screenTitle, color: colors.ink },
  lede: { ...type.body, color: colors.muted, marginTop: space.sm },
  label: { ...type.label, color: colors.muted, marginTop: space.xxl, marginBottom: space.sm },
  field: { flexDirection: "row", alignItems: "center", height: 48, borderRadius: radius.input, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong, paddingLeft: 12 },
  fieldError: { borderColor: colors.danger },
  input: { flex: 1, ...type.body, color: colors.ink, height: "100%" },
  paste: { height: 32, marginRight: 8, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.brandSoft, justifyContent: "center" },
  pasteText: { ...type.label, color: colors.brandInk },
  error: { ...type.meta, color: colors.danger, minHeight: 18, marginTop: space.xs },
  hint: { ...type.meta, color: colors.muted },
  wait: { ...type.meta, color: colors.muted, textAlign: "center", marginTop: space.sm },
  result: { marginTop: space.xxl, padding: layout.cardPadding, borderRadius: radius.card, backgroundColor: colors.surface, gap: space.sm, ...shadow.card },
  resultHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  resultTitle: { ...type.cardTitle, flex: 1 },
  resultBody: { ...type.meta, color: colors.muted },
  events: { gap: layout.cardGap, marginTop: space.xs },
});
