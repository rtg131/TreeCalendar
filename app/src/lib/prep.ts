export function recipientSuggestions(event: { hosts: string[]; organizer?: string; description: string }): string[] {
  const sponsors = [...event.description.matchAll(/(?:sponsored by|sponsors?:)\s+([^.!?\n;]+)/gi)].map((match) => match[1].trim());
  return [...new Set([...event.hosts, event.organizer ?? "", ...sponsors])].filter((name) => name.length > 0 && name.length <= 120).slice(0, 5);
}
