import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { AttendanceHistory } from "@/components/attendance";
import { DetailsFields, affiliationLabel, contactErrorOf, contactOf } from "@/components/details-fields";
import { checkProfessional, ProfessionalFields, professionalErrorOf, professionalOf, type Professional } from "@/components/professional-fields";
import { Icon } from "@/components/icon";
import { Segmented } from "@/components/segmented";
import { SelectChip } from "@/components/select-chip";
import { colors, layout, radius, shadow, space, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { checkContact, type Contact } from "@/convex/lib/contact";
import { DEFAULT_RADIUS_KM, RADIUS_OPTIONS, useDevice, useDeviceId } from "@/lib/device";
import { AREAS, cityPlace, locateDevice, type Place, type Role } from "@/lib/profile";

type User = Doc<"users">;

export default function ProfileScreen() {
  const deviceId = useDeviceId();
  const user = useQuery(api.users.get, deviceId ? { deviceId } : "skip");

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Text style={styles.title} accessibilityRole="header">
        Profile
      </Text>
      {user === undefined ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.brand} />
      ) : user === null ? (
        <View style={styles.missing}>
          <Text style={styles.body}>No profile on this device yet</Text>
          <Button label="Set up Scout" onPress={() => router.replace("/onboarding")} />
        </View>
      ) : (
        <ProfileForm user={user} />
      )}
    </SafeAreaView>
  );
}

function ProfileForm({ user }: { user: User }) {
  const catalog = useQuery(api.interests.list);
  const upsert = useMutation(api.users.upsert);
  const [editingInterests, setEditingInterests] = useState(false);
  const [draft, setDraft] = useState<string[]>(user.interests);
  const { isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();
  const { reset } = useDevice();
  const [signingOut, setSigningOut] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [details, setDetails] = useState<Contact>(contactOf(user));
  const [detailErrors, setDetailErrors] = useState<Partial<Contact>>({});
  const [professional, setProfessional] = useState<Professional>(professionalOf(user));
  const [professionalErrors, setProfessionalErrors] = useState<Partial<Professional>>({});
  const [areaOpen, setAreaOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  const flash = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2500);
  };

  const save = async (patch: Partial<{ role: Role; interests: string[]; radiusKm: number } & Place & Contact & Professional>, done: string) => {
    setError(null);
    try {
      await upsert({
        deviceId: user.deviceId,
        role: user.role,
        interests: user.interests,
        city: user.city,
        lat: user.lat,
        lng: user.lng,
        locationSource: user.locationSource,
        ...patch,
      });
      flash(done);
      return true;
    } catch (e) {
      const proError = professionalErrorOf(e);
      const fieldError = proError ? null : contactErrorOf(e);
      if (proError) setProfessionalErrors(proError);
      if (fieldError) setDetailErrors(fieldError);
      setError(fieldError || proError ? "Check the highlighted details" : "Couldn't save: no connection. Try again");
      return false;
    }
  };

  const labelFor = (slug: string) => catalog?.find((i) => i.slug === slug)?.label ?? slug;

  const saveInterests = async () => {
    if (draft.length === 0) return setError("Pick at least one interest");
    if (await save({ interests: draft }, "Interests saved")) setEditingInterests(false);
  };

  const saveDetails = async () => {
    const checked = checkContact(details);
    const pro = user.role === "student" ? checkProfessional(professional) : null;
    if ("errors" in checked || (pro && "errors" in pro)) {
      if ("errors" in checked) setDetailErrors(checked.errors);
      if (pro && "errors" in pro) setProfessionalErrors(pro.errors);
      return setError("Check the highlighted details");
    }
    if (await save({ ...checked.values, ...(pro && "values" in pro ? pro.values : {}) }, "Details saved")) setEditingDetails(false);
  };

  const detailRows = [
    { label: "Name", value: user.name },
    { label: "Email", value: user.email },
    { label: "Phone", value: user.phone },
    { label: affiliationLabel(user.role), value: user.affiliation },
    { label: "LinkedIn", value: user.linkedin?.replace(/^https:\/\/www\./, "") },
    ...(user.role === "student" ? [{ label: "Prior roles", value: user.priorRoles }, { label: "Experience", value: user.experience }] : []),
  ];

  const signOutHere = async () => {
    setSigningOut(true);
    try {
      await signOut();
      await reset();
      router.replace("/onboarding");
    } catch {
      setError("Couldn't sign out: no connection. Try again");
      setSigningOut(false);
    }
  };

  const useMyLocation = async () => {
    setLocating(true);
    const result = await locateDevice();
    setLocating(false);
    if ("error" in result) return setError(result.error);
    if (await save(result.place, `Area set to near ${result.place.city}`)) setAreaOpen(false);
  };

  const pickArea = async (name: string) => {
    const place = cityPlace(name);
    if (place && (await save(place, `Area set to ${name}`))) setAreaOpen(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.group}>I am</Text>
      <Segmented
        accessibilityLabel="Role"
        options={[
          { value: "student" as Role, label: "Talent", testID: "profile-role-student" },
          { value: "investor" as Role, label: "Looking for Talent", testID: "profile-role-investor" },
          { value: "host" as Role, label: "Host", testID: "profile-role-host" },
        ]}
        value={user.role}
        onChange={(role) => {
          if (role !== user.role)
            void save({ role }, role === "investor" ? "Looking for Talent on. Your feed now scouts student events" : role === "host" ? "Host mode on. Verify a work email from Inbox to use company features" : "Talent mode on");
        }}
      />

      <Text style={styles.group}>Your details</Text>
      {editingDetails ? (
        <>
          <DetailsFields
            role={user.role}
            value={details}
            errors={detailErrors}
            testIDPrefix="profile-details"
            onChange={(field, text) => {
              setError(null);
              setDetails((cur) => ({ ...cur, [field]: text }));
              setDetailErrors((cur) => ({ ...cur, [field]: undefined }));
            }}
          />
          {user.role === "student" ? (
            <ProfessionalFields
              value={professional}
              errors={professionalErrors}
              testIDPrefix="profile-details"
              onChange={(field, text) => {
                setError(null);
                setProfessional((cur) => ({ ...cur, [field]: text }));
                setProfessionalErrors((cur) => ({ ...cur, [field]: undefined }));
              }}
            />
          ) : null}
          <View style={styles.row}>
            <Button
              variant="ghost"
              label="Cancel"
              style={{ flex: 1 }}
              onPress={() => {
                setDetails(contactOf(user));
                setDetailErrors({});
                setProfessional(professionalOf(user));
                setProfessionalErrors({});
                setEditingDetails(false);
                setError(null);
              }}
            />
            <Button testID="save-details" label="Save details" style={{ flex: 2 }} onPress={saveDetails} />
          </View>
        </>
      ) : (
        <>
          <View style={styles.card} testID="profile-details">
            {detailRows.map((r, i) => (
              <View key={r.label} style={[styles.prow, i > 0 && styles.divider]}>
                <Text style={styles.body}>{r.label}</Text>
                <Text style={[styles.value, styles.detailValue, !r.value && styles.empty]} numberOfLines={1}>
                  {r.value || "Not added"}
                </Text>
              </View>
            ))}
          </View>
          <Text style={styles.privacy}>Only you can see your email, phone, and LinkedIn, unless you choose to share them with a company you&apos;ve connected with</Text>
          <Button
            testID="edit-details"
            variant="outline"
            label={user.name ? "Edit details" : "Add your details"}
            style={{ marginTop: space.md }}
            onPress={() => {
              setDetails(contactOf(user));
              setDetailErrors({});
              setProfessional(professionalOf(user));
              setProfessionalErrors({});
              setEditingDetails(true);
            }}
          />
        </>
      )}

      <Text style={styles.group}>Interests</Text>
      {editingInterests ? (
        <>
          <View style={styles.chips}>
            {catalog?.map((i) => (
              <SelectChip
                key={i.slug}
                testID={`profile-interest-${i.slug}`}
                label={i.label}
                selected={draft.includes(i.slug)}
                onPress={() => setDraft((cur) => (cur.includes(i.slug) ? cur.filter((s) => s !== i.slug) : [...cur, i.slug]))}
              />
            ))}
          </View>
          <View style={styles.row}>
            <Button
              variant="ghost"
              label="Cancel"
              style={{ flex: 1 }}
              onPress={() => {
                setDraft(user.interests);
                setEditingInterests(false);
                setError(null);
              }}
            />
            <Button testID="save-interests" label="Save interests" style={{ flex: 2 }} onPress={saveInterests} />
          </View>
        </>
      ) : (
        <>
          <View style={styles.chips}>
            {user.interests.map((slug) => (
              <View key={slug} style={styles.tag}>
                <Text style={styles.tagText}>{labelFor(slug)}</Text>
              </View>
            ))}
          </View>
          <Button
            testID="edit-interests"
            variant="outline"
            label="Edit interests"
            style={{ marginTop: space.md }}
            onPress={() => {
              setDraft(user.interests);
              setEditingInterests(true);
            }}
          />
        </>
      )}

      <Text style={styles.group}>Location</Text>
      <View style={styles.card}>
        <Pressable
          testID="profile-area"
          accessibilityRole="button"
          accessibilityState={{ expanded: areaOpen }}
          onPress={() => setAreaOpen(!areaOpen)}
          style={styles.prow}
        >
          <Text style={styles.body}>Area</Text>
          <Text style={styles.value}>{user.locationSource === "device" ? `Near ${user.city}` : user.city}</Text>
          <Icon name={areaOpen ? "chevron-left" : "chevron-right"} size={16} color={colors.subtle} />
        </Pressable>
        {areaOpen ? (
          <View style={styles.areaPicker}>
            <Button
              testID="profile-use-location"
              variant="outline"
              label={locating ? "Finding you" : "Use my location"}
              loading={locating}
              icon={<Icon name="locate" size={18} color={colors.brand} />}
              onPress={useMyLocation}
            />
            <View style={styles.chips}>
              {AREAS.map((c) => (
                <SelectChip
                  key={c.name}
                  testID={`profile-city-${c.name}`}
                  label={c.name}
                  selected={user.locationSource === "city" && user.city === c.name}
                  onPress={() => void pickArea(c.name)}
                />
              ))}
            </View>
          </View>
        ) : null}
        <View style={[styles.prow, styles.divider]}>
          <Text style={styles.body}>Distance</Text>
        </View>
        <View style={{ paddingHorizontal: layout.cardPadding, paddingBottom: layout.cardPadding }}>
          <Segmented
            accessibilityLabel="Distance"
            options={RADIUS_OPTIONS.map((o) => ({ value: o.km, label: o.label, testID: `profile-radius-${o.km}` }))}
            value={user.radiusKm ?? DEFAULT_RADIUS_KM}
            onChange={(radiusKm) => void save({ radiusKm }, "Distance updated")}
          />
        </View>
      </View>

      <Text style={styles.group}>Friends</Text>
      <FriendsEntry />

      <AttendanceHistory />
      <Text style={styles.group}>Missing an event</Text>
      <View style={styles.card}>
        <Pressable testID="profile-add-event" accessibilityRole="button" onPress={() => router.push("/submit")} style={styles.prow}>
          <Text style={styles.body}>Add an event by link</Text>
          <Icon name="chevron-right" size={16} color={colors.subtle} />
        </Pressable>
      </View>

      <Text style={styles.error} accessibilityRole="alert">
        {error ?? ""}
      </Text>
      {notice ? (
        <View style={styles.notice} accessibilityLiveRegion="polite">
          <Icon name="check" size={16} color={colors.success} strokeWidth={2} />
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      <Text style={styles.group}>Account</Text>
      <View style={[styles.card, styles.accountCard]} testID="profile-account">
        <Text style={styles.body}>{isAuthenticated ? `Signed in as ${user.email ?? "your account"}` : "No account on this device"}</Text>
        <Text style={styles.accountHint}>
          {isAuthenticated
            ? "Signing out removes your profile from this device. Sign back in with your email and password to restore it"
            : "Start onboarding over to set a password, or sign in to an account you already have"}
        </Text>
        {isAuthenticated ? (
          <Button testID="sign-out" variant="outline" label="Sign out" loading={signingOut} onPress={signOutHere} />
        ) : (
          <Button testID="profile-sign-in" variant="outline" label="Sign in to an existing account" onPress={() => router.push("/sign-in")} />
        )}
      </View>

      <Button testID="restart-onboarding" variant="ghost" label="Start onboarding over" onPress={() => router.push("/onboarding")} />
    </ScrollView>
  );
}

function FriendsEntry() {
  const deviceId = useDeviceId();
  const list = useQuery(api.friends.list, deviceId ? { deviceId } : "skip");
  const incoming = list?.incoming.length ?? 0;
  const summary = !list ? "" : incoming ? `${incoming} new request${incoming === 1 ? "" : "s"}` : list.friends.length ? `${list.friends.length} friend${list.friends.length === 1 ? "" : "s"}` : "Add by code";
  return (
    <View style={styles.card}>
      <Pressable testID="profile-friends" accessibilityRole="button" accessibilityLabel={`Friends${summary ? `, ${summary}` : ""}`} onPress={() => router.push("/friends")} style={styles.prow}>
        <Text style={styles.body}>See which events your friends are going to</Text>
        {summary ? <Text style={[styles.value, incoming ? { color: colors.brandInk } : null]}>{summary}</Text> : null}
        <Icon name="chevron-right" size={16} color={colors.subtle} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  title: { ...type.screenTitle, color: colors.ink, paddingHorizontal: layout.screenPadding, paddingVertical: space.md },
  missing: { flex: 1, padding: layout.screenPadding, gap: space.lg, justifyContent: "center" },
  content: { paddingHorizontal: layout.screenPadding, paddingBottom: space.xxxl },
  group: { ...type.label, color: colors.muted, marginTop: space.xl, marginBottom: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  row: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  tag: { height: 28, paddingHorizontal: 10, borderRadius: radius.tag, backgroundColor: colors.secondary, justifyContent: "center" },
  tagText: { ...type.meta, color: colors.ink },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, ...shadow.card },
  prow: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: layout.tapTarget + 4, paddingHorizontal: layout.cardPadding },
  divider: { borderTopWidth: 0.5, borderTopColor: colors.line },
  areaPicker: { paddingHorizontal: layout.cardPadding, paddingBottom: layout.cardPadding, gap: space.md },
  body: { ...type.body, color: colors.ink, flex: 1 },
  value: { ...type.body, color: colors.muted, paddingVertical: space.md },
  detailValue: { flexShrink: 1, maxWidth: "65%", textAlign: "right" },
  empty: { color: colors.subtle },
  privacy: { ...type.meta, color: colors.subtle, marginTop: space.sm },
  accountCard: { padding: layout.cardPadding, gap: space.sm, marginBottom: space.md },
  accountHint: { ...type.meta, color: colors.muted },
  error: { ...type.meta, color: colors.danger, minHeight: 18, marginTop: space.md },
  notice: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.sm },
  noticeText: { ...type.meta, color: colors.ink },
});
