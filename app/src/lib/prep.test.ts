import { expect, test } from "vitest";
import { recipientSuggestions } from "./prep";

test("follow-up suggestions only use listed hosts, organizers, and explicit sponsors", () => {
  expect(recipientSuggestions({ hosts: ["Cal Hacks"], organizer: "Cal Hacks", description: "A student hackathon. Sponsored by Lowercarbon Capital." })).toEqual(["Cal Hacks", "Lowercarbon Capital"]);
  expect(recipientSuggestions({ hosts: [], description: "Meet investors and mentors" })).toEqual([]);
});
