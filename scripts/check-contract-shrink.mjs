#!/usr/bin/env node
// Compares a debt of the contract (ADR 0270) with a base revision and fails
// when it grows (#2353): the backend routes the contract does not register,
// every route of the
//     route catalog (backend/api/testdata/routes) without a registration. A
//     new route is registered, so its fields are typed and a portal reaches it
//     through its catalog proxy instead of a route file of its own. A route
//     the contract cannot carry (a sign-in step that mints a session, a
//     device or webhook endpoint) needs a decision: an ADR with a number
//     the base lacks that names its catalog line ("POST /auth/example").
// The set is measured on the base and on the working tree; there is no list
// to maintain. Numeric identifiers need no comparison since #2342: the
// generator refuses every identifier of an answer that is not a string
// (ADR 0300), so the register they had is gone.
//   node scripts/check-contract-shrink.mjs [base-revision]
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_PATH } from "./check-contract-compat.mjs";

export const CATALOG_DIR = "backend/api/testdata/routes";
export const ADR_DIR = "docs/adr";

/** "METHOD /pattern" lines of the catalog fragments. */
export function catalogRows(fragments) {
  return fragments.flatMap((text) => text.split("\n").filter((line) => line.trim() !== ""));
}

// A router mounted at "/" shows as "/*/" in the catalog, and a registration
// names the pattern without it (contractRegistrations, route_contracts.go).
const registrationKey = (row) => row.replaceAll("/*/", "/");
// A renamed path parameter is the same route; another router is not.
const routeKey = (row) => row.replace(/\{[^}]*\}/g, "{}");
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// An ADR names the whole line: "POST /auth/x" does not name "POST /auth/x/y".
const names = (text, row) => new RegExp(`(^|[\\s\`'"(])${escape(row)}(?=$|[\\s\`'").,;:])`, "m").test(text);

/** The catalog rows no route of the model registers. */
export function unregisteredRows(rows, model) {
  const registered = new Set(model.routes.map((route) => `${route.method} ${route.pattern}`));
  return rows.filter((row) => !registered.has(row) && !registered.has(registrationKey(row)));
}

/** Unregistered rows of head that base lacks and no new ADR names. */
export function addedRows(baseRows, headRows, newADRs = []) {
  const known = new Set(baseRows.map(routeKey));
  return [...new Set(headRows)]
    .filter((row) => !known.has(routeKey(row)))
    .filter((row) => !newADRs.some((text) => names(text, row)))
    .sort();
}

export function report({ baseRows, headRows, newADRs = [] }) {
  const problems = [];
  const rows = addedRows(baseRows, headRows, newADRs);
  if (rows.length > 0) {
    problems.push(`New backend routes without a contract (${rows.length}):\n${rows.join("\n")}\n
Register each route in the contract (ADR 0270):
  1. Add a common.RouteContract to the RouteContracts function of the owner's http package
     (method, pattern below the mount, portal, query, request and response type).
  2. Mount it in contractRegistrations (backend/api/route_contracts.go) if the owner is new there.
  3. Run: scripts/run-go-toolchain.sh go -C backend run . gencontract
A route the contract cannot carry (a sign-in step that mints a session, a
device or webhook endpoint) needs a new ADR (a number the base lacks) in docs/adr/ that
names the catalog line as written above, with the reason.`);
  }
  return problems;
}

function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const base = argv[0] ?? "origin/development";
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
  git("rev-parse", "--verify", "--quiet", `${base}^{commit}`);
  const dirs = [MODEL_PATH, CATALOG_DIR];
  // CI's checkout holds no blobs (filter blob:none), and each `git show` of
  // the base would fetch one. A file the branch did not change is the same
  // on the base, so only changed files are read from it.
  const changed = new Set(git("diff", "--name-only", "--no-renames", base, "--", ...dirs).split("\n").filter(Boolean));
  const atHead = (file) => readFileSync(join(root, file), "utf8");
  const atBase = (file) => (changed.has(file) ? git("show", `${base}:${file}`) : atHead(file));
  const baseFiles = (dir, keep) => git("ls-tree", "-r", "--name-only", base, "--", dir).split("\n").filter(keep);
  const headFiles = (dir, keep) => readdirSync(join(root, dir), { recursive: true, encoding: "utf8" })
    .map((file) => `${dir}/${file}`).filter(keep);
  const golden = (file) => file.endsWith(".golden");
  const adr = (file) => file.endsWith(".md");

  if (!git("ls-tree", "--name-only", base, "--", MODEL_PATH).trim()) {
    console.log(`contract registers: ${base} has no model, nothing to compare`);
    return;
  }
  const baseModel = JSON.parse(atBase(MODEL_PATH));
  const headModel = JSON.parse(atHead(MODEL_PATH));
  // An ADR's number is its identity; a renamed one is not new.
  const number = (file) => file.split("/").at(-1).slice(0, 4);
  const baseADRs = new Set(baseFiles(ADR_DIR, adr).map(number));
  const problems = report({
    baseRows: unregisteredRows(catalogRows(baseFiles(CATALOG_DIR, golden).map(atBase)), baseModel),
    headRows: unregisteredRows(catalogRows(headFiles(CATALOG_DIR, golden).map(atHead)), headModel),
    newADRs: headFiles(ADR_DIR, adr).filter((file) => !baseADRs.has(number(file))).map(atHead),
  });
  if (problems.length > 0) {
    console.error(`${problems.join("\n\n")}\n\nCompared with ${base}. If ${base} already removed an entry, update the branch.`);
    process.exit(1);
  }
  console.log(`contract registers: no new route without a contract compared with ${base}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main(process.argv.slice(2));
