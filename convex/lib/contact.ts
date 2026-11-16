export const CONTACT_FIELDS = ["name", "email", "phone", "affiliation", "linkedin"] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];
export type Contact = Record<ContactField, string>;

export const CONTACT_LIMITS: Record<ContactField, number> = { name: 80, email: 254, phone: 24, affiliation: 100, linkedin: 200 };

type Checked = { value: string } | { error: string };

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\u2800\u3164\uFFA0]/u;
const EMAIL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const LINKEDIN_HANDLE = /^[A-Za-z0-9_-][A-Za-z0-9_-]{1,99}$/;
const LINKEDIN_URL = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([^/?#\s]+)\/?(?:[?#].*)?$/i;

const tooLong = (field: ContactField, value: string) => Array.from(value).length > CONTACT_LIMITS[field];

export function checkContactField(field: ContactField, raw: string): Checked {
  if (/[\r\n]/.test(raw) || INVISIBLE.test(raw.replace(/\t/g, ""))) return { error: "Use a single line of plain text" };
  const collapsed = raw.trim().replace(/\s+/g, " ");
  const trimmed = field === "email" ? collapsed.toLowerCase() : collapsed;
  if (tooLong(field, trimmed)) return { error: `Keep it under ${CONTACT_LIMITS[field]} characters` };
  if (trimmed === "") {
    if (field === "name") return { error: "Enter your name" };
    if (field === "email") return { error: "Enter your email" };
    return { value: "" };
  }
  switch (field) {
    case "name":
    case "affiliation":
      return { value: trimmed };
    case "email":
      return EMAIL.test(trimmed) ? { value: trimmed } : { error: "Enter a valid email, like you@school.edu" };
    case "phone": {
      if (!/^\+?[0-9 ().-]+$/.test(trimmed)) return { error: "Use digits, spaces and an optional leading +" };
      const digits = trimmed.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) return { error: "Enter 7 to 15 digits, like +1 415 555 0100" };
      if (trimmed.startsWith("+") && digits.startsWith("0")) return { error: "Country codes start with 1 to 9, like +1" };
      return { value: trimmed.startsWith("+") ? `+${digits}` : digits };
    }
    case "linkedin": {
      const handle = LINKEDIN_URL.exec(trimmed)?.[1] ?? trimmed.replace(/^@/, "");
      return LINKEDIN_HANDLE.test(handle)
        ? { value: `https://www.linkedin.com/in/${handle}` }
        : { error: "Use a linkedin.com/in/ URL or your handle" };
    }
  }
}

export function checkContact(input: Contact): { values: Contact } | { errors: Partial<Contact> } {
  const values = {} as Contact;
  const errors: Partial<Contact> = {};
  for (const field of CONTACT_FIELDS) {
    const result = checkContactField(field, input[field]);
    if ("error" in result) errors[field] = result.error;
    else values[field] = result.value;
  }
  return Object.keys(errors).length ? { errors } : { values };
}
