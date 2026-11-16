import type { ColorValue } from "react-native";
import Svg, { Circle, Path, Polyline, Rect } from "react-native-svg";

import { colors } from "@/constants/theme";

export type IconName =
  | "home"
  | "bookmark"
  | "bookmark-filled"
  | "user"
  | "trending-up"
  | "calendar"
  | "map-pin"
  | "ticket"
  | "external-link"
  | "check"
  | "chevron-left"
  | "chevron-right"
  | "locate"
  | "graduation-cap"
  | "briefcase"
  | "compass";

type Props = { name: IconName; size?: number; color?: ColorValue; strokeWidth?: number };

export function Icon({ name, size = 20, color = colors.ink, strokeWidth = 1.5 }: Props) {
  const p = { stroke: color, strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "home" && <Path {...p} d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />}
      {name === "bookmark" && <Path {...p} d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />}
      {name === "bookmark-filled" && <Path {...p} fill={color} d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />}
      {name === "user" && (
        <>
          <Circle {...p} cx={12} cy={8} r={4} />
          <Path {...p} d="M4 21a8 8 0 0 1 16 0" />
        </>
      )}
      {name === "trending-up" && (
        <>
          <Polyline {...p} points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <Polyline {...p} points="16 7 22 7 22 13" />
        </>
      )}
      {name === "calendar" && (
        <>
          <Rect {...p} x={3} y={4} width={18} height={18} rx={2} />
          <Path {...p} d="M16 2v4M8 2v4M3 10h18" />
        </>
      )}
      {name === "map-pin" && (
        <>
          <Path {...p} d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" />
          <Circle {...p} cx={12} cy={10} r={3} />
        </>
      )}
      {name === "ticket" && (
        <Path {...p} d="M2 9a3 3 0 0 0 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 0 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2zM13 5v2M13 17v2M13 11v2" />
      )}
      {name === "external-link" && <Path {...p} d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />}
      {name === "check" && <Polyline {...p} points="20 6 9 17 4 12" />}
      {name === "chevron-left" && <Polyline {...p} points="15 18 9 12 15 6" />}
      {name === "chevron-right" && <Polyline {...p} points="9 18 15 12 9 6" />}
      {name === "locate" && (
        <>
          <Circle {...p} cx={12} cy={12} r={7} />
          <Circle {...p} cx={12} cy={12} r={3} />
          <Path {...p} d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </>
      )}
      {name === "graduation-cap" && <Path {...p} d="M22 10 12 5 2 10l10 5 10-5zM6 12v5c3 2 9 2 12 0v-5" />}
      {name === "briefcase" && (
        <>
          <Rect {...p} x={2} y={7} width={20} height={14} rx={2} />
          <Path {...p} d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20" />
        </>
      )}
      {name === "compass" && (
        <>
          <Circle {...p} cx={12} cy={12} r={10} />
          <Path {...p} d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z" />
        </>
      )}
    </Svg>
  );
}
