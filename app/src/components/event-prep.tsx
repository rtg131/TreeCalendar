import { useAction, useQuery } from "convex/react";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/button";
import { SparkIcon } from "@/components/icons";
import { colors, layout, radius, shadow, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { isPast } from "@/lib/format";
import { recipientSuggestions } from "@/lib/prep";

export function EventPrep({ event, deviceId }: { event: Doc<"events">; deviceId: string | null }) {
  const data = useQuery(api.prep.get, deviceId ? { deviceId, eventId: event._id } : "skip");
  const generateBriefing = useAction(api.prep.generateBriefing);
  const generateFollowup = useAction(api.prep.generateFollowup);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const past = isPast(event.startTime, event.endTime);
  const suggestions = recipientSuggestions(event);
  const who = recipient ?? data?.followup?.recipient ?? suggestions[0] ?? "";
  const briefing = data?.briefing;
  const followup = data?.followup?.recipient === who.trim() ? data.followup : null;

  const generate = async () => {
    if (!deviceId || pending) return;
    setPending(true);
    setError(null);
    setCopied(null);
    try {
      if (past) await generateFollowup({ deviceId, eventId: event._id, recipient: who });
      else await generateBriefing({ deviceId, eventId: event._id });
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setError(message.includes("onboarding") ? "Finish setting up Scout before generating a card" : message.includes("Too many") || message.includes("rate limit") ? "A few too many requests. Try again in a minute" : "Couldn't prepare this card. Check your connection and try again");
    } finally {
      setPending(false);
    }
  };

  const copy = async (channel: string, text: string) => {
    try {
      if (!(await Clipboard.setStringAsync(text))) throw new Error("Clipboard unavailable");
      setCopied(channel);
      setError(null);
    } catch {
      setError("Couldn't copy. You can select and copy the message below");
    }
  };

  return (
    <View testID={past ? "followup-card" : "prep-card"} style={styles.card}>
      <View style={styles.head}>
        <View style={styles.glyph}><SparkIcon size={20} color={colors.brand} /></View>
        <View style={styles.grow}>
          <Text style={styles.title}>{past ? "Keep the conversation going" : "Walk in with a little confidence"}</Text>
          <Text style={styles.meta}>{past ? "Two drafts, ready to make your own" : "Your two-minute event briefing"}</Text>
        </View>
      </View>
      {past ? (
        <>
          <Text style={styles.label}>Who did you meet?</Text>
          <TextInput testID="followup-recipient" accessibilityLabel="Who did you meet?" value={who} onChangeText={(value) => { setRecipient(value); setCopied(null); }} maxLength={120} placeholder="Name or organization" placeholderTextColor={colors.subtle} style={styles.input} />
          <Text style={styles.meta}>Choose a listed host or sponsor, or type the person you met</Text>
          {suggestions.length ? <View style={styles.suggestions}>{suggestions.map((name) => (
            <Pressable key={name} accessibilityRole="button" accessibilityLabel={`Draft to ${name}`} onPress={() => { setRecipient(name); setCopied(null); }} style={styles.suggestion}>
              <Text style={styles.meta}>{name}</Text>
            </Pressable>
          ))}</View> : null}
          {!followup ? <Button testID="generate-followup" label={pending ? "Drafting" : "Follow up"} variant="outline" loading={pending} disabled={!deviceId || !who.trim()} onPress={generate} /> : null}
          {followup ? (
            <>
              <Text style={styles.note}>Review and personalize before sending. Nothing is sent by Scout</Text>
              {([ ["LinkedIn", followup.linkedin], ["Email", followup.email] ] as const).map(([channel, text]) => (
                <View key={channel} style={styles.draft}>
                  <Text style={styles.label}>{channel}</Text>
                  <Text testID={`followup-${channel.toLowerCase()}`} selectable style={styles.body}>{text}</Text>
                  <Button testID={`copy-${channel.toLowerCase()}`} label={copied === channel ? `Copied ${channel}` : `Copy ${channel}`} variant="outline" onPress={() => copy(channel, text)} />
                </View>
              ))}
              <Text accessibilityLiveRegion="polite" style={styles.meta}>{copied ? `${copied} copied to clipboard` : "Saved for this event on your device profile"}</Text>
            </>
          ) : null}
        </>
      ) : briefing ? (
        <View testID="prep-briefing" style={styles.content}>
          <Text style={styles.body}>{briefing.summary}</Text>
          <Text style={styles.label}>Who’s in the listing</Text>
          {briefing.people.length ? briefing.people.map((person) => <Text key={person} style={styles.body}>{person}</Text>) : <Text style={styles.body}>People and firms: not listed</Text>}
          <Text style={styles.note}>From the listing, not a confirmed attendee list</Text>
          <Text style={styles.label}>A good question opens doors</Text>
          {briefing.questions.map((question, index) => <Text key={question} style={styles.body}>{index + 1}. {question}</Text>)}
          <View style={styles.tip}><Text style={styles.label}>One small tip</Text><Text style={styles.body}>{briefing.tip}</Text></View>
          <Text style={styles.meta}>{briefing.source === "model" ? "AI-selected prompts · listing-grounded" : "Listing-based briefing · no AI connection needed"}</Text>
          <Text style={styles.note}>Cached for this event · ready when you are</Text>
        </View>
      ) : (
        <>
          <Text style={styles.body}>Who’s listed, what to ask, and one small tip. No homework required</Text>
          <Button testID="prep-me" label={pending ? "Preparing" : "Prep me"} variant="outline" loading={pending} disabled={!deviceId} onPress={generate} />
        </>
      )}
      {error ? <Text accessibilityRole="alert" testID="prep-error" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: layout.screenPadding, marginTop: 16, padding: 14, borderRadius: radius.card, backgroundColor: colors.surface, gap: 12, ...shadow.card },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  glyph: { width: 40, height: 40, borderRadius: radius.button, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1 },
  title: { ...type.cardTitle, color: colors.ink },
  meta: { ...type.meta, color: colors.muted },
  label: { ...type.label, color: colors.ink },
  body: { ...type.body, color: colors.ink },
  note: { ...type.tag, color: colors.muted },
  content: { gap: 10 },
  tip: { padding: 12, gap: 6, backgroundColor: colors.brandSoft, borderRadius: radius.button },
  input: { minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.input, ...type.body, color: colors.ink },
  draft: { paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, gap: 10 },
  error: { ...type.meta, color: colors.danger },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  suggestion: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 12 },
});
