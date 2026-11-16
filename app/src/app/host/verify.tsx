import { useAction } from "convex/react";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { Card, Notice, ScreenHeader, styles } from "@/components/connections/ui";
import { colors, space, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import { useDeviceId } from "@/lib/device";
import { errorCode, errorCopy, useHostStatus } from "@/lib/connections";

type Sent = { sentTo: string; expiresAt: number; verificationMode: "email" | "dev"; devCode?: string };

export default function HostVerifyScreen() {
  const deviceId = useDeviceId();
  const status = useHostStatus();
  const start = useAction(api.hosts.startVerification);
  const confirm = useAction(api.hosts.confirmVerification);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<Sent | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === undefined) return <ActivityIndicator style={{ flex: 1, backgroundColor: colors.bg }} color={colors.brand} />;

  const send = async () => {
    if (!deviceId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await start({ deviceId, workEmail: email });
      setSent(result);
      setEditing(false);
      setCode(result.devCode ?? "");
    } catch (e) {
      setError(errorCopy(e));
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    if (!deviceId) return;
    setBusy(true);
    setError(null);
    try {
      await confirm({ deviceId, code });
      router.replace("/companies");
    } catch (e) {
      setError(errorCopy(e));
      if (errorCode(e) === "code_expired" || errorCode(e) === "too_many_attempts") setCode("");
    } finally {
      setBusy(false);
    }
  };

  const awaiting = editing ? null : sent ?? (status.pending ? { sentTo: status.pending.email, expiresAt: status.pending.expiresAt, verificationMode: status.pending.verificationMode } : null);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="Verify your work email" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {status.role !== "host" ? (
          <Notice title="For hosts" body="Switch your profile to I'm a host to verify a work email and use company features" />
        ) : status.verified ? (
          <>
            <Notice testID="host-verified" title="You're a verified host" body={`Verified as ${status.workEmail ?? "your work email"}.`} />
            {status.verificationMode === "dev" ? <DevNote /> : null}
            <Button label="Go to Companies" style={{ marginTop: space.lg }} onPress={() => router.replace("/companies")} />
          </>
        ) : !awaiting ? (
          <>
            <Text style={[styles.body, { marginTop: space.md }]}>Enter the email you use at work. We&apos;ll send a 6-digit code to prove you can read it. This only verifies the address; you still sign in with your Scout email and password.</Text>
            <Card style={{ padding: 14, marginTop: space.lg, gap: space.sm }}>
              <TextInput testID="work-email" accessibilityLabel="Work email" value={email} onChangeText={setEmail} placeholder="you@company.com" placeholderTextColor={colors.subtle} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" style={styles.input} />
              <Text style={styles.meta}>Company or school addresses only. Gmail, Outlook and other personal addresses can&apos;t verify a host</Text>
              <Button testID="send-code" label="Send code" loading={busy} disabled={!email.trim()} onPress={() => void send()} />
            </Card>
          </>
        ) : (
          <>
            <Text style={[styles.body, { marginTop: space.md }]}>
              {awaiting.verificationMode === "dev" ? "Dev verification: no email was sent." : `We sent a 6-digit code to ${awaiting.sentTo}.`} It expires at {new Date(awaiting.expiresAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.
            </Text>
            {awaiting.verificationMode === "dev" ? <DevNote code={sent?.devCode} /> : null}
            {awaiting.verificationMode === "dev" && !sent?.devCode ? <Text style={styles.meta}>The dev code is only shown right after sending. Resend to see a new one</Text> : null}
            <Card style={{ padding: 14, marginTop: space.lg, gap: space.sm }}>
              <TextInput
                testID="verification-code"
                accessibilityLabel="6-digit code"
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                placeholderTextColor={colors.subtle}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={6}
                style={[styles.input, { ...type.screenTitle, letterSpacing: 8, textAlign: "center" }]}
              />
              {status.pending ? <Text style={styles.meta}>{status.pending.attemptsLeft} attempts left</Text> : null}
              <Button testID="confirm-code" label="Verify" loading={busy} disabled={code.length !== 6} onPress={() => void check()} />
              <Button testID="resend-code" label="Use a different email or resend" variant="ghost" disabled={busy} onPress={() => { setSent(null); setEditing(true); setCode(""); setError(null); if (status.pending) setEmail(status.pending.email); }} />
            </Card>
          </>
        )}
        {error ? <Notice tone="danger" title="That didn't work" body={error} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function DevNote({ code }: { code?: string }) {
  return (
    <View testID="dev-verification" style={[styles.notice, styles.pending]}>
      <Text style={styles.noticeTitle}>Dev verification</Text>
      <Text style={styles.noticeBody}>
        This deployment runs in email dev mode, so no email is sent and the code is shown here{code ? " and filled in for you" : ""}.
      </Text>
      {code ? <Text testID="dev-code" style={{ ...type.screenTitle, color: colors.ink, letterSpacing: 6 }}>{code}</Text> : null}
    </View>
  );
}
