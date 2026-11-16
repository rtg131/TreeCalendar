export type CheckInDraft = { attended: boolean; rating?: number; investors?: "yes" | "no" | "unsure"; note: string };

const EMPTY: CheckInDraft = { attended: false, note: "" };
const drafts = new Map<string, CheckInDraft>();

export const readDraft = (eventId: string) => drafts.get(eventId) ?? EMPTY;

export function writeDraft(eventId: string, patch: Partial<CheckInDraft>) {
  const next = { ...readDraft(eventId), ...patch };
  drafts.set(eventId, next);
  return next;
}

export const clearDraft = (eventId: string) => drafts.delete(eventId);
