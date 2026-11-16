#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";

const args = process.argv.slice(2);
const undo = args.includes("--unverify");
const byIndex = args.indexOf("--by");
const by = byIndex >= 0 ? args[byIndex + 1] : process.env.VERIFIED_BY ?? userInfo().username;
const rest = args.filter((arg, i) => arg !== "--unverify" && i !== byIndex && i !== byIndex + 1);
const [slug, ...convexArgs] = rest;

if (!slug || (byIndex >= 0 && !by)) {
  console.error("Usage: pnpm verify:company <slug> [--by <reviewer>] [--unverify] [convex run flags, e.g. --prod]");
  process.exit(1);
}

const fn = undo ? "companies:unverify" : "companies:verify";
const payload = JSON.stringify(undo ? { slug } : { slug, by });
execFileSync("npx", ["convex", "run", fn, payload, ...convexArgs], { stdio: "inherit" });
