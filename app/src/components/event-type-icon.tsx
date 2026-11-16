import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { EVENT_TYPE_META, type EventType } from "@/constants/theme";

export const EVENT_TYPE_GLYPHS: Record<EventType, string[]> = {
  hackathon: ["m16 18 6-6-6-6", "m8 6-6 6 6 6"],
  pitch_competition: [
    "M6 9H4.5a2.5 2.5 0 0 1 0-5H6",
    "M18 9h1.5a2.5 2.5 0 0 0 0-5H18",
    "M4 22h16",
    "M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22",
    "M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22",
    "M18 2H6v7a6 6 0 0 0 12 0V2Z",
  ],
  demo_day: [
    "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z",
    "m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z",
    "M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0",
    "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5",
  ],
  networking: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  workshop: ["M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"],
  talk: ["M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 19v3"],
  conference: ["M3 22h18", "M6 18v-7", "M10 18v-7", "M14 18v-7", "M18 18v-7", "M12 2 20 7H4z"],
  career_fair: ["M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16", "M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"],
  social: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z", "M19 15v6", "M16 18h6", "M5 3v4", "M3 5h4"],
  other: ["M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z", "M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0"],
};

export const glyphSvg = (eventType: EventType, size: number, color: string) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${EVENT_TYPE_GLYPHS[eventType].map((d) => `<path d="${d}"/>`).join("")}</svg>`;

type IconProps = { eventType: EventType; size?: number; color?: string; strokeWidth?: number };

export function EventTypeIcon({ eventType, size = 16, color = EVENT_TYPE_META[eventType].color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {EVENT_TYPE_GLYPHS[eventType].map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}

export function EventTypeBadge({ eventType, size = 24 }: { eventType: EventType; size?: number }) {
  const color = EVENT_TYPE_META[eventType].color;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${color}1F`, alignItems: "center", justifyContent: "center" }}>
      <EventTypeIcon eventType={eventType} size={Math.round(size * 0.58)} color={color} />
    </View>
  );
}
