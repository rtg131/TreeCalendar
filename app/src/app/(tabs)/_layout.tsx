import { useQuery } from "convex/react";
import { Tabs } from "expo-router/js-tabs";
import type { ColorValue } from "react-native";

import { Icon, type IconName } from "@/components/icon";
import { colors, type } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import { useDeviceId } from "@/lib/device";

function tabIcon(name: IconName) {
  return function TabIcon({ color }: { color: ColorValue }) {
    return <Icon name={name} size={22} color={color} />;
  };
}

export default function TabsLayout() {
  const deviceId = useDeviceId();
  const profile = useQuery(api.users.get, deviceId ? { deviceId } : "skip");
  const investor = profile?.role === "investor";
  const inbox = useQuery(api.connections.inbox, deviceId ? { deviceId } : "skip");
  const incoming = inbox ? inbox.talent.incoming.length + inbox.companies.reduce((n, c) => n + c.incoming.length, 0) : 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.subtle,
        tabBarLabelStyle: type.tab,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, borderTopWidth: 0.5 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="feed" options={{ title: "Feed", tabBarButtonTestID: "tab-feed", tabBarIcon: tabIcon("home") }} />
      <Tabs.Screen name="map" options={{ title: "Map", tabBarButtonTestID: "tab-map", tabBarIcon: tabIcon("map-pin") }} />
      <Tabs.Screen name="saved" options={{ title: "Saved", tabBarButtonTestID: "tab-saved", tabBarIcon: tabIcon("bookmark") }} />
      <Tabs.Screen
        name="investor/index"
        options={{
          title: "Investor",
          href: investor ? "/investor" : null,
          tabBarButtonTestID: "tab-investor",
          tabBarActiveTintColor: colors.gold,
          tabBarIcon: tabIcon("trending-up"),
        }}
      />
      <Tabs.Screen name="inbox" options={{ title: "Inbox", tabBarButtonTestID: "tab-inbox", tabBarIcon: tabIcon("briefcase"), tabBarBadge: incoming || undefined }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarButtonTestID: "tab-profile", tabBarIcon: tabIcon("user") }} />
    </Tabs>
  );
}
