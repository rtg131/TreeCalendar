import { v, type Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isApproved } from "./connections";

const MAX_CLAIMS = 20;

export const hostCompany = v.object({ _id: v.id("companies"), name: v.string(), logo: v.optional(v.string()) });
export type HostCompany = Infer<typeof hostCompany>;

export async function hostCompanyFor(ctx: Pick<QueryCtx, "db">, eventId: Id<"events">): Promise<HostCompany | null> {
  const claims = await ctx.db
    .query("event_hosts")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .take(MAX_CLAIMS);
  const approved = claims.filter(isApproved).sort((a, b) => a.createdAt - b.createdAt);
  const companies = await Promise.all(approved.map((c) => ctx.db.get(c.companyId)));
  const company = companies.find((c) => c !== null && c.verifiedAt !== undefined);
  if (!company) return null;
  return company.logo ? { _id: company._id, name: company.name, logo: company.logo } : { _id: company._id, name: company.name };
}

export async function withHostCompanies<T extends { _id: Id<"events"> }>(ctx: Pick<QueryCtx, "db">, events: T[]): Promise<(T & { hostCompany?: HostCompany })[]> {
  const hosts = await Promise.all(events.map((e) => hostCompanyFor(ctx, e._id)));
  return events.map((e, i) => {
    const host = hosts[i];
    return host ? { ...e, hostCompany: host } : e;
  });
}
