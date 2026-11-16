import { useMutation, useQuery } from "convex/react";
import { useLocalSearchParams, type ErrorBoundaryProps } from "expo-router";
import { useRef, useState, type ComponentRef } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { ShareContactToggle } from "@/components/connections/share-contact";
import { Card, Notice, ScreenHeader, styles } from "@/components/connections/ui";
import { colors, layout, radius, space, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDeviceId } from "@/lib/device";
import { CHAT_LIMIT, errorCopy, timeAgo } from "@/lib/connections";

const PAGE = 50;

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="Chat" />
      <View style={styles.content}>
        <Notice tone="danger" title="This chat isn't available" body={errorCopy(error)} />
        <Button label="Try again" variant="outline" style={{ marginTop: space.md }} onPress={retry} />
      </View>
    </SafeAreaView>
  );
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: Id<"connections"> }>();
  const deviceId = useDeviceId();
  const inbox = useQuery(api.connections.inbox, deviceId ? { deviceId } : "skip");
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [pages, setPages] = useState(1);
  const stick = useRef(true);

  if (inbox === undefined) return <ActivityIndicator style={{ flex: 1, backgroundColor: colors.bg }} color={colors.brand} />;
  const asTalent = inbox.talent.connected.find((c) => c._id === id);
  const asCompany = inbox.companies.flatMap((c) => c.connected.map((conn) => ({ ...conn, company: c.company }))).find((c) => c._id === id);
  const title = asTalent ? asTalent.company.name : asCompany ? asCompany.talent.name ?? "Talent" : "Chat";
  const connection = asTalent ?? asCompany;
  const event = connection?.event;
  const requester = connection && (connection.initiatedBy === "talent" ? (asTalent ? "You" : title) : (asCompany ? "You" : title));

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader title={title} subtitle={asCompany ? `For ${asCompany.company.name}${event ? ` · ${event.title}` : ""}` : event?.title} />
      {!asTalent && !asCompany ? (
        <View style={styles.content}>
          <Notice testID="chat-closed" title="This chat has closed" body="The connection was ended, declined or withdrawn, so messages are no longer available" />
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView ref={scroll} contentContainerStyle={{ padding: layout.screenPadding, gap: space.sm }} scrollEventThrottle={100}
            onScroll={(e) => { const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent; stick.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80; }}
            onContentSizeChange={() => { if (stick.current) scroll.current?.scrollToEnd({ animated: false }); }}
          >
            {asTalent ? (
              <Card style={{ padding: layout.cardPadding }}>
                <ShareContactToggle connectionId={asTalent._id} companyName={asTalent.company.name} shareContact={asTalent.shareContact} accepted />
              </Card>
            ) : null}
            {asCompany?.contact ? <ContactCard contact={asCompany.contact} /> : null}
            {asCompany && !asCompany.contact ? <Text style={[styles.meta, { textAlign: "center" }]}>{title} hasn&apos;t shared contact details. Keep the conversation here</Text> : null}
            {connection?.message ? (
              <View testID="chat-request" style={{ alignItems: "center", gap: 2, marginVertical: space.sm }}>
                <Text style={styles.meta}>{requester} reached out{event ? ` after ${event.title}` : ""}</Text>
                <Text style={[styles.quote, { textAlign: "center" }]}>&ldquo;{connection.message}&rdquo;</Text>
              </View>
            ) : null}
            <Pages connectionId={id} depth={pages} onOlder={() => { stick.current = false; setPages((p) => p + 1); }} />
          </ScrollView>
          <Composer connectionId={id} />
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function Pages({ connectionId, before, depth, onOlder }: { connectionId: Id<"connections">; before?: number; depth: number; onOlder: () => void }) {
  const deviceId = useDeviceId();
  const live = useQuery(api.chat.list, deviceId ? { deviceId, connectionId, limit: PAGE, ...(before === undefined ? {} : { before }) } : "skip");
  const [last, setLast] = useState(live);
  if (live !== undefined && live !== last) setLast(live);
  const page = live ?? last;
  if (page === undefined) return <ActivityIndicator color={colors.brand} />;
  return (
    <>
      {page.nextBefore !== null ? (
        depth > 1 ? (
          <Pages connectionId={connectionId} before={page.nextBefore} depth={depth - 1} onOlder={onOlder} />
        ) : (
          <Button testID="load-older" label="Load earlier messages" variant="ghost" onPress={onOlder} />
        )
      ) : before === undefined && page.messages.length === 0 ? (
        <Text style={[styles.meta, { textAlign: "center", marginTop: space.xl }]}>You&apos;re connected. Say hello</Text>
      ) : null}
      {page.messages.map((m) => (
        <View key={m._id} testID="chat-message" style={{ alignItems: m.mine ? "flex-end" : "flex-start" }}>
          <View style={{ maxWidth: "82%", paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, backgroundColor: m.mine ? colors.brand : colors.surface, borderWidth: m.mine ? 0 : 0.5, borderColor: colors.line }}>
            <Text style={{ ...type.body, color: m.mine ? colors.white : colors.ink }}>{m.body}</Text>
          </View>
          <Text style={[styles.meta, { fontSize: 11, marginTop: 2 }]}>{m.mine ? "You" : m.senderName ?? (m.fromTalent ? "Talent" : "Company")} · {timeAgo(m.createdAt)}</Text>
        </View>
      ))}
    </>
  );
}

function Composer({ connectionId }: { connectionId: Id<"connections"> }) {
  const deviceId = useDeviceId();
  const send = useMutation(api.chat.send);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = Array.from(body.trim()).length;
  const over = length > CHAT_LIMIT;
  const submit = async () => {
    if (!deviceId || !length || over) return;
    setBusy(true);
    setError(null);
    try {
      await send({ deviceId, connectionId, body });
      setBody("");
    } catch (e) {
      setError(errorCopy(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ borderTopWidth: 0.5, borderTopColor: colors.line, padding: space.md, gap: 4, backgroundColor: colors.bg }}>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <View style={styles.inline}>
        <TextInput
          testID="chat-input"
          accessibilityLabel="Message"
          placeholder="Write a message"
          placeholderTextColor={colors.subtle}
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={CHAT_LIMIT + 200}
          style={[styles.input, { flex: 1, maxHeight: 120 }]}
        />
        <Button testID="chat-send" label="Send" style={styles.small} loading={busy} disabled={!length || over} onPress={() => void submit()} />
      </View>
      {length > CHAT_LIMIT - 200 ? <Text style={[styles.meta, over && { color: colors.danger }]}>{length}/{CHAT_LIMIT}</Text> : null}
    </View>
  );
}

function ContactCard({ contact }: { contact: { email?: string; phone?: string; linkedin?: string; affiliation?: string } }) {
  const rows = [
    contact.email ? { label: "Email", value: contact.email, url: `mailto:${contact.email}` } : null,
    contact.phone ? { label: "Phone", value: contact.phone, url: `tel:${contact.phone}` } : null,
    contact.linkedin ? { label: "LinkedIn", value: contact.linkedin.replace(/^https:\/\/(www\.)?/, ""), url: contact.linkedin } : null,
    contact.affiliation ? { label: "Affiliation", value: contact.affiliation, url: null } : null,
  ].filter((r) => r !== null);
  if (!rows.length) return null;
  return (
    <Card testID="contact-card">
      <Text style={[styles.meta, { paddingHorizontal: layout.cardPadding, paddingTop: space.md }]}>Shared contact details</Text>
      {rows.map((r) => (
        <Pressable key={r.label} disabled={!r.url} accessibilityRole={r.url ? "link" : "text"} onPress={() => r.url && Linking.openURL(r.url).catch(() => undefined)} style={[styles.row, styles.inline]}>
          <Text style={[styles.body, { flex: 1 }]}>{r.label}</Text>
          <Text style={[styles.body, { color: r.url ? colors.brandInk : colors.muted }]} numberOfLines={1}>{r.value}</Text>
        </Pressable>
      ))}
    </Card>
  );
}
