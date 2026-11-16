import type { EventType, Palette } from "@/constants/theme";
import type { Coordinates, MarkerGroup } from "./model";

export type MapMarker = MarkerGroup & { eventTypes: EventType[] };

export type EventMapProps = {
  center: Coordinates;
  radiusKm: number;
  recenter: number;
  markers: MapMarker[];
  selectedId?: string;
  onSelect: (id: string) => void;
  palette: Palette;
  dark: boolean;
};
