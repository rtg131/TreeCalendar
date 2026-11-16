import { ConvexError } from "convex/values";

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, type AccountErrorCode } from "@/convex/lib/account";

export type PasswordErrors = { password?: string; confirm?: string };

export function checkPassword(password: string, confirm: string): PasswordErrors {
  if (password.length < MIN_PASSWORD_LENGTH) return { password: `Use at least ${MIN_PASSWORD_LENGTH} characters` };
  if (password.length > MAX_PASSWORD_LENGTH) return { password: `Use at most ${MAX_PASSWORD_LENGTH} characters` };
  if (confirm !== password) return { confirm: "Passwords don't match" };
  return {};
}

const MESSAGES: Record<AccountErrorCode, string> = {
  INVALID_CREDENTIALS: "Email or password is incorrect",
  SIGN_UP_FAILED: "Couldn't create an account. If you already have one, sign in instead",
  INVALID_PASSWORD: `Use ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters`,
  UNSUPPORTED_FLOW: "That isn't available yet",
};

export function accountError(e: unknown): { code: AccountErrorCode | null; message: string } {
  const code = e instanceof ConvexError && typeof e.data === "string" && e.data in MESSAGES ? (e.data as AccountErrorCode) : null;
  return { code, message: code ? MESSAGES[code] : "Couldn't reach Scout. Check your connection and try again" };
}
