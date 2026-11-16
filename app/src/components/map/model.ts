export type Coordinates = { lat: number; lng: number };
export type LocatedEvent = { _id: string; isOnline: boolean; lat?: number; lng?: number };
export type MarkerGroup = Coordinates & { ids: string[]; saved: boolean };

export function validCoordinates(event: { lat?: number; lng?: number }): event is Coordinates {
  return typeof event.lat === "number" && typeof event.lng === "number" &&
    Number.isFinite(event.lat) && Number.isFinite(event.lng) &&
    Math.abs(event.lat) <= 90 && Math.abs(event.lng) <= 180;
}

export function mapEvents<T extends LocatedEvent>(events: T[]) {
  const online = events.filter((event) => event.isOnline).length;
  const located = events.filter((event): event is T & Coordinates => !event.isOnline && validCoordinates(event));
  return { events: located.slice(0, 60), online, unlocated: events.length - online - located.length };
}

export function selectedEvent<T extends { _id: string }>(events: T[], id: string | null): T | undefined {
  return events.find((event) => event._id === id) ?? events[0];
}

export function markerGroups(events: (LocatedEvent & Coordinates)[], savedIds: Set<string>): MarkerGroup[] {
  const groups = new Map<string, MarkerGroup>();
  for (const event of events) {
    const key = `${event.lat},${event.lng}`;
    const group = groups.get(key) ?? { lat: event.lat, lng: event.lng, ids: [], saved: false };
    group.ids.push(event._id);
    group.saved ||= savedIds.has(event._id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export const PIN_SIZE = 34;
export const SELECTED_PIN_SIZE = 42;
export const CLUSTER_PX = 46;

export type Cluster<G extends MarkerGroup> = Coordinates & {
  ids: string[];
  saved: boolean;
  groups: G[];
  bounds: { south: number; west: number; north: number; east: number };
};

export function clusterGroups<G extends MarkerGroup>(groups: G[], radiusDeg: number): Cluster<G>[] {
  const clusters: Cluster<G>[] = [];
  for (const group of [...groups].sort((a, b) => b.ids.length - a.ids.length)) {
    const scale = Math.cos((group.lat * Math.PI) / 180);
    const near = clusters.find((c) => Math.abs(c.lng - group.lng) < radiusDeg && Math.abs(c.lat - group.lat) / scale < radiusDeg);
    if (!near) {
      clusters.push({ lat: group.lat, lng: group.lng, ids: [...group.ids], saved: group.saved, groups: [group], bounds: { south: group.lat, west: group.lng, north: group.lat, east: group.lng } });
      continue;
    }
    near.groups.push(group);
    near.ids.push(...group.ids);
    near.saved ||= group.saved;
    near.lat = near.groups.reduce((sum, g) => sum + g.lat, 0) / near.groups.length;
    near.lng = near.groups.reduce((sum, g) => sum + g.lng, 0) / near.groups.length;
    near.bounds = {
      south: Math.min(near.bounds.south, group.lat),
      west: Math.min(near.bounds.west, group.lng),
      north: Math.max(near.bounds.north, group.lat),
      east: Math.max(near.bounds.east, group.lng),
    };
  }
  return clusters;
}

export function nextInGroup(ids: string[], selectedId?: string): string {
  return ids[(ids.indexOf(selectedId ?? "") + 1) % ids.length];
}
