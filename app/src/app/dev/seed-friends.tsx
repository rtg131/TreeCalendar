import { useMutation } from "convex/react";
import { Redirect, useLocalSearchParams } from "expo-router";

import { DevSeed } from "@/components/dev-seed";
import { api } from "@/convex/_generated/api";

const ENABLED = process.env.EXPO_PUBLIC_TEST_FIXTURES === "1";

export default function SeedFriends() {
  if (!ENABLED) return <Redirect href="/" />;
  return <Seed />;
}

function Seed() {
  const { to } = useLocalSearchParams<{ to?: string }>();
  const seed = useMutation(api.fixtures.seedFriendsDemo);
  return (
    <DevSeed
      role="student"
      seed={(deviceId) => seed({ deviceId })}
      open={({ goingEventId }) => ({
        tab: "profile",
        push: to === "event" ? { pathname: "/event/[id]", params: { id: goingEventId } } : "/friends",
      })}
    />
  );
}
