import type { Adapter } from "../lib/adapter";
import type { RawEvent } from "../lib/rawEvent";

export const fixtureAdapter: Adapter = {
  source: "fixture",
  async fetch(feed, http) {
    const events = JSON.parse(await http.text(feed.url, "application/json")) as RawEvent[];
    return events.map((event) => ({ ...event, source: "fixture" }));
  },
};
