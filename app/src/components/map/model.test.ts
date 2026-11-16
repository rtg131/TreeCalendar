import { describe, expect, it } from "vitest";
import { clusterGroups, mapEvents, markerGroups, nextInGroup, selectedEvent, validCoordinates } from "./model";

describe("event map", () => {
  it("validates finite, complete coordinates without inventing a location", () => {
    for (const point of [{}, { lat: 37 }, { lat: NaN, lng: 2 }, { lat: 91, lng: 2 }, { lat: 0, lng: Infinity }, { lat: 0, lng: -181 }]) expect(validCoordinates(point)).toBe(false);
    expect(validCoordinates({ lat: 0, lng: 0 })).toBe(true);
    expect(validCoordinates({ lat: -90, lng: 180 })).toBe(true);
  });
  it("excludes online and unlocated events, counts exclusions, and bounds rendering", () => {
    const located = Array.from({ length: 65 }, (_, i) => ({ _id: String(i), isOnline: false, lat: 37, lng: -122 }));
    const result = mapEvents([...located, { _id: "online", isOnline: true, lat: 37, lng: -122 }, { _id: "missing", isOnline: false, lat: NaN, lng: 0 }]);
    expect(result.events).toHaveLength(60);
    expect(result.online).toBe(1);
    expect(result.unlocated).toBe(1);
  });
  it("keeps selection matched to the current filter and handles empty results", () => {
    expect(selectedEvent([{ _id: "a" }, { _id: "b" }], "b")?._id).toBe("b");
    expect(selectedEvent([{ _id: "a" }], "removed")?._id).toBe("a");
    expect(selectedEvent([], "removed")).toBeUndefined();
  });
  it("groups colocated events without shifting pins and cycles their selection", () => {
    const groups = markerGroups([{ _id: "a", isOnline: false, lat: 37, lng: -122 }, { _id: "b", isOnline: false, lat: 37, lng: -122 }], new Set(["b"]));
    expect(groups).toEqual([{ lat: 37, lng: -122, ids: ["a", "b"], saved: true }]);
    expect(nextInGroup(groups[0].ids)).toBe("a");
    expect(nextInGroup(groups[0].ids, "a")).toBe("b");
    expect(nextInGroup(groups[0].ids, "b")).toBe("a");
  });
  it("clusters nearby groups at the current zoom and keeps distant ones apart", () => {
    const sf = { lat: 37.78, lng: -122.41, ids: ["a"], saved: false };
    const soma = { lat: 37.781, lng: -122.405, ids: ["b", "c"], saved: true };
    const sj = { lat: 37.33, lng: -121.89, ids: ["d"], saved: false };
    const zoomedOut = clusterGroups([sf, soma, sj], 0.05);
    expect(zoomedOut).toHaveLength(2);
    const city = zoomedOut.find((c) => c.ids.includes("a"))!;
    expect(city.ids.sort()).toEqual(["a", "b", "c"]);
    expect(city.saved).toBe(true);
    expect(city.groups).toHaveLength(2);
    expect(city.bounds).toEqual({ south: 37.78, west: -122.41, north: 37.781, east: -122.405 });
    expect(city.lat).toBeCloseTo(37.7805);
    expect(clusterGroups([sf, soma, sj], 0.001)).toHaveLength(3);
    expect(clusterGroups([], 1)).toEqual([]);
  });
});
