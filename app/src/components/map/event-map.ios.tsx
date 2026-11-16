import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import MapView, { Marker } from "react-native-maps";
import { EventTypeIcon } from "@/components/event-type-icon";
import { EVENT_TYPE_META, type Palette } from "@/constants/theme";
import { CLUSTER_PX, clusterGroups, nextInGroup, PIN_SIZE, SELECTED_PIN_SIZE, type Cluster } from "./model";
import type { EventMapProps, MapMarker } from "./types";

const ring = (selected: boolean, ink: string) => (selected ? { borderColor: ink, borderWidth: 3 } : { borderColor: "transparent", borderWidth: 3 });
const lift = { shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } };

function SavedDot({ palette }: { palette: Palette }) {
  return <View style={{ position: "absolute", right: -3, bottom: -3, width: 13, height: 13, borderRadius: 7, backgroundColor: palette.gold, borderWidth: 2, borderColor: "#FFFFFF" }} />;
}

function Pin({ cluster, selected, palette }: { cluster: Cluster<MapMarker>; selected: boolean; palette: Palette }) {
  const count = cluster.ids.length;
  if (cluster.groups.length > 1) {
    const size = (selected ? SELECTED_PIN_SIZE : PIN_SIZE) + 4;
    return <View style={[{ width: size + 6, height: size + 6, borderRadius: (size + 6) / 2, alignItems: "center", justifyContent: "center" }, ring(selected, palette.ink)]}>
      <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: palette.brand, borderWidth: 3, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" }, lift]}>
        <Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "600" }}>{count}</Text>
      </View>
      {cluster.saved && <SavedDot palette={palette} />}
    </View>;
  }
  const size = selected ? SELECTED_PIN_SIZE : PIN_SIZE;
  const [eventType] = cluster.groups[0].eventTypes;
  return <View style={{ width: size + 8, height: Math.ceil(size / 2 + size * Math.SQRT1_2) + 4, alignItems: "center" }}>
    <View style={[{ position: "absolute", top: 4, width: size, height: size, borderTopLeftRadius: size / 2, borderTopRightRadius: size / 2, borderBottomRightRadius: size / 2, borderBottomLeftRadius: 0, transform: [{ rotate: "-45deg" }], backgroundColor: EVENT_TYPE_META[eventType].color, borderWidth: 2, borderColor: "#FFFFFF" }, lift, selected && { borderColor: palette.ink, borderWidth: 3 }]} />
    <View style={{ position: "absolute", top: 4, width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <EventTypeIcon eventType={eventType} size={Math.round(size * 0.48)} color="#FFFFFF" strokeWidth={2.25} />
    </View>
    {count > 1 && <View style={{ position: "absolute", top: 0, right: 0, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: palette.ink, borderWidth: 2, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: palette.bg, fontSize: 11, fontWeight: "600" }}>{count}</Text>
    </View>}
    {cluster.saved && <SavedDot palette={palette} />}
  </View>;
}

export default function EventMap({ center, radiusKm, recenter, markers, selectedId, onSelect, palette, dark }: EventMapProps) {
  const ref = useRef<MapView>(null);
  const [span, setSpan] = useState(radiusKm / 35);
  const [width, setWidth] = useState(390);
  useEffect(() => {
    ref.current?.animateToRegion({ latitude: center.lat, longitude: center.lng, latitudeDelta: radiusKm / 45, longitudeDelta: radiusKm / 35 }, 350);
  }, [center.lat, center.lng, radiusKm, recenter]);
  const clusters = useMemo(() => clusterGroups(markers, (CLUSTER_PX * span) / width), [markers, span, width]);
  return (
    <MapView ref={ref} style={{ flex: 1 }} userInterfaceStyle={dark ? "dark" : "light"}
      initialRegion={{ latitude: center.lat, longitude: center.lng, latitudeDelta: radiusKm / 45, longitudeDelta: radiusKm / 35 }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width || 390)}
      onRegionChangeComplete={(region) => setSpan(region.longitudeDelta)}
      showsUserLocation={false} testID="event-map" accessibilityLabel="Event locations. Use the event selector below for an accessible list.">
      {clusters.map((cluster) => {
        const selected = cluster.ids.includes(selectedId ?? "");
        const spread = cluster.groups.length > 1;
        const { south, west, north, east } = cluster.bounds;
        const types = [...new Set(cluster.groups.flatMap((g) => g.eventTypes.map((t) => EVENT_TYPE_META[t].label)))].join(", ");
        return <Marker key={`${cluster.ids.join(",")}:${selected}`} coordinate={{ latitude: cluster.lat, longitude: cluster.lng }}
          anchor={spread ? { x: 0.5, y: 0.5 } : { x: 0.5, y: 1 }}
          centerOffset={spread ? { x: 0, y: 0 } : { x: 0, y: -(selected ? SELECTED_PIN_SIZE : PIN_SIZE) * 0.6 }}
          zIndex={selected ? 1000 : spread ? 600 : cluster.saved ? 500 : 0}
          accessibilityLabel={`${cluster.ids.length} event${cluster.ids.length === 1 ? "" : "s"}: ${types}${cluster.saved ? ", includes saved" : ""}`}
          onPress={() => spread
            ? ref.current?.animateToRegion({ latitude: (south + north) / 2, longitude: (west + east) / 2, latitudeDelta: Math.max((north - south) * 2.4, 0.004), longitudeDelta: Math.max((east - west) * 2.4, 0.004) }, 350)
            : onSelect(nextInGroup(cluster.ids, selectedId))}>
          <Pin cluster={cluster} selected={selected} palette={palette} />
        </Marker>;
      })}
    </MapView>
  );
}
