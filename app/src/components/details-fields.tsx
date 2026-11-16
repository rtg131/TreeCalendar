import { ConvexError } from "convex/values";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { colors, radius, space, type } from "@/constants/theme";
import { CONTACT_LIMITS, type Contact, type ContactField } from "@/convex/lib/contact";
import type { Role } from "@/lib/profile";

export const EMPTY_CONTACT: Contact = { name: "", email: "", phone: "", affiliation: "", linkedin: "" };

export const contactOf = (user: Partial<Contact> | null | undefined): Contact => ({
  name: user?.name ?? "",
  email: user?.email ?? "",
  phone: user?.phone ?? "",
  affiliation: user?.affiliation ?? "",
  linkedin: user?.linkedin ?? "",
});

export function contactErrorOf(e: unknown): Partial<Contact> | null {
  if (!(e instanceof ConvexError)) return null;
  const { field, message } = e.data as { field?: ContactField; message?: string };
  return field && message ? { [field]: message } : null;
}

export const affiliationLabel = (role: Role | null) => (role === "investor" ? "Firm or company" : role === "host" ? "Company or organization" : "School or organization");

type FieldSpec = { field: ContactField; label: string; placeholder: string; optional?: boolean; input: TextInputProps };

const fields = (role: Role | null): FieldSpec[] => [
  { field: "name", label: "Full name", placeholder: "Ada Lovelace", input: { autoCapitalize: "words", autoComplete: "name", textContentType: "name" } },
  { field: "email", label: "Email", placeholder: role === "investor" ? "you@firm.com" : role === "host" ? "you@company.com" : "you@school.edu", input: { autoCapitalize: "none", autoComplete: "email", keyboardType: "email-address", textContentType: "emailAddress" } },
  { field: "phone", label: "Phone number", placeholder: "+1 415 555 0100", optional: true, input: { autoComplete: "tel", keyboardType: "phone-pad", textContentType: "telephoneNumber" } },
  { field: "affiliation", label: affiliationLabel(role), placeholder: role === "investor" ? "Firm or company name" : "Stanford, Cal, a club", optional: true, input: { autoCapitalize: "words", textContentType: "organizationName" } },
  { field: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/in/you", optional: true, input: { autoCapitalize: "none", keyboardType: "url", textContentType: "URL" } },
];

type Props = {
  role: Role | null;
  value: Contact;
  errors: Partial<Contact>;
  onChange: (field: ContactField, text: string) => void;
  testIDPrefix: string;
};

export function DetailsFields({ role, value, errors, onChange, testIDPrefix }: Props) {
  return (
    <View style={styles.wrap}>
      {fields(role).map((f) => (
        <View key={f.field}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>{f.label}</Text>
            <Text style={styles.hint}>{f.optional ? "Optional" : "Required"}</Text>
          </View>
          <TextInput
            testID={`${testIDPrefix}-${f.field}`}
            accessibilityLabel={`${f.label}${f.optional ? " (optional)" : ""}`}
            value={value[f.field]}
            onChangeText={(text) => onChange(f.field, text)}
            placeholder={f.placeholder}
            placeholderTextColor={colors.subtle}
            autoCorrect={false}
            maxLength={CONTACT_LIMITS[f.field]}
            style={[styles.input, errors[f.field] ? styles.inputError : null]}
            {...f.input}
          />
          {errors[f.field] ? (
            <Text testID={`${testIDPrefix}-${f.field}-error`} style={styles.error} accessibilityRole="alert">
              {errors[f.field]}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  labelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: space.xs },
  label: { ...type.label, color: colors.muted },
  hint: { ...type.tag, color: colors.subtle },
  input: {
    ...type.body,
    color: colors.ink,
    height: 48,
    paddingHorizontal: 12,
    borderRadius: radius.input,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  inputError: { borderColor: colors.danger },
  error: { ...type.meta, color: colors.danger, marginTop: space.xs },
});
