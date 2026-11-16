import { useQuery } from "convex/react";
import { router, useLocalSearchParams, type ErrorBoundaryProps } from "expo-router";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { Card, Notice, Pill, ScreenHeader, SectionTitle, styles } from "@/components/connections/ui";
import { colors, layout, space } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDeviceId } from "@/lib/device";
import { errorCopy, shortDate } from "@/lib/connections";

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="Talent profile" />
      <View style={styles.content}>
        <Notice tone="danger" title="This profile isn't available" body={errorCopy(error)} />
        <Button label="Try again" variant="outline" style={{ marginTop: space.md }} onPress={retry} />
      </View>
    </SafeAreaView>
  );
}

export default function TalentProfileScreen() {
  const { id, userId } = useLocalSearchParams<{ id: Id<"companies">; userId: Id<"users"> }>();
  const deviceId = useDeviceId();
  const profile = useQuery(api.connections.talentProfile, deviceId ? { deviceId, companyId: id, talentUserId: userId } : "skip");
  if (profile === undefined) return <ActivityIndicator style={{ flex: 1, backgroundColor: colors.bg }} color={colors.brand} />;
  const { talent, sharedEvents, connection, contact } = profile;
  const contactRows = contact
    ? [
        contact.email ? { label: "Email", value: contact.email, url: `mailto:${contact.email}` } : null,
        contact.phone ? { label: "Phone", value: contact.phone, url: `tel:${contact.phone}` } : null,
        contact.linkedin ? { label: "LinkedIn", value: contact.linkedin, url: contact.linkedin } : null,
      ].filter((r) => r !== null)
    : [];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title={talent.name ?? "Talent"} subtitle={talent.affiliation ?? "Talent"} />
      <ScrollView contentContainerStyle={styles.content}>
        {connection ? (
          <View style={[styles.inline, { marginTop: space.sm }]}>
            <Pill label={connection.status === "accepted" ? "Connected" : connection.initiatedBy === "talent" ? "They reached out" : "Request sent"} tone={connection.status === "accepted" ? "success" : "accent"} />
          </View>
        ) : null}

        <SectionTitle>Prior roles</SectionTitle>
        <Card style={{ padding: layout.cardPadding }}>
          <Text style={[styles.body, !talent.priorRoles && { color: colors.subtle }]}>{talent.priorRoles ?? "Not added"}</Text>
        </Card>
        <SectionTitle>Experience</SectionTitle>
        <Card style={{ padding: layout.cardPadding }}>
          <Text style={[styles.body, !talent.experience && { color: colors.subtle }]}>{talent.experience ?? "Not added"}</Text>
        </Card>

        <SectionTitle>Your events they went to</SectionTitle>
        {sharedEvents.length ? (
          <Card>
            {sharedEvents.map((e, i) => (
              <Pressable key={e._id} accessibilityRole="button" onPress={() => router.push({ pathname: "/event/[id]", params: { id: e._id } })} style={[styles.row, i > 0 && styles.divider]}>
                <Text style={styles.title}>{e.title}</Text>
                <Text style={styles.meta}>{shortDate(e.startTime)}</Text>
              </Pressable>
            ))}
          </Card>
        ) : (
          <Text style={styles.meta}>None listed</Text>
        )}

        <SectionTitle>Contact</SectionTitle>
        {contactRows.length ? (
          <Card testID="talent-contact">
            {contactRows.map((r, i) => (
              <Pressable key={r.label} accessibilityRole="link" onPress={() => Linking.openURL(r.url).catch(() => undefined)} style={[styles.row, styles.inline, i > 0 && styles.divider]}>
                <Text style={[styles.body, { flex: 1 }]}>{r.label}</Text>
                <Text style={[styles.body, { color: colors.brandInk }]} numberOfLines={1}>{r.value}</Text>
              </Pressable>
            ))}
          </Card>
        ) : (
          <Text testID="contact-private" style={styles.meta}>
            {connection?.status === "accepted" ? "Connected, but they haven't chosen to share contact details. Use the chat instead" : "Contact details stay private until you're connected and they choose to share them"}
          </Text>
        )}
        {connection?.status === "accepted" ? (
          <Button testID="profile-open-chat" label="Open chat" style={{ marginTop: space.lg }} onPress={() => router.push({ pathname: "/chat/[id]", params: { id: connection._id } })} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
