import { Linking, Pressable, Text, View } from "react-native";
import type { EventMapProps } from "./types";

export default function EventMap({ center, palette }: EventMapProps) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12, backgroundColor: palette.secondary }} testID="map-platform-fallback">
      <Text style={{ color: palette.ink, fontSize: 18, fontWeight: "600" }}>Explore events below</Text>
      <Text style={{ color: palette.muted, textAlign: "center" }}>Native Android maps aren’t configured in this build. All located events are available in the selector and cards below.</Text>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`https://www.openstreetmap.org/#map=11/${center.lat}/${center.lng}`)} style={{ padding: 12 }}>
        <Text style={{ color: palette.brandInk }}>Open this area in OpenStreetMap ↗</Text>
      </Pressable>
    </View>
  );
}
