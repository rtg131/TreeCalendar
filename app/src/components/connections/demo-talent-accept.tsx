import { useMutation } from "convex/react";
import { useState } from "react";
import { Text } from "react-native";

import { Button } from "@/components/button";
import { styles } from "@/components/connections/ui";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDeviceId } from "@/lib/device";
import { errorCopy } from "@/lib/connections";

export const DEMO_FIXTURES = process.env.EXPO_PUBLIC_TEST_FIXTURES === "1";

export function DemoTalentAccept({ connectionId, testID }: { connectionId: Id<"connections">; testID?: string }) {
  const deviceId = useDeviceId();
  const respond = useMutation(api.fixtures.demoTalentRespond);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = async () => {
    if (!deviceId) return;
    setBusy(true);
    setError(null);
    try {
      await respond({ deviceId, connectionId, accept: true, message: "Thanks for reaching out! I'd love to hear more about the role." });
    } catch (e) {
      setError(errorCopy(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button testID={testID} label="Demo: talent accepts" variant="outline" style={[styles.small, { alignSelf: "flex-start" }]} loading={busy} onPress={() => void accept()} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </>
  );
}
