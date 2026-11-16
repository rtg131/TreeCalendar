import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/button";
import { colors, layout, radius, space, type } from "@/constants/theme";
import { errorCopy, MESSAGE_LIMIT } from "@/lib/connections";

type Props = {
  visible: boolean;
  title: string;
  subtitle: string;
  placeholder: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (message: string | undefined) => Promise<unknown>;
};

export function InterestSheet({ visible, title, subtitle, placeholder, submitLabel, onClose, onSubmit }: Props) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = Array.from(message.trim()).length;
  const close = () => {
    if (busy) return;
    setMessage("");
    setError(null);
    onClose();
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(message.trim() || undefined);
      setMessage("");
      onClose();
    } catch (e) {
      setError(errorCopy(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.backdrop}>
        <Pressable accessibilityLabel="Close" style={{ flex: 1 }} onPress={close} />
        <View testID="interest-sheet" style={styles.sheet}>
          <Text style={styles.title} accessibilityRole="header">{title}</Text>
          <Text style={styles.meta}>{subtitle}</Text>
          <TextInput
            testID="interest-message"
            accessibilityLabel="Short message (optional)"
            placeholder={placeholder}
            placeholderTextColor={colors.subtle}
            value={message}
            onChangeText={setMessage}
            multiline
            maxLength={MESSAGE_LIMIT + 50}
            style={styles.input}
          />
          <Text style={[styles.meta, length > MESSAGE_LIMIT && { color: colors.danger }]}>{length}/{MESSAGE_LIMIT} · optional</Text>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <View style={styles.row}>
            <Button label="Cancel" variant="ghost" style={{ flex: 1 }} disabled={busy} onPress={close} />
            <Button testID="send-interest" label={submitLabel} style={{ flex: 2 }} loading={busy} disabled={length > MESSAGE_LIMIT} onPress={() => void submit()} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: layout.screenPadding, paddingBottom: space.xxxl, gap: space.sm },
  title: { ...type.cardTitle, fontSize: 18, color: colors.ink },
  meta: { ...type.meta, color: colors.muted },
  input: { minHeight: 96, padding: 12, borderRadius: radius.input, borderWidth: 1, borderColor: colors.lineStrong, color: colors.ink, fontSize: 15, textAlignVertical: "top" },
  error: { ...type.meta, color: colors.danger },
  row: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
});
