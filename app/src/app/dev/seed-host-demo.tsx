import { useMutation } from "convex/react";
import { Redirect } from "expo-router";

import { DevSeed } from "@/components/dev-seed";
import { api } from "@/convex/_generated/api";

const ENABLED = process.env.EXPO_PUBLIC_TEST_FIXTURES === "1";

export default function SeedHostDemo() {
  if (!ENABLED) return <Redirect href="/" />;
  return <Seed />;
}

function Seed() {
  const seed = useMutation(api.fixtures.seedHostDemo);
  return (
    <DevSeed
      role="host"
      seed={(deviceId) => seed({ deviceId })}
      open={({ companyId, eventId }) => ({ tab: "inbox", push: { pathname: "/company/[id]/matches/[eventId]", params: { id: companyId, eventId } } })}
    />
  );
}
