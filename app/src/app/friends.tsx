import { useMutation, useQuery } from "convex/react";
import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { Card, ScreenHeader, SectionTitle } from "@/components/connections/ui";
import { colors, layout, radius, space, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import { errorCode } from "@/lib/connections";
import { useDeviceId } from "@/lib/device";
import { displayName } from "@/lib/friends";

const REQUEST_ERRORS: Record<string, string> = {
  invalid_code: "No one has that friend code. Check it and try again",
  self: "That's your own code. Send it to a friend instead",
  already_friends: "You're already friends",
  already_requested: "You've already sent them a request",
  rate_limited: "You've sent a lot of requests today. Try again tomorrow",
  not_found: "That request is no longer there",
  not_pending: "That request was already answered",
  forbidden: "You can't change that request",
};

export default function FriendsScreen() {
  const deviceId = useDeviceId();
  const args = deviceId ? { deviceId } : "skip";
  const list = useQuery(api.friends.list, args);
  const myCode = useMutation(api.friends.myCode);
  const [code, setCode] = useState<{ friendCode: string } | null>(null);
  const [codeError, setCodeError] = useState(false);
  const request = useMutation(api.friends.request);
  const respond = useMutation(api.friends.respond);
  const [entry, setEntry] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId) return;
    let live = true;
    myCode({ deviceId }).then((c) => live && setCode(c)).catch(() => live && setCodeError(true));
    return () => { live = false; };
  }, [deviceId, myCode]);

  const run = async (key: string, action: () => Promise<unknown>, done?: string) => {
    if (!deviceId || busy) return;
    setBusy(key); setError(null); setNotice(null);
    try { await action(); if (done) setNotice(done); }
    catch (e) { setError(REQUEST_ERRORS[errorCode(e) ?? ""] ?? "Couldn't reach Scout. Check your connection and try again"); }
    finally { setBusy(null); }
  };

  const add = () => {
    const friendCode = entry.trim().toUpperCase();
    if (!friendCode || !deviceId) return;
    void run("add", async () => {
      const result = await request({ deviceId, friendCode });
      setEntry("");
      setNotice(result.status === "accepted" ? "You're now friends" : "Request sent");
    });
  };

  const copy = () => {
    if (!code) return;
    void Clipboard.setStringAsync(code.friendCode).then(() => setNotice("Code copied"));
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="Friends" subtitle="See which events your friends are going to" fallback="/profile" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <SectionTitle>Your friend code</SectionTitle>
          <Card style={styles.codeCard} testID="friends-my-code">
            {code ? <Text style={styles.code} selectable testID="friend-code">{code.friendCode}</Text> : codeError ? <Text style={styles.error}>Couldn&apos;t load your code. Check your connection and reopen Friends</Text> : <ActivityIndicator color={colors.brand} />}
            <View style={styles.row}>
              <Button testID="friends-copy-code" label="Copy code" variant="outline" disabled={!code} style={styles.flex} onPress={copy} />
            </View>
          </Card>

          <SectionTitle>Add a friend</SectionTitle>
          <View style={styles.row}>
            <TextInput
              testID="friends-code-input"
              accessibilityLabel="Friend code"
              placeholder="Enter their code"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              value={entry}
              onChangeText={(v) => { setEntry(v); setError(null); }}
              onSubmitEditing={add}
              returnKeyType="send"
              maxLength={16}
              style={[styles.input, styles.flex]}
            />
            <Button testID="friends-add" label="Add" loading={busy === "add"} disabled={!entry.trim() || !!busy} onPress={add} />
          </View>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}

          {list === undefined ? (
            <ActivityIndicator style={{ marginTop: space.xxl }} color={colors.brand} />
          ) : (
            <>
              {list.incoming.length ? (
                <>
                  <SectionTitle>Requests for you</SectionTitle>
                  <Card testID="friends-incoming">
                    {list.incoming.map((r, i) => (
                      <PersonRow key={r.requestId} person={r} first={i === 0}>
                        <Button testID={`friends-decline-${r.requestId}`} label="Decline" variant="ghost" disabled={!!busy} style={styles.small} onPress={() => void run(r.requestId, () => respond({ deviceId: deviceId!, requestId: r.requestId, accept: false }))} />
                        <Button testID={`friends-accept-${r.requestId}`} label="Accept" loading={busy === r.requestId} disabled={!!busy} style={styles.small} onPress={() => void run(r.requestId, () => respond({ deviceId: deviceId!, requestId: r.requestId, accept: true }), "You're now friends")} />
                      </PersonRow>
                    ))}
                  </Card>
                </>
              ) : null}

              {list.outgoing.length ? (
                <>
                  <SectionTitle>Sent requests</SectionTitle>
                  <Card testID="friends-outgoing">
                    {list.outgoing.map((r, i) => (
                      <PersonRow key={r.requestId} person={r} first={i === 0} hint="Waiting for them to accept" />
                    ))}
                  </Card>
                </>
              ) : null}

              <SectionTitle>{list.friends.length ? `Friends · ${list.friends.length}` : "Friends"}</SectionTitle>
              {list.friends.length ? (
                <Card testID="friends-list">
                  {list.friends.map((f, i) => (
                    <PersonRow key={f.userId} person={f} first={i === 0} />
                  ))}
                </Card>
              ) : (
                <Text testID="friends-empty" style={styles.meta}>No friends yet. Share your code, or add a friend by theirs</Text>
              )}
              <Text style={styles.privacy}>Friends see your name, your school or company, and the events you mark Going. Never your email, phone, or LinkedIn</Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PersonRow({ person, first, hint, children }: { person: { name: string | null; affiliation: string | null }; first: boolean; hint?: string; children?: React.ReactNode }) {
  const name = displayName(person);
  return (
    <View style={[styles.person, !first && styles.divider]}>
      <View style={styles.avatar}><Text style={styles.initial}>{name.charAt(0).toUpperCase()}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        {person.affiliation || hint ? <Text style={styles.meta} numberOfLines={1}>{[person.affiliation, hint].filter(Boolean).join(" · ")}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: layout.screenPadding, paddingBottom: space.xxxl },
  flex: { flex: 1 },
  row: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  codeCard: { padding: layout.cardPadding, gap: space.md, alignItems: "stretch" },
  code: { ...type.screenTitle, ...type.numeric, letterSpacing: 4, textAlign: "center", color: colors.ink },
  input: { height: layout.buttonHeight, paddingHorizontal: 12, borderRadius: radius.input, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, color: colors.ink, fontSize: 15, letterSpacing: 1 },
  error: { ...type.meta, color: colors.danger, marginTop: space.sm },
  notice: { ...type.meta, color: colors.success, marginTop: space.sm },
  person: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: layout.tapTarget + 12, paddingHorizontal: layout.cardPadding, paddingVertical: space.sm },
  divider: { borderTopWidth: 0.5, borderTopColor: colors.line },
  avatar: { width: 34, height: 34, borderRadius: radius.pill, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  initial: { ...type.label, color: colors.brandInk },
  name: { ...type.bodyStrong, color: colors.ink },
  meta: { ...type.meta, color: colors.muted },
  small: { height: 34, paddingHorizontal: 12 },
  privacy: { ...type.meta, color: colors.subtle, marginTop: space.lg },
});
