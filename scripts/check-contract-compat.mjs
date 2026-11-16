#!/usr/bin/env node
// Compares the contract model with the one of a base revision and fails on a
// change that breaks a client still running the base (ADR 0270): contract
// changes are expand-then-contract, so a field or route leaves only after a
// release in which it was marked deprecated.
//   node scripts/check-contract-compat.mjs [base-revision]
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MODEL_PATH = "backend/api/contract/contract.json";

const describe = (schema) => schema.elem ? `${schema.kind}<${describe(schema.elem)}>`
  : schema.kind === "ref" ? "object" : schema.kind;

// A reader of the base decodes legacy_id as string or number, so the move to
// a string identifier is the one kind change that does not break it.
const sameKind = (before, after) => before.kind === after.kind
  || (before.kind === "legacy_id" && after.kind === "id");

export function breakingChanges(base, head) {
  const breaking = [];
  const baseTypes = new Map(base.types.map((type) => [type.name, type]));
  const headTypes = new Map(head.types.map((type) => [type.name, type]));
  const seen = new Set();

  // A response may gain fields and may turn optional into required. A reader
  // breaks when a field disappears, changes its kind, or starts to be null
  // or absent. Types are compared by shape, so renaming a Go type is free.
  function compare(where, before, after) {
    if (!sameKind(before, after)) {
      breaking.push(`${where}: ${describe(before)} became ${describe(after)}`);
      return;
    }
    if (!before.nullable && after.nullable) breaking.push(`${where}: may now be null`);
    if (before.elem) compare(`${where}[]`, before.elem, after.elem);
    if (before.kind !== "ref") return;
    const pair = `${before.ref}>${after.ref}`;
    if (seen.has(pair)) return;
    seen.add(pair);
    const beforeType = baseTypes.get(before.ref);
    const afterType = headTypes.get(after.ref);
    const afterFields = new Map(afterType.fields.map((field) => [field.name, field]));
    for (const field of beforeType.fields) {
      const next = afterFields.get(field.name);
      const at = `${where}.${field.name}`;
      if (!next) {
        // A bound body may drop a field: Go ignores what an older client sends.
        if (!field.deprecated && !beforeType.request) breaking.push(`${at}: removed without a release as deprecated`);
        continue;
      }
      if (!beforeType.request && !field.optional && next.optional) breaking.push(`${at}: may now be absent`);
      compare(at, field.schema, next.schema);
    }
  }

  const headRoutes = new Map(head.routes.map((route) => [`${route.method} ${route.pattern}`, route]));
  for (const route of base.routes) {
    const key = `${route.method} ${route.pattern}`;
    const next = headRoutes.get(key);
    if (!next) {
      if (!route.deprecated) breaking.push(`${key}: route removed without a release as deprecated`);
      continue;
    }
    for (const portal of route.portals) {
      if (!next.portals.includes(portal)) breaking.push(`${key}: portal ${portal} removed`);
    }
    if (route.request && next.request) compare(`${key} request`, route.request, next.request);
    const cases = route.variants ? Object.entries(route.variants.cases) : [["", route.response]];
    for (const [value, schema] of cases) {
      const where = value ? `${key} ?${route.variants.query_param}=${value}` : key;
      const after = value ? next.variants?.cases[value] : next.response;
      if (!after) breaking.push(`${where}: response removed`);
      else compare(where, schema, after);
    }
  }
  return breaking;
}

function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const base = argv[0] ?? "origin/development";
  let baseModel;
  try {
    baseModel = execFileSync("git", ["show", `${base}:${MODEL_PATH}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
  } catch {
    // The base registers no route yet, so nothing can break.
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${base}^{commit}`], { cwd: root, stdio: "ignore" });
    console.log(`contract: ${base} has no model, nothing to compare`);
    return;
  }
  const breaking = breakingChanges(JSON.parse(baseModel), JSON.parse(readFileSync(join(root, MODEL_PATH), "utf8")));
  if (breaking.length > 0) {
    console.error(`The contract breaks clients of ${base} (${breaking.length}). Mark the field or route deprecated for one release first (ADR 0270):\n${breaking.join("\n")}`);
    process.exit(1);
  }
  console.log(`contract: compatible with ${base}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main(process.argv.slice(2));
