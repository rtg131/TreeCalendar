import { useMutation, useQuery } from "convex/react";
import { router, useLocalSearchParams, type ErrorBoundaryProps } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { Card, Notice, PendingVerificationNotice, Pill, ScreenHeader, SectionTitle, styles, VerificationBadge } from "@/components/connections/ui";
import { colors, space } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDeviceId } from "@/lib/device";
import { confirm, errorCopy, eventEnded, shortDate, useIsVerifiedHost } from "@/lib/connections";

type EventSummary = { _id: Id<"events">; title: string; startTime: number; endTime?: number };

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="Company" fallback="/companies" />
      <View style={styles.content}>
        <Notice tone="danger" title="Couldn't load this company" body={errorCopy(error)} />
        <Button label="Try again" variant="outline" style={{ marginTop: space.md }} onPress={retry} />
      </View>
    </SafeAreaView>
  );
}

function useRun() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try { await action(); return true; } catch (e) { setError(errorCopy(e)); return false; } finally { setBusy(null); }
  };
  return { busy, error, run };
}

export default function CompanyScreen() {
  const { id } = useLocalSearchParams<{ id: Id<"companies"> }>();
  const deviceId = useDeviceId();
  const isHost = useIsVerifiedHost();
  const page = useQuery(api.companies.get, deviceId ? { deviceId, companyId: id } : "skip");
  const me = useQuery(api.users.get, deviceId ? { deviceId } : "skip");
  const removeMember = useMutation(api.companies.removeMember);
  const unclaim = useMutation(api.companies.unclaimEvent);
  const { busy, error, run } = useRun();

  if (page === undefined) return <ActivityIndicator style={{ flex: 1, backgroundColor: colors.bg }} color={colors.brand} />;
  if (page === null) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScreenHeader title="Company" fallback="/companies" />
        <View style={styles.content}><Notice title="This company no longer exists" /></View>
      </SafeAreaView>
    );
  }
  const { company, myRole, members, pendingInvites, hostedEvents, joinRequests, pendingClaims } = page;
  const owner = myRole === "owner";
  const member = myRole !== null && isHost === true;

  const leave = async () => {
    if (!deviceId || !me) return;
    if (!await confirm(`Leave ${company.name}?`, "You'll lose access to its inbox and chats. An owner can invite you again", "Leave")) return;
    if (await run("leave", () => removeMember({ deviceId, companyId: company._id, userId: me._id }))) router.replace("/companies");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title={company.name} subtitle={myRole ? (owner ? "You own this company" : "You're a member") : undefined} fallback="/companies" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.inline, { flexWrap: "wrap" }]}>
          <VerificationBadge company={company} />
          {company.website ? (
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(company.website!).catch(() => undefined)}>
              <Text style={[styles.meta, { color: colors.brandInk }]}>{company.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</Text>
            </Pressable>
          ) : null}
        </View>
        {member && !company.verified ? <PendingVerificationNotice /> : null}
        {error ? <Notice tone="danger" title="That didn't work" body={error} /> : null}

        <SectionTitle>Members</SectionTitle>
        <Card>
          {members.map((m, i) => {
            const self = m.userId !== undefined && m.userId === me?._id;
            return (
              <View key={m.userId ?? `${m.name}-${i}`} style={[styles.row, styles.inline, i > 0 && styles.divider]}>
                <Text style={[styles.body, { flex: 1 }]}>{m.name ?? "Unnamed member"}{self ? " (you)" : ""}</Text>
                {m.role ? <Pill label={m.role === "owner" ? "Owner" : "Member"} /> : null}
                {owner && m.role === "member" && m.userId ? (
                  <Button
                    testID={`remove-${m.userId}`}
                    label="Remove"
                    variant="ghost"
                    style={styles.small}
                    loading={busy === m.userId}
                    onPress={async () => {
                      if (deviceId && m.userId && await confirm(`Remove ${m.name ?? "this member"}?`, "They lose access to this company's inbox and chats", "Remove")) await run(m.userId, () => removeMember({ deviceId, companyId: company._id, userId: m.userId! }));
                    }}
                  />
                ) : null}
              </View>
            );
          })}
        </Card>
        {myRole === "member" ? <Button testID="leave-company" label="Leave company" variant="ghost" loading={busy === "leave"} onPress={() => void leave()} /> : null}

        {member && joinRequests?.length ? <JoinRequests companyId={company._id} requests={joinRequests} /> : null}
        {owner ? <Invites companyId={company._id} pending={pendingInvites ?? []} /> : null}
        {member && pendingClaims?.length ? <PendingClaims claims={pendingClaims} /> : null}

        <SectionTitle>Hosted events</SectionTitle>
        {hostedEvents.length ? (
          <Card>
            {hostedEvents.map((e, i) => (
              <View key={e._id} style={[styles.row, i > 0 && styles.divider]}>
                <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/event/[id]", params: { id: e._id } })}>
                  <Text style={styles.title}>{e.title}</Text>
                  <Text style={styles.meta}>{shortDate(e.startTime)} · {eventEnded(e) ? "Ended" : "Upcoming"}</Text>
                </Pressable>
                {member ? (
                  <View style={styles.actions}>
                    {company.verified ? (
                      <Button testID={`matches-${e._id}`} label="Talent matches" variant="outline" style={styles.small} onPress={() => router.push({ pathname: "/company/[id]/matches/[eventId]", params: { id: company._id, eventId: e._id } })} />
                    ) : null}
                    {owner ? <Button testID={`unclaim-${e._id}`} label="Unclaim" variant="ghost" style={styles.small} loading={busy === e._id} onPress={() => deviceId && void run(e._id, () => unclaim({ deviceId, companyId: company._id, eventId: e._id }))} /> : null}
                  </View>
                ) : null}
              </View>
            ))}
          </Card>
        ) : (
          <Text style={styles.meta}>No claimed events yet</Text>
        )}
        {member && company.verified ? <Claimable companyId={company._id} /> : null}
        {member && !company.verified ? <Text style={[styles.meta, { marginTop: space.sm }]}>You can claim events once Scout verifies this company</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Invites({ companyId, pending }: { companyId: Id<"companies">; pending: { email: string; createdAt: number }[] }) {
  const deviceId = useDeviceId();
  const invite = useMutation(api.companies.invite);
  const cancel = useMutation(api.companies.cancelInvite);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useRun();
  const send = async () => {
    if (!deviceId) return;
    setSent(false);
    if (await run("invite", () => invite({ deviceId, companyId, email }))) {
      setEmail("");
      setSent(true);
    }
  };
  return (
    <>
      <SectionTitle>Invite a teammate</SectionTitle>
      <Card style={{ padding: 14, gap: space.sm }}>
        <TextInput testID="invite-email" accessibilityLabel="Teammate's email" value={email} onChangeText={(t) => { setEmail(t); setSent(false); }} placeholder="name@company.com" placeholderTextColor={colors.subtle} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={styles.input} />
        <Button testID="send-invite" label="Send invite" loading={busy === "invite"} disabled={!email.trim()} onPress={() => void send()} />
        {sent ? <Text testID="invite-sent" style={styles.meta}>Invite saved. Whoever has or adds that email on their Scout profile will see it in Companies</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </Card>
      {pending.length ? (
        <>
          <SectionTitle>Pending invites</SectionTitle>
          <Card>
            {pending.map((p, i) => (
              <View key={p.email} style={[styles.row, styles.inline, i > 0 && styles.divider]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.body} numberOfLines={1}>{p.email}</Text>
                  <Text style={styles.meta}>Sent {shortDate(p.createdAt)}</Text>
                </View>
                <Button testID={`cancel-invite-${i}`} label="Cancel" variant="ghost" style={styles.small} loading={busy === p.email} onPress={() => deviceId && void run(p.email, () => cancel({ deviceId, companyId, email: p.email }))} />
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </>
  );
}

function JoinRequests({ companyId, requests }: { companyId: Id<"companies">; requests: { userId: Id<"users">; name: string | null; workEmail: string | null; createdAt: number }[] }) {
  const deviceId = useDeviceId();
  const respondJoin = useMutation(api.companies.respondJoin);
  const { busy, error, run } = useRun();
  return (
    <>
      <SectionTitle>Requests to join</SectionTitle>
      <Card>
        {requests.map((r, i) => (
          <View key={r.userId} testID={`join-request-${i}`} style={[styles.row, i > 0 && styles.divider]}>
            <Text style={styles.title}>{r.name ?? "Unnamed host"}</Text>
            <Text style={styles.meta}>{r.workEmail ? `Work email ${r.workEmail}` : "Work email confirmed"} · {shortDate(r.createdAt)}</Text>
            <View style={styles.actions}>
              <Button testID={`approve-join-${i}`} label="Approve" style={styles.small} loading={busy === r.userId} onPress={() => deviceId && void run(r.userId, () => respondJoin({ deviceId, companyId, userId: r.userId, accept: true }))} />
              <Button testID={`decline-join-${i}`} label="Decline" variant="ghost" style={styles.small} disabled={busy === r.userId} onPress={() => deviceId && void run(r.userId, () => respondJoin({ deviceId, companyId, userId: r.userId, accept: false }))} />
            </View>
          </View>
        ))}
      </Card>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </>
  );
}

function PendingClaims({ claims }: { claims: { claimId: Id<"event_hosts">; event: EventSummary; requestedByName: string | null; createdAt: number; canReview: boolean }[] }) {
  const deviceId = useDeviceId();
  const review = useMutation(api.hosts.reviewClaim);
  const { busy, error, run } = useRun();
  return (
    <>
      <SectionTitle>Hosting claims to review</SectionTitle>
      <Card>
        {claims.map((c, i) => (
          <View key={c.claimId} testID={`pending-claim-${i}`} style={[styles.row, i > 0 && styles.divider]}>
            <Text style={styles.title}>{c.event.title}</Text>
            <Text style={styles.meta}>{c.requestedByName ?? "A teammate"} says your company hosts this · {shortDate(c.event.startTime)}</Text>
            {c.canReview ? <View style={styles.actions}>
              <Button testID={`approve-claim-${i}`} label="Approve" style={styles.small} loading={busy === c.claimId} onPress={() => deviceId && void run(c.claimId, () => review({ deviceId, claimId: c.claimId, approve: true }))} />
              <Button testID={`reject-claim-${i}`} label="Reject" variant="ghost" style={styles.small} disabled={busy === c.claimId} onPress={() => deviceId && void run(c.claimId, () => review({ deviceId, claimId: c.claimId, approve: false }))} />
            </View> : <Text style={styles.meta}>Waiting for a teammate with a verified email at the company&apos;s domain</Text>}
          </View>
        ))}
      </Card>
      <Text style={[styles.meta, { marginTop: space.sm }]}>Only teammates with a verified email at the company&apos;s domain can approve, and not the person who made the claim</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </>
  );
}

function Claimable({ companyId }: { companyId: Id<"companies"> }) {
  const deviceId = useDeviceId();
  const events = useQuery(api.companies.claimable, deviceId ? { deviceId, companyId } : "skip");
  const claim = useMutation(api.companies.claimEvent);
  const { busy, error, run } = useRun();
  return (
    <>
      <SectionTitle>Events listing you as host</SectionTitle>
      {events === undefined ? (
        <ActivityIndicator color={colors.brand} />
      ) : events.length ? (
        <Card>
          {events.map((e: EventSummary, i) => (
            <View key={e._id} style={[styles.row, styles.inline, i > 0 && styles.divider]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{e.title}</Text>
                <Text style={styles.meta}>{shortDate(e.startTime)} · {eventEnded(e) ? "Ended" : "Upcoming"}</Text>
              </View>
              <Button testID={`claim-${e._id}`} label="Claim" variant="outline" style={styles.small} loading={busy === e._id} onPress={() => deviceId && void run(e._id, () => claim({ deviceId, companyId, eventId: e._id }))} />
            </View>
          ))}
        </Card>
      ) : (
        <Text style={styles.meta}>No unclaimed events list this company as host or organizer right now</Text>
      )}
      <Text style={[styles.meta, { marginTop: space.sm }]}>Only events whose listing names this company as host or organizer can be claimed</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </>
  );
}
