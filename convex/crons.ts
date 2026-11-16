import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("run due feeds", { minutes: 1 }, internal.ingest.runDue, {});
crons.daily("refresh demo seed events", { hourUTC: 11, minuteUTC: 0 }, internal.seed.run, {});

export default crons;
