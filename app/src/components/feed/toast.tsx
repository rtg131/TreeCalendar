import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { CheckIcon } from "@/components/icons";
import { colors, radius } from "@/constants/theme";

export type ToastMessage = { title: string; body?: string; action?: { label: string; onPress: () => void } };

export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((t: ToastMessage) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(t);
    timer.current = setTimeout(() => setToast(null), 3500);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return { toast, show, hide: () => setToast(null) };
}

export function Toast({ toast, onHide, bottom = 24 }: { toast: ToastMessage | null; onHide: () => void; bottom?: number }) {
  if (!toast) return null;
  return (
    <View testID="toast" accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.toast, { bottom }]}>
      <CheckIcon size={16} color={colors.success} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{toast.title}</Text>
        {toast.body ? <Text style={styles.body}>{toast.body}</Text> : null}
      </View>
      {toast.action ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => {
            toast.action?.onPress();
            onHide();
          }}
        >
          <Text style={styles.action}>{toast.action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  title: { color: colors.white, fontSize: 14, fontWeight: "600" },
  body: { color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 1 },
  action: { color: "#8FC1FF", fontSize: 14, fontWeight: "600" },
});
