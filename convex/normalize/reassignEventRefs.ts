import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { RATING_SCALE, scaledRating } from "../attendanceModel";
import { deletePrepReferences, rekeyPrepReferences } from "../prepReferences";

const MAX_MERGE_RECORDS = 4000;

async function mergeAttendance(ctx: MutationCtx, from: Id<"events">, to: Id<"events">) {
  const records = (await Promise.all([from, to].map((eventId) =>
    ctx.db.query("attendance").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(MAX_MERGE_RECORDS + 1),
  ))).flat();
  if (records.length > MAX_MERGE_RECORDS) throw new Error("Attendance merge exceeds transaction limit");

  const byUser = new Map<Id<"users">, Doc<"attendance">[]>();
  for (const record of records) {
    const group = byUser.get(record.userId) ?? [];
    group.push(record);
    byUser.set(record.userId, group);
  }

  let ratingCount = 0;
  let ratingSum = 0;
  let investorConfirmations = 0;
  const responseRank = (r: Doc<"attendance">) => r.attended === true ? 2 : r.attended === false ? 1 : 0;
  for (const group of byUser.values()) {
    group.sort((a, b) => responseRank(b) - responseRank(a)
      || Number(b.eventId === to) - Number(a.eventId === to)
      || a._creationTime - b._creationTime
      || a._id.localeCompare(b._id));
    const winner = group[0];
    const target = group.find((r) => r.eventId === to) ?? winner;
    const dismissals = group.flatMap((r) => r.dismissedAt === undefined ? [] : [r.dismissedAt]);
    const response = {
      attended: winner.attended,
      rating: scaledRating(winner),
      investors: winner.investors,
      note: winner.note ?? group.find((r) => r.note !== undefined)?.note,
    };
    await ctx.db.patch(target._id, {
      eventId: to,
      going: group.some((r) => r.going),
      dismissedAt: dismissals.length ? Math.min(...dismissals) : undefined,
      ...response,
      ratingScale: RATING_SCALE,
    });
    for (const record of group) if (record._id !== target._id) await ctx.db.delete(record._id);
    if (response.attended === true && response.rating !== undefined) {
      ratingCount++;
      ratingSum += response.rating;
      investorConfirmations += Number(response.investors === "yes");
    }
  }

  const totals = await Promise.all([from, to].map((eventId) =>
    ctx.db.query("attendance_totals").withIndex("by_event", (q) => q.eq("eventId", eventId)).unique(),
  ));
  const [droppedTotal, canonicalTotal] = totals;
  if (droppedTotal) await ctx.db.delete(droppedTotal._id);
  const values = { eventId: to, ratingCount, ratingSum, investorConfirmations, ratingScale: RATING_SCALE };
  if (records.length) {
    if (canonicalTotal) await ctx.db.patch(canonicalTotal._id, values);
    else await ctx.db.insert("attendance_totals", values);
  } else if (canonicalTotal) await ctx.db.delete(canonicalTotal._id);
}

export async function reassignEventRefs(ctx: MutationCtx, fromId: Id<"events">, toId: Id<"events">) {
  if (fromId === toId) return;
  const saves = await ctx.db.query("saves").withIndex("by_event", (q) => q.eq("eventId", fromId)).take(MAX_MERGE_RECORDS + 1);
  if (saves.length > MAX_MERGE_RECORDS) throw new Error("Save merge exceeds transaction limit");
  for (const save of saves) {
    const already = await ctx.db.query("saves").withIndex("by_user_event", (q) => q.eq("userId", save.userId).eq("eventId", toId)).unique();
    if (already) await ctx.db.delete(save._id);
    else await ctx.db.patch(save._id, { eventId: toId });
  }
  await mergeAttendance(ctx, fromId, toId);
  await rekeyPrepReferences(ctx, fromId, toId);
  await mergeConnectionRefs(ctx, fromId, toId);
}

async function mergeConnectionRefs(ctx: MutationCtx, from: Id<"events">, to: Id<"events">) {
  const [hosts, connections] = await Promise.all([
    ctx.db.query("event_hosts").withIndex("by_event", (q) => q.eq("eventId", from)).take(MAX_MERGE_RECORDS + 1),
    ctx.db.query("connections").withIndex("by_event", (q) => q.eq("eventId", from)).take(MAX_MERGE_RECORDS + 1),
  ]);
  if (hosts.length + connections.length > MAX_MERGE_RECORDS) throw new Error("Connection merge exceeds transaction limit");
  for (const host of hosts) {
    const already = await ctx.db.query("event_hosts").withIndex("by_event", (q) => q.eq("eventId", to).eq("companyId", host.companyId)).unique();
    if (already) await ctx.db.delete(host._id);
    else await ctx.db.patch(host._id, { eventId: to });
  }
  for (const connection of connections) await ctx.db.patch(connection._id, { eventId: to });
}

export async function deleteEventRefs(ctx: MutationCtx, eventId: Id<"events">) {
  const groups = await Promise.all([
    ctx.db.query("saves").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(MAX_MERGE_RECORDS + 1),
    ctx.db.query("attendance").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(MAX_MERGE_RECORDS + 1),
    ctx.db.query("attendance_totals").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(MAX_MERGE_RECORDS + 1),
    ctx.db.query("event_hosts").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(MAX_MERGE_RECORDS + 1),
  ]);
  const connections = await ctx.db.query("connections").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(MAX_MERGE_RECORDS + 1);
  const records = groups.flat();
  if (records.length + connections.length > MAX_MERGE_RECORDS) throw new Error("Event reference cleanup exceeds transaction limit");
  for (const record of records) await ctx.db.delete(record._id);
  await deletePrepReferences(ctx, eventId);
  for (const connection of connections) await ctx.db.patch(connection._id, { eventId: undefined });
  return { saves: groups[0].length };
}
