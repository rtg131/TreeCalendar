import { useMutation } from "convex/react";
import { useState } from "react";
import { Switch, Text, View } from "react-native";

import { styles } from "@/components/connections/ui";
import { colors } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDeviceId } from "@/lib/device";
import { errorCopy } from "@/lib/connections";

export function ShareContactToggle({ connectionId, companyName, shareContact, accepted }: { connectionId: Id<"connections">; companyName: string; shareContact: boolean; accepted: boolean }) {
  const deviceId = useDeviceId();
  const setShare = useMutation(api.connections.setShareContact);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async (next: boolean) => {
    if (!deviceId) return;
    setBusy(true);
    setError(null);
    try {
      await setShare({ deviceId, connectionId, shareContact: next });
    } catch (e) {
      setError(errorCopy(e));
    } finally {
      setBusy(false);
    }
  };
  const status = shareContact
    ? accepted
      ? `${companyName} can see your contact details`
      : `${companyName} will see them only if you both accept`
    : "Off. Nothing is shared";
  return (
    <View testID="share-contact" style={{ gap: 4 }}>
      <View style={styles.inline}>
        <Text style={[styles.body, { flex: 1 }]}>Share my contact details</Text>
        <Switch
          testID="share-contact-switch"
          accessibilityLabel={`Share my contact details with ${companyName}`}
          value={shareContact}
          disabled={busy}
          onValueChange={(next) => void toggle(next)}
          trackColor={{ true: colors.brand, false: colors.lineStrong }}
        />
      </View>
      <Text style={styles.meta}>
        Shares the email, phone and LinkedIn saved on your profile with this company only, and only once you&apos;re connected. You can turn it off at any time. {status}
      </Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}
