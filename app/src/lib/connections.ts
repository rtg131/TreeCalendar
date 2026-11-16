import { ConvexError } from "convex/values";
import { useQuery } from "convex/react";
import { Alert, Platform } from "react-native";

import { api } from "@/convex/_generated/api";
import { useDeviceId } from "@/lib/device";

const COPY: Record<string, string> = {
  not_onboarded: "Finish setting up your Scout profile first",
  not_found: "That's no longer available. It may have been withdrawn or removed",
  forbidden: "You don't have permission to do that",
  not_eligible: "Connections open after an event ends, between talent who went and the companies that hosted it",
  blocked: "This connection was declined recently. You can reach out again 30 days after the decline",
  rate_limited: "You've reached today's limit for new interests. Try again tomorrow",
  invalid: "Check what you entered and try again",
  company_unverified: "Scout reviews new companies before they can claim events or reach talent. This company is pending verification",
  host_required: "Company features are for verified hosts. Verify your work email to use them",
  event_ended: "This event has already ended, so it can't be marked Going",
  personal_email: "Use your work or school email. Personal addresses like Gmail can't verify a host",
  email_not_configured: "Scout can't send verification emails right now. Try again later",
  email_send_failed: "We couldn't send the code. Check the address and try again",
  invalid_code: "That code isn't right. Check the latest email and try again",
  code_expired: "That code has expired. Send a new one",
  too_many_attempts: "Too many wrong codes. Send a new one",
  domain_taken: "Your company is already on Scout. Ask to join it instead",
};

const SERVER_DETAIL = new Set(["invalid", "forbidden", "rate_limited", "not_eligible", "blocked", "host_required"]);

export function errorCode(error: unknown) {
  return error instanceof ConvexError && typeof error.data?.code === "string" ? (error.data.code as string) : null;
}

export function errorCopy(error: unknown) {
  const code = errorCode(error);
  if (!code) return "Couldn't reach Scout. Check your connection and try again";
  const detail = error instanceof ConvexError && typeof error.data?.message === "string" ? (error.data.message as string) : null;
  if (detail && SERVER_DETAIL.has(code)) return detail;
  return COPY[code] ?? detail ?? "Something went wrong. Try again";
}

export function useHostStatus() {
  const deviceId = useDeviceId();
  return useQuery(api.hosts.status, deviceId ? { deviceId } : "skip");
}

export function useIsVerifiedHost() {
  const status = useHostStatus();
  return status === undefined ? undefined : status.verified;
}

export const isVerified = (company: { verified?: boolean }) => company.verified === true;
export const isPendingVerification = (company: { verified?: boolean }) => company.verified === false;

export const slugify = (name: string) =>
  name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export const eventEnded = (event: { startTime: number; endTime?: number }, now = Date.now()) =>
  (event.endTime ?? event.startTime + 3 * 3_600_000) <= now;

export const MESSAGE_LIMIT = 500;
export const CHAT_LIMIT = 2000;

export function confirm(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? false);
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );
}

export function shortDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function timeAgo(ms: number, now = Date.now()) {
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return shortDate(ms);
}
