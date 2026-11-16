import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Brand } from "@/components/brand";
import { Button } from "@/components/button";
import { PasswordField } from "@/components/password-field";
import { colors, layout, radius, space, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import { CONTACT_LIMITS, checkContactField } from "@/convex/lib/contact";
import { accountError } from "@/lib/account";
import { useDeviceId } from "@/lib/device";

export default function SignIn() {
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const deviceId = useDeviceId();
  const accountDeviceId = useQuery(api.users.accountDeviceId, isAuthenticated ? {} : "skip");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (accountDeviceId && accountDeviceId === deviceId) router.replace("/feed");
  }, [accountDeviceId, deviceId]);

  const submit = async () => {
    const checked = checkContactField("email", email);
    if ("error" in checked || !password) return setError("Enter your email and password");
    setSubmitting(true);
    setError(null);
    try {
      await signIn("password", { flow: "signIn", email: checked.value, password });
    } catch (e) {
      setError(accountError(e).message);
      setSubmitting(false);
    }
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace("/onboarding"));

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <Brand />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.h1} accessibilityRole="header">
            Welcome back
          </Text>
          <Text style={styles.lede}>Sign in to bring your profile, saved events, and check-ins to this device</Text>
          <Text style={styles.label}>Email</Text>
          <TextInput
            testID="sign-in-email"
            accessibilityLabel="Email"
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              setError(null);
            }}
            placeholder="you@school.edu"
            placeholderTextColor={colors.subtle}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            maxLength={CONTACT_LIMITS.email}
            style={[styles.input, error ? styles.inputError : null]}
          />
          <View style={{ marginTop: space.lg }}>
            <PasswordField
              testID="sign-in-password"
              label="Password"
              value={password}
              onSubmit={submit}
              onChange={(t) => {
                setPassword(t);
                setError(null);
              }}
            />
          </View>
          <Text testID="sign-in-error" style={styles.error} accessibilityRole="alert">
            {error ?? ""}
          </Text>
          <Text style={styles.hint}>Forgot your password? Reset isn&apos;t available yet</Text>
        </ScrollView>
        <View style={styles.foot}>
          <Button testID="sign-in-submit" label={submitting ? "Signing in" : "Sign in"} loading={submitting} onPress={submit} />
          <Pressable testID="sign-in-back" accessibilityRole="button" onPress={back} style={styles.backBtn} hitSlop={6}>
            <Text style={styles.backText}>New to Scout? Set up a profile</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  head: { paddingHorizontal: layout.screenPadding, paddingTop: space.sm, marginBottom: space.xl },
  content: { paddingHorizontal: layout.screenPadding, paddingBottom: space.xl },
  h1: { ...type.onboardingTitle, color: colors.ink, marginBottom: space.sm },
  lede: { ...type.body, color: colors.muted, marginBottom: space.xxl },
  label: { ...type.label, color: colors.muted, marginBottom: space.xs },
  input: {
    ...type.body,
    color: colors.ink,
    height: 48,
    paddingHorizontal: 12,
    borderRadius: radius.input,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  inputError: { borderColor: colors.danger },
  error: { ...type.meta, color: colors.danger, minHeight: 18, marginTop: space.md },
  hint: { ...type.meta, color: colors.subtle, marginTop: space.xs },
  foot: { paddingHorizontal: layout.screenPadding, paddingBottom: space.md, gap: space.sm },
  backBtn: { alignSelf: "center", paddingVertical: space.sm },
  backText: { ...type.label, color: colors.brandInk },
});
