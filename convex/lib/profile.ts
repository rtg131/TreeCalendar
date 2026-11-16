export const PROFILE_FIELDS = ["priorRoles", "experience"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export const PROFILE_LIMITS: Record<ProfileField, { words: number; chars: number }> = {
  priorRoles: { words: 50, chars: 400 },
  experience: { words: 100, chars: 800 },
};

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\u2800\u3164\uFFA0]/u;

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

export function checkProfileField(field: ProfileField, raw: string): { value: string } | { error: string } {
  const text = raw.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (INVISIBLE.test(text.replace(/\n/g, ""))) return { error: "Use plain text without control characters" };
  const { words, chars } = PROFILE_LIMITS[field];
  if (wordCount(text) > words) return { error: `Keep it to ${words} words` };
  if (Array.from(text).length > chars) return { error: `Keep it under ${chars} characters` };
  return { value: text };
}
