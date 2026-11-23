#!/usr/bin/env node
// Compares the catalog lines outside the contract (ADR 0270) with a base
// revision and fails when one joins them without a decision (#2353, #7808).
// Every line of the route catalog (backend/api/testdata/routes) carries a
// marker on its common.RouteContract: a proxied contract, a contract its
// portal's route file serves (RouteFile), or Outside with a reason of a
// closed set. contract.json lists the Outside lines under "outside". A new
// route is typed, so its fields reach the frontend; one with a RouteFile
// needs nothing more. A new Outside line needs a decision: an ADR with a
// number the base lacks that names its catalog line ("POST /api/iot/x").
// The set is read from the model on the base and on the working tree;
// there is no list to maintain. Numeric identifiers need no comparison since
// #2342: the generator refuses every identifier of an answer that is not a
// string (ADR 0300).
//   node scripts/check-contract-shrink.mjs [base-revision]
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_PATH } from "./check-contract-compat.mjs";

export const CATALOG_DIR = "backend/api/testdata/routes";
export const ADR_DIR = "docs/adr";

// A renamed path parameter is the same route; another router is not.
const routeKey = (row) => row.replace(/\{[^}]*\}/g, "{}");
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// An ADR names the whole line: "POST /auth/x" does not name "POST /auth/x/y".
const names = (text, row) => new RegExp(`(^|[\\s\`'"(])${escape(row)}(?=$|[\\s\`'").,;:])`, "m").test(text);

/** "METHOD /pattern" of every line the model keeps outside the contract. */
export function outsideRows(model) {
  return (model.outside ?? []).map((line) => `${line.method} ${line.pattern}`);
}

/** Outside lines of head that base lacks and no new ADR names. */
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
    problems.push(`New catalog lines outside the contract (${rows.length}):\n${rows.join("\n")}\n
Type each route instead (docs/agents/new-route.md, ADR 0270):
  1. Give its common.RouteContract in the owner's RouteContracts function a portal,
     query, request and response type; the portal's catalog proxy serves it.
  2. If the portal's own route file must serve it (it installs a session cookie,
     purges a cache), also name RouteFile with the reason; it stays typed.
  3. Run: scripts/run-go-toolchain.sh go -C backend run . gencontract
A line no portal calls for JSON (a device, webhook or protocol endpoint) keeps
Outside only with a new ADR (a number the base lacks) in docs/adr/ that names
the catalog line as written above, with the reason.`);
  }
  return problems;
}

function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const base = argv[0] ?? "origin/development";
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
  git("rev-parse", "--verify", "--quiet", `${base}^{commit}`);
  // CI's checkout holds no blobs (filter blob:none), and each `git show` of
  // the base would fetch one. A file the branch did not change is the same
  // on the base, so only changed files are read from it.
  const changed = new Set(git("diff", "--name-only", "--no-renames", base, "--", MODEL_PATH, ADR_DIR).split("\n").filter(Boolean));
  const atHead = (file) => readFileSync(join(root, file), "utf8");
  const atBase = (file) => (changed.has(file) ? git("show", `${base}:${file}`) : atHead(file));
  const adr = (file) => file.endsWith(".md");

  if (!git("ls-tree", "--name-only", base, "--", MODEL_PATH).trim()) {
    console.log(`contract registers: ${base} has no model, nothing to compare`);
    return;
  }
  const baseModel = JSON.parse(atBase(MODEL_PATH));
  if (!Array.isArray(baseModel.outside)) {
    console.log(`contract registers: ${base} lists no lines outside the contract, nothing to compare`);
    return;
  }
  const headModel = JSON.parse(atHead(MODEL_PATH));
  // An ADR's number is its identity; a renamed one is not new.
  const number = (file) => file.split("/").at(-1).slice(0, 4);
  const baseADRs = new Set(git("ls-tree", "-r", "--name-only", base, "--", ADR_DIR).split("\n").filter(adr).map(number));
  const headADRs = readdirSync(join(root, ADR_DIR), { recursive: true, encoding: "utf8" })
    .map((file) => `${ADR_DIR}/${file}`).filter(adr);
  const problems = report({
    baseRows: outsideRows(baseModel),
    headRows: outsideRows(headModel),
    newADRs: headADRs.filter((file) => !baseADRs.has(number(file))).map(atHead),
  });
  if (problems.length > 0) {
    console.error(`${problems.join("\n\n")}\n\nCompared with ${base}. If ${base} already removed an entry, update the branch.`);
    process.exit(1);
  }
  console.log(`contract registers: no new line outside the contract compared with ${base}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main(process.argv.slice(2));
