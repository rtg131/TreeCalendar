import { describe, expect, it } from "vitest";

import { clearDraft, readDraft, writeDraft } from "./check-in-draft";

const a = "event_a";
const b = "event_b";

describe("check-in draft store", () => {
  it("starts empty at the first step", () => {
    expect(readDraft(a)).toEqual({ attended: false, note: "" });
  });

  it("keeps step, rating, worth-it answer and note across remounts", () => {
    writeDraft(a, { attended: true });
    writeDraft(a, { rating: 10 });
    writeDraft(a, { investors: "yes" });
    writeDraft(a, { note: "Great founder conversations" });
    expect(readDraft(a)).toEqual({ attended: true, rating: 10, investors: "yes", note: "Great founder conversations" });
  });

  it("keeps drafts separate per event", () => {
    writeDraft(b, { attended: true, rating: 3 });
    expect(readDraft(a).rating).toBe(10);
    expect(readDraft(b)).toEqual({ attended: true, rating: 3, note: "" });
  });

  it("clears a draft once the check-in is sent", () => {
    clearDraft(a);
    expect(readDraft(a)).toEqual({ attended: false, note: "" });
    expect(readDraft(b).rating).toBe(3);
  });
});
