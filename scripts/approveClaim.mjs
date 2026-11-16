#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const [claimId, ...convexArgs] = process.argv.slice(2);
if (!claimId) {
  console.error("Usage: pnpm approve:claim <claimId> [convex run flags, e.g. --prod]");
  process.exit(1);
}
execFileSync("npx", ["convex", "run", "companies:approveClaim", JSON.stringify({ claimId }), ...convexArgs], { stdio: "inherit" });
