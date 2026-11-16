export const ROBOTS_USER_AGENT = "CAC-EventsBot";

type Rule = { allow: boolean; pattern: string };
type Group = { agents: string[]; rules: Rule[] };

export function parseRobots(body: string): Group[] {
  const groups: Group[] = [];
  let current: Group | undefined;
  let lastWasAgent = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || (key !== "allow" && key !== "disallow")) continue;
    if (key === "disallow" && value === "") continue;
    current.rules.push({ allow: key === "allow", pattern: value });
  }
  return groups;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + regex + (anchored ? "$" : "")).test(path);
}

export function isAllowed(body: string, url: string, userAgent = ROBOTS_USER_AGENT): boolean {
  const { pathname, search } = new URL(url);
  const path = pathname + search;
  if (path === "/robots.txt") return true;
  const groups = parseRobots(body);
  const ua = userAgent.toLowerCase();
  const group =
    groups.find((g) => g.agents.some((a) => a !== "*" && ua.includes(a))) ??
    groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  let best: Rule | undefined;
  for (const rule of group.rules) {
    if (!matches(rule.pattern, path)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}
