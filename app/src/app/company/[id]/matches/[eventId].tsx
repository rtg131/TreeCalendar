import { useMutation, useQuery } from "convex/react";
import { router, useLocalSearchParams, type ErrorBoundaryProps } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { DEMO_FIXTURES, DemoTalentAccept } from "@/components/connections/demo-talent-accept";
import { InterestSheet } from "@/components/connections/interest-sheet";
import { Card, Notice, Pill, ScreenHeader, SectionTitle, styles } from "@/components/connections/ui";
import { Icon } from "@/components/icon";
import { colors, space } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDeviceId } from "@/lib/device";
import { errorCopy, eventEnded, shortDate } from "@/lib/connections";

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="Talent matches" fallback="/companies" />
      <View style={styles.content}>
        <Notice tone="danger" title="Matches aren't available" body={errorCopy(error)} />
        <Button label="Try again" variant="outline" style={{ marginTop: space.md }} onPress={retry} />
      </View>
    </SafeAreaView>
  );
}

export default function TalentMatchesScreen() {
  const { id, eventId } = useLocalSearchParams<{ id: Id<"companies">; eventId: Id<"events"> }>();
  const deviceId = useDeviceId();
  const data = useQuery(api.hosts.eventMatches, deviceId ? { deviceId, companyId: id, eventId } : "skip");
  const company = useQuery(api.companies.get, deviceId ? { deviceId, companyId: id } : "skip");
  const express = useMutation(api.connections.expressInterestInTalent);
  const [target, setTarget] = useState<{ userId: Id<"users">; name: string } | null>(null);

  if (data === undefined) return <ActivityIndicator style={{ flex: 1, backgroundColor: colors.bg }} color={colors.brand} />;
  const ended = eventEnded(data.event);
  const mutual = data.matches.filter((m) => m.mutual);
  const rest = data.matches.filter((m) => !m.mutual);

  const row = (m: (typeof data.matches)[number], i: number) => {
    const name = m.talent.name ?? "Unnamed talent";
    const pill = m.mutual
      ? { label: "Mutual", tone: "success" as const }
      : m.connection?.status === "pending" && m.connection.initiatedBy === "talent"
        ? { label: "Interested in you", tone: "accent" as const }
        : m.connection?.status === "pending"
          ? { label: "Request sent", tone: "neutral" as const }
          : null;
    return (
      <View key={m.talent.userId} testID={`match-${i}`} style={[styles.row, i > 0 && styles.divider]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`View ${name}'s profile`} onPress={() => router.push({ pathname: "/company/[id]/profile/[userId]", params: { id, userId: m.talent.userId } })} style={styles.inline}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.title}>{name}</Text>
            <Text style={styles.meta} numberOfLines={2}>{[m.talent.affiliation, m.attended ? "Went" : null].filter(Boolean).join(" · ") || "Talent"}</Text>
          </View>
          {pill ? <Pill label={pill.label} tone={pill.tone} /> : null}
          <Icon name="chevron-right" size={16} color={colors.subtle} />
        </Pressable>
        {m.talent.priorRoles ? <Text style={styles.meta} numberOfLines={2}>{m.talent.priorRoles}</Text> : null}
        {m.mutual && m.connection ? (
          <Button testID={`match-chat-${i}`} label="Open chat" variant="outline" style={[styles.small, { alignSelf: "flex-start" }]} onPress={() => router.push({ pathname: "/chat/[id]", params: { id: m.connection!._id } })} />
        ) : m.connection?.status === "pending" && m.connection.initiatedBy === "talent" ? (
          <Button testID={`match-inbox-${i}`} label="Respond in Inbox" variant="outline" style={[styles.small, { alignSelf: "flex-start" }]} onPress={() => router.push("/inbox")} />
        ) : DEMO_FIXTURES && m.connection?.status === "pending" ? (
          <DemoTalentAccept testID={`match-demo-accept-${i}`} connectionId={m.connection._id} />
        ) : !m.connection && m.blockedUntil ? (
          <Text style={styles.meta}>Declined. You can reach out again after {shortDate(m.blockedUntil)}</Text>
        ) : !m.connection && ended ? (
          <Button testID={`match-interested-${i}`} label="Interested" style={[styles.small, { alignSelf: "flex-start" }]} onPress={() => setTarget({ userId: m.talent.userId, name })} />
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="Talent matches" subtitle={data.event.title} fallback="/companies" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.meta, { marginTop: space.md }]}>
          Talent who went to this event or connected with you through it. Tap a name for their prior roles and experience. Contact details appear only once you connect and they choose to share them
        </Text>
        {!ended ? <Notice title="The event hasn't ended" body="You can reach out to talent once it ends" /> : null}
        {mutual.length ? (
          <>
            <SectionTitle>Mutual</SectionTitle>
            <Card>{mutual.map(row)}</Card>
          </>
        ) : null}
        <SectionTitle>{mutual.length ? "Everyone else" : "Talent"}</SectionTitle>
        {rest.length ? <Card>{rest.map(row)}</Card> : <Text style={styles.meta}>{data.matches.length ? "Everyone here is a mutual match" : "No eligible talent yet"}</Text>}
      </ScrollView>
      <InterestSheet
        visible={target !== null}
        title={`Interested in ${target?.name ?? ""}`}
        subtitle={`Sent from ${company?.company.name ?? "your company"}. They'll see your company and this event, and chat opens if they accept`}
        placeholder="Say what stood out, or what role you have in mind"
        submitLabel="Send interest"
        onClose={() => setTarget(null)}
        onSubmit={async (message) => {
          if (!deviceId || !target) return;
          await express({ deviceId, companyId: id, talentUserId: target.userId, eventId, ...(message ? { message } : {}) });
        }}
      />
    </SafeAreaView>
  );
}
