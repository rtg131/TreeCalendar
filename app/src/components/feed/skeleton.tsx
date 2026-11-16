import { useEffect, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { colors, layout, radius, shadow } from "@/constants/theme";

export function SkeletonCards({ count = 4 }: { count?: number }) {
  const [pulse] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View testID="feed-loading" accessibilityLabel="Loading events" accessibilityState={{ busy: true }} style={{ gap: layout.cardGap }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.card}>
          <Animated.View style={[styles.block, { width: 52, height: 56, borderRadius: radius.sm, opacity: pulse }]} />
          <View style={{ flex: 1, gap: 8, paddingTop: 4 }}>
            <Animated.View style={[styles.block, { width: "80%", height: 14, opacity: pulse }]} />
            <Animated.View style={[styles.block, { width: "55%", height: 12, opacity: pulse }]} />
            <Animated.View style={[styles.block, { width: "40%", height: 20, opacity: pulse }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", gap: 12, padding: layout.cardPadding, borderRadius: radius.card, backgroundColor: colors.surface, ...shadow.card },
  block: { backgroundColor: colors.secondary, borderRadius: radius.xs },
});
