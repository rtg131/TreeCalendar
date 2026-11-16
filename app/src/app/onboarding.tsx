import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Brand } from "@/components/brand";
import { Button } from "@/components/button";
import { DetailsFields, contactErrorOf, contactOf } from "@/components/details-fields";
import { checkProfessional, ProfessionalFields, professionalErrorOf, professionalOf, type Professional } from "@/components/professional-fields";
import { Icon, type IconName } from "@/components/icon";
import { PasswordField } from "@/components/password-field";
import { Segmented } from "@/components/segmented";
import { SelectChip } from "@/components/select-chip";
import { colors, layout, radius, shadow, space, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { checkContact, type Contact } from "@/convex/lib/contact";
import { accountError, checkPassword, type PasswordErrors } from "@/lib/account";
import { RADIUS_OPTIONS, useDeviceId, useSearchRadius } from "@/lib/device";
import { AREAS, ROLE_DEFAULT_INTERESTS, cityPlace, locateDevice, type Place, type Role } from "@/lib/profile";

const ROLES: { id: Role; icon: IconName; title: string; blurb: string }[] = [
  { id: "student", icon: "graduation-cap", title: "Talent", blurb: "Find hackathons, pitch nights, and the rooms where you get discovered" },
  { id: "investor", icon: "briefcase", title: "Looking for Talent", blurb: "Find student events worth scouting or recruiting at" },
  { id: "host", icon: "ticket", title: "I'm a host", blurb: "Run events for your company and meet the talent who came. Needs a work email" },
];

export default function Onboarding() {
  const deviceId = useDeviceId();
  const existing = useQuery(api.users.get, deviceId ? { deviceId } : "skip");
  const { isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();
  const accountDeviceId = useQuery(api.users.accountDeviceId, isAuthenticated ? {} : "skip");
  const orphanedSession = isAuthenticated && existing === null && (accountDeviceId === null || accountDeviceId === deviceId);

  useEffect(() => {
    if (orphanedSession) void signOut();
  }, [orphanedSession, signOut]);

  if (!deviceId || existing === undefined || orphanedSession) return <ActivityIndicator style={{ flex: 1 }} color={colors.brand} />;
  return <OnboardingForm deviceId={deviceId} existing={existing} />;
}

function OnboardingForm({ deviceId, existing }: { deviceId: string; existing: Doc<"users"> | null }) {
  const catalog = useQuery(api.interests.list);
  const upsert = useMutation(api.users.upsert);
  const { radiusKm, setRadiusKm } = useSearchRadius();
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<Role | null>(existing?.role ?? null);
  const [interests, setInterests] = useState<string[]>(existing?.interests ?? []);
  const [contact, setContact] = useState<Contact>(contactOf(existing));
  const [contactErrors, setContactErrors] = useState<Partial<Contact>>({});
  const [professional, setProfessional] = useState<Professional>(professionalOf(existing));
  const [professionalErrors, setProfessionalErrors] = useState<Partial<Professional>>({});
  const { isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();
  const needsAccount = !isAuthenticated;
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordErrors, setPasswordErrors] = useState<PasswordErrors>({});
  const [customized, setCustomized] = useState(!!existing);
  const [place, setPlace] = useState<Place | null>(
    existing ? { city: existing.city, lat: existing.lat, lng: existing.lng, locationSource: existing.locationSource } : null,
  );
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pickRole = (r: Role) => {
    setRole(r);
    setError(null);
    if (!customized) setInterests(ROLE_DEFAULT_INTERESTS[r]);
  };

  const toggleInterest = (id: string) => {
    setCustomized(true);
    setError(null);
    setInterests((cur) => (cur.includes(id) ? cur.filter((i) => i !== id) : [...cur, id]));
  };

  const editContact = (field: keyof Contact, text: string) => {
    setError(null);
    setContact((cur) => ({ ...cur, [field]: text }));
    setContactErrors((cur) => ({ ...cur, [field]: undefined }));
  };

  const editProfessional = (field: keyof Professional, text: string) => {
    setError(null);
    setProfessional((cur) => ({ ...cur, [field]: text }));
    setProfessionalErrors((cur) => ({ ...cur, [field]: undefined }));
  };

  const editPassword = (field: keyof PasswordErrors, text: string) => {
    setError(null);
    (field === "password" ? setPassword : setConfirm)(text);
    setPasswordErrors((cur) => ({ ...cur, [field]: undefined }));
  };

  const createAccount = async (email: string) => {
    try {
      await signIn("password", { flow: "signUp", email, password, deviceId });
      return true;
    } catch (e) {
      const { code, message } = accountError(e);
      setStep(1);
      if (code === "SIGN_UP_FAILED") setContactErrors({ email: message });
      else if (code === "INVALID_PASSWORD") setPasswordErrors({ password: message });
      setError(code === "SIGN_UP_FAILED" || code === "INVALID_PASSWORD" ? "Check the highlighted details" : message);
      return false;
    }
  };

  const useMyLocation = async () => {
    setLocating(true);
    setError(null);
    const result = await locateDevice();
    setLocating(false);
    if ("error" in result) return setError(result.error);
    setPlace(result.place);
  };

  const finish = async () => {
    const checked = checkContact(contact);
    const pro = role === "student" ? checkProfessional(professional) : null;
    if (!role || !place || "errors" in checked || (pro && "errors" in pro)) return;
    setSaving(true);
    try {
      await upsert({ deviceId, role, interests, ...place, radiusKm, ...checked.values, ...(pro && "values" in pro ? pro.values : {}) });
      if (needsAccount && !(await createAccount(checked.values.email))) return;
      router.replace(role === "host" ? "/host/verify" : "/feed");
    } catch (e) {
      const proError = professionalErrorOf(e);
      const fieldError = proError ? null : contactErrorOf(e);
      if (!fieldError && !proError) return setError("Couldn't save your profile: no connection. Try again");
      if (proError) setProfessionalErrors(proError);
      else if (fieldError) setContactErrors(fieldError);
      setStep(1);
      setError("Check the highlighted details");
    } finally {
      setSaving(false);
    }
  };

  const next = () => {
    if (step === 0 && !role) return setError("Choose Talent, Looking for Talent or I'm a host to continue");
    if (step === 1) {
      const checked = checkContact(contact);
      if ("errors" in checked) {
        setContactErrors(checked.errors);
        return setError("Check the highlighted details");
      }
      setContact(checked.values);
      const pro = role === "student" ? checkProfessional(professional) : null;
      if (pro && "errors" in pro) {
        setProfessionalErrors(pro.errors);
        return setError("Check the highlighted details");
      }
      const pwErrors = needsAccount ? checkPassword(password, confirm) : {};
      if (pwErrors.password || pwErrors.confirm) {
        setPasswordErrors(pwErrors);
        return setError("Check the highlighted details");
      }
      if (interests.length === 0) return setError("Pick at least one interest");
    }
    if (step === 2 && !place) return setError("Use your location or pick an area");
    setError(null);
    if (step < 2) setStep(step + 1);
    else void finish();
  };

  const back = () => {
    setError(null);
    setStep(step - 1);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <Brand />
        <View style={styles.steps} accessibilityLabel={`Step ${step + 1} of 3`}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.step, i <= step && styles.stepOn]} />
          ))}
        </View>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {step === 0 && (
            <>
              <Text style={styles.h1}>Find the rooms where startups happen</Text>
              <Text style={styles.lede}>Hackathons, pitch nights, and demo days near you, ranked for what you care about</Text>
              <View accessibilityRole="radiogroup" accessibilityLabel="I am">
                {ROLES.map((r) => {
                  const on = role === r.id;
                  return (
                    <Pressable
                      key={r.id}
                      testID={`role-${r.id}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      onPress={() => pickRole(r.id)}
                      style={[styles.role, on && styles.roleOn]}
                    >
                      <View style={styles.roleIcon}>
                        <Icon name={r.icon} size={20} color={colors.brand} />
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.roleTitle}>{r.title}</Text>
                        <Text style={styles.roleBlurb}>{r.blurb}</Text>
                      </View>
                      <View style={[styles.radio, on && styles.radioOn]} />
                    </Pressable>
                  );
                })}
              </View>
              {needsAccount ? (
                <Pressable testID="have-account" accessibilityRole="link" onPress={() => router.push("/sign-in")} style={styles.haveAccount} hitSlop={8}>
                  <Text style={styles.haveAccountText}>I already have an account</Text>
                </Pressable>
              ) : null}
            </>
          )}
          {step === 1 && (
            <>
              <Text style={styles.h1}>About you</Text>
              <Text style={styles.lede}>
                {role === "investor"
                  ? "Tell us who's scouting. Your email and phone stay private to you"
                  : role === "host"
                    ? "Tell us who you are. You'll verify a work email next. Your email and phone stay private to you"
                    : "Tell us who you are. Your email and phone stay private to you"}
              </Text>
              <DetailsFields role={role} value={contact} errors={contactErrors} onChange={editContact} testIDPrefix="details" />
              {role === "student" ? <ProfessionalFields value={professional} errors={professionalErrors} onChange={editProfessional} testIDPrefix="details" /> : null}
              {needsAccount ? (
                <>
                  <Text style={styles.section}>Create a password</Text>
                  <Text style={styles.sectionLede}>
                    {"Sign in with your email and this password on any device. Password reset and email verification aren't available yet, so keep it somewhere safe"}
                  </Text>
                  <View style={{ gap: space.md }}>
                    <PasswordField
                      testID="details-password"
                      label="Password"
                      hint="Required"
                      isNew
                      value={password}
                      error={passwordErrors.password}
                      onChange={(t) => editPassword("password", t)}
                    />
                    <PasswordField
                      testID="details-password-confirm"
                      label="Confirm password"
                      hint="Required"
                      isNew
                      value={confirm}
                      error={passwordErrors.confirm}
                      onChange={(t) => editPassword("confirm", t)}
                    />
                  </View>
                </>
              ) : null}
              <Text style={styles.section}>What are you into</Text>
              <Text style={styles.sectionLede}>
                {role === "investor" ? "We'll surface student events in these spaces first" : "Pick a few. Your feed ranks events that match higher"}
              </Text>
              <View style={styles.chips}>
                {catalog === undefined ? <ActivityIndicator color={colors.brand} /> : null}
                {catalog?.map((i) => (
                  <SelectChip
                    key={i.slug}
                    testID={`interest-${i.slug}`}
                    label={i.label}
                    selected={interests.includes(i.slug)}
                    onPress={() => toggleInterest(i.slug)}
                  />
                ))}
              </View>
              <Text style={styles.count}>{interests.length === 0 ? "None selected" : `${interests.length} selected`}</Text>
            </>
          )}
          {step === 2 && (
            <>
              <Text style={styles.h1}>Where should we look</Text>
              <Text style={styles.lede}>Scout launches in the Bay Area. Distances are from this spot</Text>
              <Button
                testID="use-location"
                variant="outline"
                label={locating ? "Finding you" : "Use my location"}
                loading={locating}
                icon={<Icon name="locate" size={18} color={colors.brand} />}
                onPress={useMyLocation}
              />
              {place?.locationSource === "device" ? (
                <View style={styles.located}>
                  <Icon name="check" size={16} color={colors.success} strokeWidth={2} />
                  <Text style={styles.locatedText}>Near {place.city}</Text>
                </View>
              ) : null}
              <Text style={styles.field}>Or pick an area</Text>
              <View style={styles.chips}>
                {AREAS.map((c) => (
                  <SelectChip
                    key={c.name}
                    testID={`city-${c.name}`}
                    label={c.name}
                    selected={place?.locationSource === "city" && place.city === c.name}
                    onPress={() => {
                      setError(null);
                      setPlace(cityPlace(c.name));
                    }}
                  />
                ))}
              </View>
              <Text style={styles.field}>How far will you go</Text>
              <Segmented
                accessibilityLabel="How far will you go"
                options={RADIUS_OPTIONS.map((o) => ({ value: o.km, label: o.label, testID: `radius-${o.km}` }))}
                value={radiusKm}
                onChange={setRadiusKm}
              />
            </>
          )}
        </ScrollView>
        <View style={styles.foot}>
          <Text style={styles.error} accessibilityRole="alert">
            {error ?? ""}
          </Text>
          <Button testID="onboarding-next" label={step < 2 ? "Continue" : "Show my events"} loading={saving} onPress={next} />
          {step > 0 ? <Button testID="onboarding-back" variant="ghost" label="Back" onPress={back} /> : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  head: { paddingHorizontal: layout.screenPadding, paddingTop: space.sm },
  steps: { flexDirection: "row", gap: 4, marginTop: space.md, marginBottom: space.xl },
  step: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.secondary },
  stepOn: { backgroundColor: colors.brand },
  content: { paddingHorizontal: layout.screenPadding, paddingBottom: space.xl },
  h1: { ...type.onboardingTitle, color: colors.ink, marginBottom: space.sm },
  lede: { ...type.body, color: colors.muted, marginBottom: space.xxl },
  role: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
    marginBottom: space.md,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  roleOn: { borderColor: colors.brand, borderWidth: 1.5 },
  roleIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  roleTitle: { ...type.bodyStrong, fontSize: 16, fontWeight: "600", color: colors.ink },
  roleBlurb: { ...type.meta, color: colors.muted },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.lineStrong },
  radioOn: { borderWidth: 6, borderColor: colors.brand },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  section: { ...type.cardTitle, color: colors.ink, marginTop: space.xxl, marginBottom: space.xs },
  sectionLede: { ...type.meta, color: colors.muted, marginBottom: space.md },
  haveAccount: { alignSelf: "center", marginTop: space.lg, paddingVertical: space.sm },
  haveAccountText: { ...type.label, color: colors.brandInk },
  count: { ...type.meta, color: colors.subtle, marginTop: space.lg },
  located: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: 10 },
  locatedText: { ...type.meta, color: colors.success },
  field: { ...type.label, color: colors.muted, marginTop: space.xl, marginBottom: space.sm },
  foot: { paddingHorizontal: layout.screenPadding, paddingBottom: space.md, gap: space.sm },
  error: { ...type.meta, color: colors.danger, minHeight: 18 },
});
