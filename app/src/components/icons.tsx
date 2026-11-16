import Svg, { Circle, Path, Rect } from "react-native-svg";

type Props = { size?: number; color: string; filled?: boolean };

const stroke = (color: string, width = 1.5) => ({
  stroke: color,
  strokeWidth: width,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  fill: "none",
});

export const CalendarIcon = ({ size = 18, color }: Props) => (
  <Svg width={size} height={size} viewBox="0 0 16 16">
    <Rect x={2.5} y={3.5} width={11} height={10} rx={1.5} {...stroke(color)} />
    <Path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" {...stroke(color)} />
  </Svg>
);

export const PinIcon = ({ size = 18, color }: Props) => (
  <Svg width={size} height={size} viewBox="0 0 16 16">
    <Path d="M8 14.5s4.5-4.2 4.5-7.75a4.5 4.5 0 0 0-9 0C3.5 10.3 8 14.5 8 14.5z" {...stroke(color)} />
    <Circle cx={8} cy={6.75} r={1.5} {...stroke(color)} />
  </Svg>
);

export const PeopleIcon = ({ size = 18, color }: Props) => (
  <Svg width={size} height={size} viewBox="0 0 16 16">
    <Circle cx={6} cy={5.5} r={2.25} {...stroke(color)} />
    <Path d="M2 13c0-2.2 1.8-3.75 4-3.75S10 10.8 10 13M10.5 3.5a2.25 2.25 0 0 1 0 4.25M12 9.5c1.3.5 2 1.7 2 3.5" {...stroke(color)} />
  </Svg>
);

export const BookmarkIcon = ({ size = 18, color, filled }: Props) => (
  <Svg width={size} height={size} viewBox="0 0 16 16">
    <Path d="M4.5 2.5h7v11L8 11l-3.5 2.5z" {...stroke(color)} fill={filled ? color : "none"} />
  </Svg>
);

export const SignalIcon = ({ size = 12, color }: Props) => (
  <Svg width={size} height={size} viewBox="0 0 16 16">
    <Path d="M2.5 12.5 6 9l2.5 2.5 5-6" {...stroke(color, 1.75)} />
    <Path d="M10 5.5h3.5V9" {...stroke(color, 1.75)} />
  </Svg>
);

export const CheckIcon = ({ size = 14, color }: Props) => (
  <Svg width={size} height={size} viewBox="0 0 16 16">
    <Path d="M3.5 8.5l3 3 6-7" {...stroke(color, 1.75)} />
  </Svg>
);

export const BackIcon = ({ size = 20, color }: Props) => (
  <Svg width={size} height={size} viewBox="0 0 16 16">
    <Path d="M10 3.5 5.5 8 10 12.5" {...stroke(color)} />
  </Svg>
);

export const LinkIcon = ({ size = 18, color }: Props) => (
  <Svg width={size} height={size} viewBox="0 0 16 16">
    <Path d="M9 3h4v4M13 3 7.5 8.5M11 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3" {...stroke(color)} />
  </Svg>
);

export const ShareIcon = ({ size = 18, color }: Props) => (
  <Svg width={size} height={size} viewBox="0 0 16 16">
    <Path d="M8 2.5v8M5 5.25 8 2.5l3 2.75M4.5 7.5h-1v6h9v-6h-1" {...stroke(color)} />
  </Svg>
);

export const SearchIcon = ({ size = 22, color }: Props) => (
  <Svg width={size} height={size} viewBox="0 0 16 16">
    <Circle cx={7} cy={7} r={4.5} {...stroke(color)} />
    <Path d="M10.5 10.5 14 14" {...stroke(color)} />
  </Svg>
);

export const AlertIcon = ({ size = 22, color }: Props) => (
  <Svg width={size} height={size} viewBox="0 0 16 16">
    <Circle cx={8} cy={8} r={6.25} {...stroke(color)} />
    <Path d="M8 4.75v3.75M8 11h.01" {...stroke(color)} />
  </Svg>
);

export const ChartIcon = ({ size = 36, color }: Props) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path d="M3 16.5h14M5 13.5V10M9 13.5V7M13 13.5V9M17 13.5V4" {...stroke(color)} />
  </Svg>
);

export const SparkIcon = ({ size = 36, color }: Props) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8" {...stroke(color)} />
  </Svg>
);
