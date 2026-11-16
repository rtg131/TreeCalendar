import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useState, type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { EventTypeIcon } from "@/components/event-type-icon";
import { CheckIcon } from "@/components/icons";
import { colors, EVENT_TYPE_META, radius, type EventType, type Palette } from "@/constants/theme";

export type HostCompany = { _id: string; name: string; logo?: string };
export type EventMedia = { eventType: EventType; imageUrl?: string; organizer?: string; organizerLogoUrl?: string; hostCompany?: HostCompany };

const httpsOnly = (uri?: string) => (uri && uri.startsWith("https://") ? uri : undefined);

export function useImage(uri?: string) {
  const [failed, setFailed] = useState<string | null>(null);
  const source = httpsOnly(uri);
  return { source: source && failed !== source ? source : undefined, onError: () => setFailed(source ?? null) };
}

function CategoryFallback({ eventType, iconSize }: { eventType: EventType; iconSize: number }) {
  const color = EVENT_TYPE_META[eventType].color;
  return (
    <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: `${color}1F` }]}>
      <EventTypeIcon eventType={eventType} size={iconSize} color={color} />
    </View>
  );
}

type ThumbProps = { event: EventMedia; size: number; style?: StyleProp<ViewStyle>; children?: ReactNode; testID?: string };

export function EventThumb({ event, size, style, children, testID }: ThumbProps) {
  const { source, onError } = useImage(event.imageUrl);
  return (
    <View testID={testID} style={[styles.thumb, { width: size, height: size }, style]}>
      <CategoryFallback eventType={event.eventType} iconSize={Math.round(size * 0.36)} />
      {source ? <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={150} recyclingKey={source} onError={onError} accessibilityIgnoresInvertColors /> : null}
      {children}
    </View>
  );
}

export function EventHero({ event, children }: { event: EventMedia; children?: ReactNode }) {
  const { source, onError } = useImage(event.imageUrl);
  return (
    <View testID="event-hero" style={styles.hero}>
      <CategoryFallback eventType={event.eventType} iconSize={40} />
      {source ? (
        <>
          <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={24} cachePolicy="memory-disk" transition={150} onError={onError} />
          <Image testID="event-banner" source={source} style={StyleSheet.absoluteFill} contentFit="contain" cachePolicy="memory-disk" transition={150} accessibilityLabel="Event banner" />
        </>
      ) : null}
      <LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.45)"]} style={styles.heroShade} pointerEvents="none" />
      <View style={styles.heroRow}>{children}</View>
    </View>
  );
}

const initials = (name: string) =>
  name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

type AvatarProps = { uri?: string; name: string; size?: number; palette?: Palette; testID?: string };

export function OrgAvatar({ uri, name, size = 20, palette = colors, testID }: AvatarProps) {
  const { source, onError } = useImage(uri);
  const r = Math.round(size * 0.28);
  return (
    <View testID={testID} style={[styles.center, { width: size, height: size, borderRadius: r, backgroundColor: palette.brandSoft, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: palette.line }]}>
      <Text style={{ fontSize: Math.max(8, Math.round(size * 0.42)), fontWeight: "600", color: palette.brandInk }}>{initials(name)}</Text>
      {source ? <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={120} recyclingKey={source} onError={onError} accessibilityIgnoresInvertColors /> : null}
    </View>
  );
}

export function hostOf(event: EventMedia): { name: string; logo?: string; verified: boolean } | null {
  if (event.hostCompany) return { name: event.hostCompany.name, logo: event.hostCompany.logo, verified: true };
  if (event.organizer) return { name: event.organizer, logo: event.organizerLogoUrl, verified: false };
  return null;
}

type HostLineProps = { event: EventMedia; size?: number; palette?: Palette; prefix?: string; textStyle?: StyleProp<TextStyle>; style?: StyleProp<ViewStyle> };

export function HostLine({ event, size = 18, palette = colors, prefix, textStyle, style }: HostLineProps) {
  const host = hostOf(event);
  if (!host) return null;
  return (
    <View testID="event-host" style={[styles.hostRow, style]}>
      <OrgAvatar uri={host.logo} name={host.name} size={size} palette={palette} testID="host-avatar" />
      <Text numberOfLines={1} style={[{ fontSize: 13, color: palette.muted, flexShrink: 1 }, textStyle]}>
        {prefix ? `${prefix} ` : ""}
        {host.name}
      </Text>
      {host.verified ? (
        <View accessibilityLabel="Verified host" style={[styles.verified, { backgroundColor: palette.brand }]}>
          <CheckIcon size={9} color={palette.white} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  thumb: { borderRadius: radius.sm, overflow: "hidden" },
  hero: { aspectRatio: 2, borderRadius: radius.lg, overflow: "hidden", justifyContent: "flex-end" },
  heroShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: "55%" },
  heroRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", padding: 12 },
  hostRow: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  verified: { width: 14, height: 14, borderRadius: 7, alignItems: "center", justifyContent: "center" },
});
