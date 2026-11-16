import { useMutation, useQuery } from "convex/react";
import { router, useLocalSearchParams, type ErrorBoundaryProps } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { InterestSheet } from "@/components/connections/interest-sheet";
import { Card, Notice, Pill, ScreenHeader, SectionTitle, styles } from "@/components/connections/ui";
import { Icon } from "@/components/icon";
import { colors, space } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDeviceId } from "@/lib/device";
import { errorCopy, shortDate } from "@/lib/connections";

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="Talent who went" fallback="/companies" />
      <View style={styles.content}>
        <Notice tone="danger" title="This list isn't available" body={errorCopy(error)} />
        <Button label="Try again" variant="outline" style={{ marginTop: space.md }} onPress={retry} />
      </View>
    </SafeAreaView>
  );
}

const STATUS: Record<string, string> = { pending: "Request open", accepted: "Connected", declined: "Declined", withdrawn: "Withdrawn" };

export default function EventTalentScreen() {
  const { id, eventId } = useLocalSearchParams<{ id: Id<"companies">; eventId: Id<"events"> }>();
  const deviceId = useDeviceId();
  const company = useQuery(api.companies.get, deviceId ? { deviceId, companyId: id } : "skip");
  const event = useQuery(api.events.get, { id: eventId });
  const talent = useQuery(api.connections.eventTalent, deviceId ? { deviceId, companyId: id, eventId } : "skip");
  const express = useMutation(api.connections.expressInterestInTalent);
  const [target, setTarget] = useState<{ userId: Id<"users">; name: string } | null>(null);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="Talent who went" subtitle={event?.title} fallback="/companies" />
      {talent === undefined ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.brand} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.meta, { marginTop: space.md }]}>
            Talent who marked Going before this event ended, or checked in to it. Open a profile for their school, prior roles and experience. Contact details appear only if you connect and they choose to share them
          </Text>
          <SectionTitle>{talent.length ? `${talent.length} went` : "Attendees"}</SectionTitle>
          {talent.length ? (
            <Card>
              {talent.map((t, i) => {
                const name = t.talent.name ?? "Unnamed talent";
                const status = t.connectionStatus;
                const live = status === "pending" || status === "accepted";
                return (
                  <View key={t.talent.userId} testID={`talent-row-${i}`} style={[styles.row, i > 0 && styles.divider]}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`View ${name}'s profile`} onPress={() => router.push({ pathname: "/company/[id]/profile/[userId]", params: { id, userId: t.talent.userId } })} style={styles.inline}>
                      <Text style={[styles.title, { flex: 1 }]}>{name}</Text>
                      {status ? <Pill label={STATUS[status]} tone={status === "accepted" ? "success" : status === "pending" ? "accent" : "neutral"} /> : null}
                      <Icon name="chevron-right" size={16} color={colors.subtle} />
                    </Pressable>
                    {t.blockedUntil ? (
                      <Text style={styles.meta}>Declined. You can reach out again after {shortDate(t.blockedUntil)}</Text>
                    ) : !live ? (
                      <Button testID={`interested-talent-${i}`} label="Interested" style={[styles.small, { alignSelf: "flex-start" }]} onPress={() => setTarget({ userId: t.talent.userId, name })} />
                    ) : null}
                  </View>
                );
              })}
            </Card>
          ) : (
            <Notice title="No eligible attendees yet" body="Talent shows here once they marked Going or checked in to this event before it ended" />
          )}
        </ScrollView>
      )}
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
