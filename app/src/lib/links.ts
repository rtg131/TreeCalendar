export type LinkStatus = "pending" | "added" | "duplicate" | "needs_review" | "rejected";

const URL_PATTERN = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?([/?#]\S*)?$/i;

export function checkLink(input: string): { url: string } | { error: string } {
  const text = input.trim();
  if (!text) return { error: "Paste a link to an event page" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^https?:\/\//i.test(text)) return { error: "Only http and https links work" };
  if (!URL_PATTERN.test(text)) return { error: "That doesn't look like a link. Check it and try again" };
  return { url: /^https?:\/\//i.test(text) ? text : `https://${text}` };
}

export function linkParts(url: string) {
  const bare = url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  const slash = bare.indexOf("/");
  return slash === -1 ? { host: bare, path: "" } : { host: bare.slice(0, slash), path: bare.slice(slash) };
}

export const STATUS_LABEL: Record<LinkStatus, string> = {
  pending: "Checking",
  added: "Added",
  duplicate: "Already listed",
  needs_review: "Needs review",
  rejected: "Not added",
};

export function timeAgo(ms: number, now = Date.now()) {
  const min = Math.round((now - ms) / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "Yesterday" : `${d} days ago`;
}
