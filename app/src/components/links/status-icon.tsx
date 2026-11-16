import { ActivityIndicator } from "react-native";

import { AlertIcon, CheckIcon, SearchIcon } from "@/components/icons";
import { colors } from "@/constants/theme";
import type { LinkStatus } from "@/lib/links";

export const STATUS_COLOR: Record<LinkStatus, string> = {
  pending: colors.muted,
  added: colors.success,
  duplicate: colors.muted,
  needs_review: colors.muted,
  rejected: colors.danger,
};

export function StatusIcon({ status, size = 16 }: { status: LinkStatus; size?: number }) {
  const color = STATUS_COLOR[status];
  if (status === "pending") return <ActivityIndicator size="small" color={color} />;
  if (status === "added" || status === "duplicate") return <CheckIcon size={size} color={color} />;
  if (status === "needs_review") return <SearchIcon size={size} color={color} />;
  return <AlertIcon size={size} color={color} />;
}
