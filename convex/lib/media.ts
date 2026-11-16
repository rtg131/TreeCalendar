export function httpsUrl(value: string | null | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
