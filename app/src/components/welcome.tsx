import { useEvent } from "expo";
import { LinearGradient } from "expo-linear-gradient";
import { useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { AccessibilityInfo, AppState, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { colors, radius, type } from "@/constants/theme";

const poster = require("../../assets/welcome/poster.jpg");
const video = require("../../assets/welcome/collaboration.mp4");

export function Welcome({ onGetStarted, onSignIn }: { onGetStarted: () => void; onSignIn: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");
  const [reduceMotion, setReduceMotion] = useState(true);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const canPlay = focused && active && !reduceMotion && !paused && !failed && !leaving;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    const state = AppState.addEventListener("change", (next) => setActive(next === "active"));
    return () => {
      mounted = false;
      motion.remove();
      state.remove();
    };
  }, []);

  const compact = width < 360 || height < 700;

  return (
    <View style={styles.screen} testID="welcome-screen">
      {focused && <StatusBar style="light" />}
      <View style={styles.media} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Image source={poster} style={styles.poster} resizeMode="cover" accessible={false} />
        {canPlay && <WelcomeVideo onFailure={() => setFailed(true)} />}
      </View>
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(10,15,15,0.42)", "rgba(10,15,15,0.10)", "rgba(10,15,15,0.80)", "#0A0F0F", "#0A0F0F"]}
        locations={[0, 0.28, 0.53, 0.74, 1]}
        style={StyleSheet.absoluteFill}
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom, 20) + 12 }]} bounces={false}>
        <View style={styles.header}>
          <View style={styles.brand} accessibilityLabel="Scout">
            <Icon name="compass" size={25} color={colors.white} strokeWidth={1.5} />
            <Text style={styles.wordmark}>Scout</Text>
          </View>
          {!reduceMotion && !failed && (
            <Pressable testID="welcome-motion" accessibilityRole="button" accessibilityLabel={paused ? "Play background video" : "Pause background video"} onPress={() => setPaused(!paused)} hitSlop={8} style={styles.motion}>
              <Text style={styles.motionText}>{paused ? "Play background" : "Pause background"}</Text>
            </Pressable>
          )}
        </View>
        <View style={[styles.message, { paddingTop: compact ? 160 : 240 }]}>
          <View style={styles.rule} />
          <Text accessibilityRole="header" style={[styles.headline, compact && styles.headlineCompact]}>Be in the room when it happens</Text>
          <Text style={styles.support}>Discover the people, ideas, and startup events worth showing up for.</Text>
          <Pressable
            testID="welcome-get-started"
            accessibilityRole="button"
            accessibilityLabel="Get started"
            accessibilityHint="Choose your role, interests, and location"
            onPress={() => {
              setLeaving(true);
              onGetStarted();
            }}
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          >
            <Text style={styles.ctaText}>Get started</Text>
            <Icon name="chevron-right" size={20} color={colors.ink} />
          </Pressable>
          <Pressable
            testID="have-account"
            accessibilityRole="link"
            accessibilityHint="Sign in with your email and password"
            onPress={() => {
              setLeaving(true);
              onSignIn();
            }}
            hitSlop={8}
            style={styles.signIn}
          >
            <Text style={styles.signInText}>I already have an account</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function WelcomeVideo({ onFailure }: { onFailure: () => void }) {
  const [ready, setReady] = useState(false);
  const player = useVideoPlayer(video, (instance) => {
    instance.muted = true;
    instance.loop = true;
    instance.staysActiveInBackground = false;
    instance.audioMixingMode = "mixWithOthers";
  });
  const { status } = useEvent(player, "statusChange", { status: player.status });

  useEffect(() => {
    if (status === "error") onFailure();
  }, [status, onFailure]);

  useEffect(() => {
    if (ready) return;
    const timeout = setTimeout(onFailure, 2500);
    return () => clearTimeout(timeout);
  }, [ready, onFailure]);

  useEffect(() => {
    player.play();
    return () => player.pause();
  }, [player]);

  return (
    <VideoView
      testID="welcome-video"
      player={player}
      style={[styles.poster, { opacity: ready ? 1 : 0 }]}
      contentFit="cover"
      nativeControls={false}
      fullscreenOptions={{ enable: false }}
      allowsPictureInPicture={false}
      playsInline
      surfaceType="textureView"
      onFirstFrameRender={() => setReady(true)}
      accessible={false}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0A0F0F" },
  media: { position: "absolute", top: 0, left: 0, right: 0, height: "76%", overflow: "hidden" },
  poster: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%" },
  content: { flexGrow: 1, paddingHorizontal: 28, width: "100%", maxWidth: 560, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  brand: { flexDirection: "row", alignItems: "center", gap: 9 },
  wordmark: { ...type.brand, fontSize: 24, lineHeight: 30, color: colors.white, letterSpacing: -0.8 },
  motion: { minHeight: 44, justifyContent: "center" },
  motionText: { fontSize: 11, color: "#FFFFFF", textDecorationLine: "underline" },
  message: { marginTop: "auto" },
  rule: { width: 32, height: 3, backgroundColor: colors.brand, marginBottom: 22 },
  headline: { color: "#FAFAF7", fontSize: 46, lineHeight: 49, letterSpacing: -1.8, fontWeight: "600", maxWidth: 390 },
  headlineCompact: { fontSize: 38, lineHeight: 41, letterSpacing: -1.4 },
  support: { fontSize: 16, lineHeight: 24, color: "#CDD2CF", marginTop: 20, maxWidth: 320 },
  cta: { marginTop: 32, minHeight: 58, borderRadius: radius.button, backgroundColor: "#FAFAF7", paddingHorizontal: 20, paddingVertical: 17, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  ctaPressed: { backgroundColor: "#DDE1DD" },
  signIn: { alignSelf: "center", marginTop: 16, paddingVertical: 8 },
  signInText: { ...type.label, fontSize: 15, color: "#FAFAF7" },
  ctaText: { ...type.bodyStrong, color: colors.ink, fontSize: 16, lineHeight: 24 },
});
