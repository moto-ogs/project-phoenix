#!/usr/bin/env node
// Fails when a pull request adds a pass-through route file (#2352). A portal
// answers its backend routes through one catalog proxy that forwards what the
// contract registers (ADR 0270), so a new `route.ts` whose only code is
// `proxyGet(...)` and its siblings has no place any more.
//
// The table test `frontend/src/app/api/proxy-routes.test.ts` holds one reviewed
// row per pass-through route and method in `frontend/src/test/proxy-routes/`.
// This check compares those rows with the base revision: the register may
// shrink and a row may change its backend path, but it gains no route or
// method. A route with behavior of its own (session, upload, file answer,
// stream) is no pass-through, has no row and is not affected.
//   node scripts/check-proxy-routes.mjs [base-revision]
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REGISTER_PATH = "frontend/src/test/proxy-routes";

// A row reads "METHOD portal /backend/path [raw] [query=a,b] [max=n]".
const methodOf = (row) => row.split(" ")[0];

/** rows maps a route directory to its rows; the result names what head adds. */
export function addedPassThroughs(base, head) {
  const added = [];
  for (const [route, rows] of Object.entries(head)) {
    const known = new Set((base[route] ?? []).map(methodOf));
    for (const row of rows) {
      if (!known.has(methodOf(row))) added.push(`${route}: ${row}`);
    }
  }
  return added.sort();
}

export function mergeFragments(texts) {
  const rows = {};
  for (const text of texts) Object.assign(rows, JSON.parse(text));
  return rows;
}

function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const base = argv[0] ?? "origin/development";
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  git("rev-parse", "--verify", "--quiet", `${base}^{commit}`);
  const baseFiles = git("ls-tree", "-r", "--name-only", base, "--", REGISTER_PATH).split("\n").filter((file) => file.endsWith(".json"));
  const baseRows = mergeFragments(baseFiles.map((file) => git("show", `${base}:${file}`)));
  // The register is empty since the last pass-through file left (#2352); git keeps no empty directory.
  const register = join(root, REGISTER_PATH);
  const headFiles = existsSync(register) ? readdirSync(register, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".json")) : [];
  const headRows = mergeFragments(headFiles.map((file) => readFileSync(join(root, REGISTER_PATH, file), "utf8")));
  const added = addedPassThroughs(baseRows, headRows);
  if (added.length > 0) {
    console.error(`New pass-through route files (${added.length}) compared with ${base}:\n${added.join("\n")}\n
A portal forwards its backend routes through one catalog proxy (#2352, ADR 0270).
Instead of a route.ts, register the backend route in the contract:
  1. Add a common.RouteContract to the RouteContracts function of the owner's http package
     (method, pattern below the mount, portal, query, request and response type).
  2. Mount it in contractRegistrations (backend/api/route_contracts.go) if the owner is new there.
  3. Run: scripts/run-go-toolchain.sh go -C backend run . gencontract
  4. Delete the route.ts and its row; app/api/<portal>/[...path]/route.ts answers the path.
A route with behavior of its own (session, upload, file answer, stream) is no pass-through and needs no row.
If ${base} already removed this route, update the branch.`);
    process.exit(1);
  }
  console.log(`proxy routes: no new pass-through route compared with ${base}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main(process.argv.slice(2));
