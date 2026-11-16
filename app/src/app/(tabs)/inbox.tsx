import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { ShareContactToggle } from "@/components/connections/share-contact";
import { Card, Notice, SectionTitle, styles, VerificationBadge } from "@/components/connections/ui";
import { Icon } from "@/components/icon";
import { Segmented } from "@/components/segmented";
import { colors, layout, space, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDeviceId } from "@/lib/device";
import { confirm, errorCopy, timeAgo, useHostStatus } from "@/lib/connections";

type Inbox = FunctionReturnType<typeof api.connections.inbox>;
type TalentConnection = Inbox["talent"]["incoming"][number];
type CompanyConnection = Inbox["companies"][number]["incoming"][number];
type Bucket = "incoming" | "outgoing" | "connected";

const EMPTY: Record<Bucket, string> = {
  incoming: "No requests waiting on you. Companies that hosted events you went to can reach out here",
  outgoing: "Nothing sent yet. Open an event you went to and tap Interested on a host",
  connected: "No connections yet. Chat opens here once a request is accepted",
};

export default function InboxScreen() {
  const deviceId = useDeviceId();
  const host = useHostStatus();
  const inbox = useQuery(api.connections.inbox, deviceId ? { deviceId } : "skip");
  const [bucket, setBucket] = useState<Bucket>("incoming");
  const count = (b: Bucket) => (inbox ? inbox.talent[b].length + inbox.companies.reduce((n, c) => n + c[b].length, 0) : 0);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: layout.screenPadding, paddingVertical: space.md }}>
        <Text style={{ ...type.screenTitle, color: colors.ink, flex: 1 }} accessibilityRole="header">Inbox</Text>
        {host?.verified || host?.role === "host" ? (
          <Pressable testID={host.verified ? "open-companies" : "open-verify"} accessibilityRole="button" onPress={() => router.push(host.verified ? "/companies" : "/host/verify")} style={[styles.inline, { minHeight: layout.tapTarget }]}>
            <Text style={{ ...type.label, color: colors.brandInk }}>{host.verified ? "Companies" : "Verify work email"}</Text>
            <Icon name="chevron-right" size={16} color={colors.brandInk} />
          </Pressable>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: layout.screenPadding }}>
        <Segmented
          accessibilityLabel="Inbox bucket"
          value={bucket}
          onChange={setBucket}
          options={[
            { value: "incoming" as Bucket, label: `Incoming${count("incoming") ? ` ${count("incoming")}` : ""}`, testID: "bucket-incoming" },
            { value: "outgoing" as Bucket, label: `Outgoing${count("outgoing") ? ` ${count("outgoing")}` : ""}`, testID: "bucket-outgoing" },
            { value: "connected" as Bucket, label: `Connected${count("connected") ? ` ${count("connected")}` : ""}`, testID: "bucket-connected" },
          ]}
        />
      </View>
      {inbox === undefined ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.brand} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {inbox.talent[bucket].length ? (
            <>
              {inbox.companies.length ? <SectionTitle>As talent</SectionTitle> : <View style={{ height: space.lg }} />}
              <Card>
                {inbox.talent[bucket].map((c, i) => <TalentRow key={c._id} connection={c} bucket={bucket} first={i === 0} />)}
              </Card>
            </>
          ) : null}
          {inbox.companies.filter((c) => c[bucket].length).map((c) => (
            <View key={c.company._id}>
              <View style={[styles.inline, { marginTop: space.xl, marginBottom: space.sm }]}>
                <Text style={{ ...type.label, color: colors.muted }}>For {c.company.name}</Text>
                <VerificationBadge company={c.company} />
              </View>
              <Card>
                {c[bucket].map((conn, i) => <CompanyRow key={conn._id} companyId={c.company._id} connection={conn} bucket={bucket} first={i === 0} />)}
              </Card>
            </View>
          ))}
          {count(bucket) === 0 ? <Notice testID={`empty-${bucket}`} title={bucket === "incoming" ? "All caught up" : bucket === "outgoing" ? "No pending requests" : "No connections yet"} body={EMPTY[bucket]} /> : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function useActions(connectionId: Id<"connections">) {
  const deviceId = useDeviceId();
  const respond = useMutation(api.connections.respond);
  const withdraw = useMutation(api.connections.withdraw);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    if (!deviceId) return;
    setBusy(true);
    setError(null);
    try { await action(); } catch (e) { setError(errorCopy(e)); } finally { setBusy(false); }
  };
  return {
    busy,
    error,
    accept: () => run(() => respond({ deviceId: deviceId!, connectionId, accept: true })),
    decline: async (name: string) => {
      if (await confirm(`Decline ${name}?`, `They'll see it was declined and can't send you a new request for 30 days.`, "Decline")) await run(() => respond({ deviceId: deviceId!, connectionId, accept: false }));
    },
    withdraw: () => run(() => withdraw({ deviceId: deviceId!, connectionId })),
    block: async (name: string) => {
      if (await confirm(`End and block ${name}?`, `This closes the chat and removes any shared contact details. ${name} can't reach out to you again for 30 days.`, "End and block")) await run(() => respond({ deviceId: deviceId!, connectionId, accept: false }));
    },
  };
}

function RowActions({ bucket, name, connectionId }: { bucket: Bucket; name: string; connectionId: Id<"connections"> }) {
  const a = useActions(connectionId);
  return (
    <>
      <View style={styles.actions}>
        {bucket === "incoming" ? (
          <>
            <Button testID={`accept-${connectionId}`} label="Accept" style={styles.small} loading={a.busy} onPress={() => void a.accept()} />
            <Button testID={`decline-${connectionId}`} label="Decline" variant="ghost" style={styles.small} disabled={a.busy} onPress={() => void a.decline(name)} />
          </>
        ) : bucket === "outgoing" ? (
          <Button testID={`withdraw-${connectionId}`} label="Withdraw" variant="ghost" style={styles.small} loading={a.busy} onPress={() => void a.withdraw()} />
        ) : (
          <>
            <Button testID={`chat-${connectionId}`} label="Open chat" style={styles.small} onPress={() => router.push({ pathname: "/chat/[id]", params: { id: connectionId } })} />
            <Button testID={`block-${connectionId}`} label="End and block" variant="ghost" style={styles.small} disabled={a.busy} onPress={() => void a.block(name)} />
          </>
        )}
      </View>
      {a.error ? <Text accessibilityRole="alert" style={styles.error}>{a.error}</Text> : null}
    </>
  );
}

function Context({ connection, bucket }: { connection: TalentConnection | CompanyConnection; bucket: Bucket }) {
  return (
    <>
      <Text style={styles.meta}>
        {connection.event ? connection.event.title : "Event no longer listed"} · {bucket === "connected" ? "connected" : connection.initiatedBy === "talent" ? "talent reached out" : "company reached out"} {timeAgo(connection.respondedAt ?? connection.createdAt)}
      </Text>
      {connection.message ? <Text style={styles.quote}>&ldquo;{connection.message}&rdquo;</Text> : null}
    </>
  );
}

function TalentRow({ connection, bucket, first }: { connection: TalentConnection; bucket: Bucket; first: boolean }) {
  return (
    <View testID={`talent-connection-${connection._id}`} style={[styles.row, !first && styles.divider]}>
      <View style={styles.inline}>
        <Text style={styles.title}>{connection.company.name}</Text>
        <VerificationBadge company={connection.company} />
      </View>
      <Context connection={connection} bucket={bucket} />
      <RowActions bucket={bucket} name={connection.company.name} connectionId={connection._id} />
      <ShareContactToggle connectionId={connection._id} companyName={connection.company.name} shareContact={connection.shareContact} accepted={connection.status === "accepted"} />
    </View>
  );
}

function CompanyRow({ companyId, connection, bucket, first }: { companyId: Id<"companies">; connection: CompanyConnection; bucket: Bucket; first: boolean }) {
  const name = connection.talent.name ?? "Talent";
  return (
    <View testID={`company-connection-${connection._id}`} style={[styles.row, !first && styles.divider]}>
      <Pressable testID={`profile-${connection._id}`} accessibilityRole="button" accessibilityLabel={`View ${name}'s profile`} onPress={() => router.push({ pathname: "/company/[id]/profile/[userId]", params: { id: companyId, userId: connection.talent.userId } })} style={styles.inline}>
        <Text style={[styles.title, { flex: 1 }]}>{name}</Text>
        <Icon name="chevron-right" size={16} color={colors.subtle} />
      </Pressable>
      <Context connection={connection} bucket={bucket} />
      {bucket === "connected" ? (
        <Text style={styles.meta}>{connection.contact ? "Contact details shared" : "Contact details not shared"}</Text>
      ) : null}
      <RowActions bucket={bucket} name={name} connectionId={connection._id} />
    </View>
  );
}
