import { useMutation, useQuery } from "convex/react";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { Card, Notice, ScreenHeader, SectionTitle, styles, VerificationBadge } from "@/components/connections/ui";
import { Icon } from "@/components/icon";
import { colors, space } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDeviceId } from "@/lib/device";
import { errorCode, errorCopy, useHostStatus } from "@/lib/connections";

const openCompany = (id: Id<"companies">) => router.push({ pathname: "/company/[id]", params: { id } });

export default function CompaniesScreen() {
  const deviceId = useDeviceId();
  const status = useHostStatus();
  const isHost = status === undefined ? undefined : status.verified;
  const mine = useQuery(api.companies.mine, deviceId && isHost ? { deviceId } : "skip");

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="Companies" />
      {isHost === false ? (
        <View style={styles.content}>
          <Notice testID="host-required" title="For verified hosts" body="Company features are for hosts with a verified work email. Switch to Host in Profile, then verify your work email" />
          {status?.role === "host" ? <Button testID="verify-work-email" label="Verify work email" style={{ marginTop: space.md }} onPress={() => router.push("/host/verify")} /> : null}
        </View>
      ) : mine === undefined ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.brand} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {mine.invites.length ? (
            <>
              <SectionTitle>Invites</SectionTitle>
              <Card>
                {mine.invites.map((inv, i) => <InviteRow key={inv.company._id} invite={inv} first={i === 0} />)}
              </Card>
            </>
          ) : null}
          <DomainCompany />
          <SectionTitle>Your companies</SectionTitle>
          {mine.memberships.length ? (
            <Card>
              {mine.memberships.map((m, i) => (
                <Pressable key={m.company._id} testID={`company-${m.company.slug}`} accessibilityRole="button" onPress={() => openCompany(m.company._id)} style={[styles.row, styles.inline, i > 0 && styles.divider]}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={styles.inline}>
                      <Text style={styles.title}>{m.company.name}</Text>
                      <VerificationBadge company={m.company} />
                    </View>
                    <Text style={styles.meta}>{m.role === "owner" ? "Owner" : "Member"}</Text>
                  </View>
                  <Icon name="chevron-right" size={16} color={colors.subtle} />
                </Pressable>
              ))}
            </Card>
          ) : (
            <Text style={styles.meta}>You&apos;re not part of a company yet. Create one, or ask a teammate to invite the email on your profile</Text>
          )}
          <CreateCompany />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function InviteRow({ invite, first }: { invite: { company: { _id: Id<"companies">; name: string; verified: boolean }; invitedByName: string | null }; first: boolean }) {
  const deviceId = useDeviceId();
  const respond = useMutation(api.companies.respondInvite);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = async (accept: boolean) => {
    if (!deviceId) return;
    setBusy(true);
    setError(null);
    try {
      await respond({ deviceId, companyId: invite.company._id, accept });
      if (accept) openCompany(invite.company._id);
    } catch (e) {
      setError(errorCopy(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View testID={`invite-${invite.company._id}`} style={[styles.row, !first && styles.divider]}>
      <View style={styles.inline}>
        <Text style={styles.title}>{invite.company.name}</Text>
        <VerificationBadge company={invite.company} />
      </View>
      <Text style={styles.meta}>{invite.invitedByName ? `${invite.invitedByName} invited the email on your profile` : "You were invited by email"}</Text>
      <View style={styles.actions}>
        <Button testID="accept-invite" label="Join" style={styles.small} loading={busy} onPress={() => void answer(true)} />
        <Button testID="decline-invite" label="Decline" variant="ghost" style={styles.small} disabled={busy} onPress={() => void answer(false)} />
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function DomainCompany() {
  const deviceId = useDeviceId();
  const found = useQuery(api.companies.forMyDomain, deviceId ? { deviceId } : "skip");
  const requestJoin = useMutation(api.companies.requestJoin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!found || found.membership) return null;
  const ask = async () => {
    if (!deviceId) return;
    setBusy(true);
    setError(null);
    try { await requestJoin({ deviceId, companyId: found.company._id }); } catch (e) { setError(errorCopy(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <SectionTitle>Your company is on Scout</SectionTitle>
      <Card testID="domain-company" style={{ padding: 14, gap: space.sm }}>
        <View style={styles.inline}>
          <Text style={styles.title}>{found.company.name}</Text>
          <VerificationBadge company={found.company} />
        </View>
        <Text style={styles.meta}>It matches your verified work email domain. A current member approves new teammates</Text>
        {found.requested ? (
          <Text testID="join-requested" style={styles.meta}>Request sent. You&apos;ll see the company here once a member approves it</Text>
        ) : (
          <Button testID="request-join" label={`Ask to join ${found.company.name}`} loading={busy} onPress={() => void ask()} />
        )}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </Card>
    </>
  );
}

function CreateCompany() {
  const deviceId = useDeviceId();
  const create = useMutation(api.companies.create);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [logo, setLogo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <Button testID="new-company" label="Create a company" variant="outline" style={{ marginTop: space.lg }} onPress={() => setOpen(true)} />;
  const submit = async () => {
    if (!deviceId) return;
    setBusy(true);
    setError(null);
    try {
      const id = await create({ deviceId, name, ...(website.trim() ? { website } : {}), ...(logo.trim() ? { logo } : {}) });
      setOpen(false);
      setName(""); setWebsite(""); setLogo("");
      openCompany(id);
    } catch (e) {
      setError(errorCode(e) === "domain_taken" ? "Your company is already on Scout. Ask to join it above instead" : errorCopy(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SectionTitle>New company</SectionTitle>
      <Card style={{ padding: 14 }}>
        <Text style={[styles.label, { marginTop: 0 }]}>Name</Text>
        <TextInput testID="company-name" accessibilityLabel="Company name" value={name} onChangeText={setName} placeholder="As it appears on event listings" placeholderTextColor={colors.subtle} maxLength={80} style={styles.input} />
        <Text style={styles.label}>Website</Text>
        <TextInput testID="company-website" accessibilityLabel="Website" value={website} onChangeText={setWebsite} placeholder="acme.dev" placeholderTextColor={colors.subtle} autoCapitalize="none" keyboardType="url" style={styles.input} />
        <Text style={styles.label}>Logo URL (optional)</Text>
        <TextInput testID="company-logo" accessibilityLabel="Logo URL" value={logo} onChangeText={setLogo} placeholder="https://…/logo.png" placeholderTextColor={colors.subtle} autoCapitalize="none" keyboardType="url" style={styles.input} />
        <Text style={[styles.meta, { marginTop: space.md }]}>Companies on your verified work domain are verified right away. School and other academic addresses need a review by Scout before the company can claim events or reach talent. You&apos;ll be the owner</Text>
        {error ? <Text accessibilityRole="alert" style={[styles.error, { marginTop: space.sm }]}>{error}</Text> : null}
        <View style={[styles.actions, { marginTop: space.md }]}>
          <Button label="Cancel" variant="ghost" style={{ flex: 1 }} disabled={busy} onPress={() => setOpen(false)} />
          <Button testID="create-company" label="Create company" style={{ flex: 2 }} loading={busy} disabled={name.trim().length < 2} onPress={() => void submit()} />
        </View>
      </Card>
    </>
  );
}
