import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radius, space, type } from "@/constants/theme";
import { MAX_PASSWORD_LENGTH } from "@/convex/lib/account";

type Props = {
  label: string;
  value: string;
  onChange: (text: string) => void;
  error?: string;
  hint?: string;
  testID: string;
  isNew?: boolean;
  onSubmit?: () => void;
};

export function PasswordField({ label, value, onChange, error, hint, testID, isNew, onSubmit }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <View>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <View style={[styles.field, error ? styles.fieldError : null]}>
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          onSubmitEditing={onSubmit}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={isNew ? "new-password" : "current-password"}
          textContentType={isNew ? "newPassword" : "password"}
          maxLength={MAX_PASSWORD_LENGTH}
          placeholder={isNew ? "At least 8 characters" : "Your password"}
          placeholderTextColor={colors.subtle}
          style={styles.input}
        />
        <Pressable
          testID={`${testID}-toggle`}
          accessibilityRole="button"
          accessibilityLabel={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          onPress={() => setVisible(!visible)}
          hitSlop={6}
          style={styles.toggle}
        >
          <Text style={styles.toggleText}>{visible ? "Hide" : "Show"}</Text>
        </Pressable>
      </View>
      {error ? (
        <Text testID={`${testID}-error`} style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: space.xs },
  label: { ...type.label, color: colors.muted },
  hint: { ...type.tag, color: colors.subtle },
  field: {
    flexDirection: "row",
    alignItems: "center",
    height: 48,
    borderRadius: radius.input,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    paddingLeft: 12,
  },
  fieldError: { borderColor: colors.danger },
  input: { flex: 1, ...type.body, color: colors.ink, height: "100%" },
  toggle: { height: 32, marginRight: 8, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.brandSoft, justifyContent: "center" },
  toggleText: { ...type.label, color: colors.brandInk },
  error: { ...type.meta, color: colors.danger, marginTop: space.xs },
});
