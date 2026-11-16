import { useMutation, useQuery } from "convex/react";
import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/button";
import { InterestSheet } from "@/components/connections/interest-sheet";
import { Card, Notice, Pill, SectionTitle, styles, VerificationBadge } from "@/components/connections/ui";
import { layout } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDeviceId } from "@/lib/device";
import { errorCopy, eventEnded, isPendingVerification, shortDate, useIsVerifiedHost } from "@/lib/connections";

type Company = { _id: Id<"companies">; name: string; verified?: boolean };

export function EventConnections({ event }: { event: { _id: Id<"events">; title: string; startTime: number; endTime?: number } }) {
  const deviceId = useDeviceId();
  const isHost = useIsVerifiedHost();
  const ended = eventEnded(event);
  const discover = useQuery(api.connections.discover, deviceId && ended ? { deviceId } : "skip");
  const hosts = discover?.find((d) => d.event._id === event._id)?.companies ?? [];
  if (!hosts.length && !isHost) return null;
  return (
    <View testID="event-connections" style={{ marginHorizontal: layout.screenPadding }}>
      {hosts.length ? (
        <>
          <SectionTitle>Connect with the hosts</SectionTitle>
          <Card>
            {hosts.map((h, i) => (
              <HostRow key={h.company._id} eventId={event._id} eventTitle={event.title} company={h.company} status={h.connectionStatus} blockedUntil={h.blockedUntil} first={i === 0} />
            ))}
          </Card>
          <Text style={[styles.meta, { marginTop: 6 }]}>You went to this event, so you can tell its hosts you&apos;re interested. Chat opens when they accept</Text>
        </>
      ) : null}
      {isHost ? <HostingSlot eventId={event._id} ended={ended} /> : null}
    </View>
  );
}

function HostRow({ eventId, eventTitle, company, status, blockedUntil, first }: { eventId: Id<"events">; eventTitle: string; company: Company; status: string | null; blockedUntil: number | null; first: boolean }) {
  const deviceId = useDeviceId();
  const express = useMutation(api.connections.expressInterest);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const live = status === "pending" || status === "accepted";
  return (
    <View style={[styles.row, !first && styles.divider]}>
      <View style={styles.inline}>
        <Text style={styles.title}>{company.name}</Text>
        <VerificationBadge company={company} />
      </View>
      {status === "accepted" ? (
        <Button testID={`open-inbox-${company._id}`} label="Connected · Open Inbox" variant="outline" style={styles.small} onPress={() => router.push("/inbox")} />
      ) : status === "pending" ? (
        <Text style={styles.meta}>{sent ?? "Interest sent. Waiting for a reply. Manage it in Inbox"}</Text>
      ) : blockedUntil ? (
        <Text style={styles.meta}>This connection was declined. You can reach out again after {shortDate(blockedUntil)}</Text>
      ) : isPendingVerification(company) ? (
        <Text style={styles.meta}>This company is pending verification by Scout, so it can&apos;t receive interest yet</Text>
      ) : !live ? (
        <Button testID={`interested-${company._id}`} label={`Interested in ${company.name}`} style={styles.small} onPress={() => setOpen(true)} />
      ) : null}
      <InterestSheet
        visible={open}
        title={`Interested in ${company.name}`}
        subtitle={`They'll see your name, that you went to ${eventTitle}, and your profile (school, prior roles, experience). Your email, phone and LinkedIn stay private unless you choose to share them after you connect`}
        placeholder="Add a short note, like what caught your eye"
        submitLabel="Send interest"
        onClose={() => setOpen(false)}
        onSubmit={async (message) => {
          if (!deviceId) return;
          const result = await express({ deviceId, companyId: company._id, eventId, ...(message ? { message } : {}) });
          setSent(result.status === "accepted" ? "They were already interested in you. You're connected" : "Interest sent. Waiting for a reply. Manage it in Inbox");
        }}
      />
    </View>
  );
}

function HostingSlot({ eventId, ended }: { eventId: Id<"events">; ended: boolean }) {
  const deviceId = useDeviceId();
  const status = useQuery(api.hosts.hostingStatus, deviceId ? { deviceId, eventId } : "skip");
  const mine = useQuery(api.companies.mine, deviceId ? { deviceId } : "skip");
  const claimHosting = useMutation(api.hosts.claimHosting);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!status || !mine) return null;
  const verified = mine.memberships.filter((m) => m.company.verified);
  const claimed = status.claim ? verified.find((m) => m.company._id === status.claim!.companyId)?.company : undefined;
  if (!status.claim && !status.canClaim) return null;
  const claim = async (companyId: Id<"companies">) => {
    if (!deviceId) return;
    setBusy(companyId);
    setError(null);
    try {
      await claimHosting({ deviceId, eventId, companyId });
    } catch (e) {
      setError(errorCopy(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <SectionTitle>Hosting</SectionTitle>
      {status.claim?.status === "approved" && claimed ? (
        <Card testID="hosting-approved" style={{ padding: 14, gap: 8 }}>
          <View style={styles.inline}>
            <Pill label="You host this" tone="success" />
            <Text style={styles.meta}>as {claimed.name}</Text>
          </View>
          <Button
            testID="talent-matches"
            label="Talent matches"
            variant="outline"
            onPress={() => router.push({ pathname: "/company/[id]/matches/[eventId]", params: { id: claimed._id, eventId } })}
          />
          {!ended ? <Text style={styles.meta}>Talent who went show up here once the event ends</Text> : null}
        </Card>
      ) : status.claim?.status === "pending" ? (
        <Notice testID="hosting-pending" tone="pending" title="Hosting claim pending" body={`This listing doesn't name ${claimed?.name ?? "your company"} or link to your company's domain, so another verified teammate or Scout needs to approve it`} />
      ) : null}
      {status.canClaim && status.claim?.status !== "approved" ? (
        verified.filter((m) => m.company._id !== status.claim?.companyId).map((m) => (
          <Button
            key={m.company._id}
            testID={`claim-hosting-${m.company._id}`}
            label={verified.length > 1 ? `I'm hosting this event as ${m.company.name}` : "I'm hosting this event"}
            variant="outline"
            style={{ marginTop: 8 }}
            loading={busy === m.company._id}
            onPress={() => void claim(m.company._id)}
          />
        ))
      ) : null}
      {error ? <Text accessibilityRole="alert" style={[styles.error, { marginTop: 6 }]}>{error}</Text> : null}
    </>
  );
}
