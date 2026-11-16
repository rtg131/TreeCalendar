import { ConvexError } from "convex/values";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radius, space, type } from "@/constants/theme";
import { checkProfileField, PROFILE_FIELDS, PROFILE_LIMITS, wordCount, type ProfileField } from "@/convex/lib/profile";

export type Professional = Record<ProfileField, string>;

export const professionalOf = (user: { priorRoles?: string; experience?: string } | null | undefined): Professional => ({
  priorRoles: user?.priorRoles ?? "",
  experience: user?.experience ?? "",
});

export function checkProfessional(value: Professional): { values: Professional } | { errors: Partial<Professional> } {
  const values: Partial<Professional> = {};
  const errors: Partial<Professional> = {};
  for (const field of PROFILE_FIELDS) {
    const checked = checkProfileField(field, value[field]);
    if ("error" in checked) errors[field] = checked.error;
    else values[field] = checked.value;
  }
  return Object.keys(errors).length ? { errors } : { values: values as Professional };
}

export function professionalErrorOf(e: unknown): Partial<Professional> | null {
  if (!(e instanceof ConvexError)) return null;
  const { field, message } = (e.data ?? {}) as { field?: string; message?: string };
  return field && message && (PROFILE_FIELDS as readonly string[]).includes(field) ? { [field]: message } : null;
}

const SPECS: Record<ProfileField, { label: string; placeholder: string; height: number }> = {
  priorRoles: { label: "Prior roles", placeholder: "Software intern at Acme, president of the AI club", height: 72 },
  experience: { label: "Experience", placeholder: "Work history, projects and what you've shipped", height: 112 },
};

type Props = {
  value: Professional;
  errors: Partial<Professional>;
  onChange: (field: ProfileField, text: string) => void;
  testIDPrefix: string;
};

export function ProfessionalFields({ value, errors, onChange, testIDPrefix }: Props) {
  return (
    <View style={styles.wrap}>
      {PROFILE_FIELDS.map((field) => {
        const spec = SPECS[field];
        const { words, chars } = PROFILE_LIMITS[field];
        const count = wordCount(value[field]);
        const over = count > words || Array.from(value[field].trim()).length > chars;
        return (
          <View key={field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>{spec.label}</Text>
              <Text testID={`${testIDPrefix}-${field}-count`} style={[styles.hint, over && { color: colors.danger }]}>
                Optional · {count}/{words} words
              </Text>
            </View>
            <TextInput
              testID={`${testIDPrefix}-${field}`}
              accessibilityLabel={`${spec.label} (optional, up to ${words} words)`}
              value={value[field]}
              onChangeText={(text) => onChange(field, text)}
              placeholder={spec.placeholder}
              placeholderTextColor={colors.subtle}
              multiline
              maxLength={chars + 100}
              style={[styles.input, { minHeight: spec.height }, errors[field] || over ? styles.inputError : null]}
            />
            {errors[field] ? (
              <Text testID={`${testIDPrefix}-${field}-error`} style={styles.error} accessibilityRole="alert">
                {errors[field]}
              </Text>
            ) : null}
          </View>
        );
      })}
      <Text style={styles.hint}>Members of verified companies that hosted events you marked Going or checked in to can see these, along with your name and school. Your email, phone and LinkedIn stay private unless you share them</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, marginTop: space.md },
  labelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: space.xs },
  label: { ...type.label, color: colors.muted },
  hint: { ...type.tag, color: colors.subtle },
  input: { ...type.body, color: colors.ink, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.input, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong, textAlignVertical: "top" },
  inputError: { borderColor: colors.danger },
  error: { ...type.meta, color: colors.danger, marginTop: space.xs },
});
