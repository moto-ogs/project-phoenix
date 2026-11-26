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

// The legacy_id decoder on a released base already accepted a decimal
// string in answers, and Go reads a request identifier as a decimal string,
// so a string of the base may become an id there.
// Naming the form of a string narrows the type, not the wire. Typing a JSON
// answer or an open object does not break a reader of the older schema.
const openObject = (schema) => schema.kind === "map" && schema.elem.kind === "json";
const sameKind = (before, after, request) => before.kind === after.kind
  || (before.kind === "string" && ["enum", "date", "clock", "id"].includes(after.kind))
  || (!request && (before.kind === "json" || (openObject(before) && after.kind === "ref")))
  || (before.kind === "legacy_id" && after.kind === "id");

// ADR 0270, #8085: the old staff-shell projection and its only field readers
// are cut over together. Match the old Go instantiation, not future versions
// of the same route. All retained fields still go through the normal checks.
const OLD_STAFF_NAVIGATION = "identityaccess.NavigationResponse[github.com/moto-ogs/project-phoenix/modules/peopledirectory.Staff,*github.com/moto-ogs/project-phoenix/roots/owners.CallerGroupRow,*github.com/moto-ogs/project-phoenix/modules/studentpresence/internal/ports.ActiveGroup]";
const RETIRED_STAFF_NAVIGATION_FIELDS = new Set([
  "educational_groups", "incomplete", "supervised_groups", "unavailable_sections",
]);

// ADR 0270: the staff shell has already switched to supervision-context.
// Only the two old tenant-only GET responses may leave without deprecation.
const RETIRED_SUPERVISION_ROUTES = new Map([
  ["GET /api/active/supervisors/all", "presence.ActiveGroupResponse"],
  ["GET /api/students/ogs-group-navigation", "grouplive.NavigationGroup"],
]);

export function breakingChanges(base, head) {
  const breaking = [];
  const baseTypes = new Map(base.types.map((type) => [type.name, type]));
  const headTypes = new Map(head.types.map((type) => [type.name, type]));
  const seen = new Set();

  // A response may gain fields and may turn optional into required. A reader
  // breaks when a field disappears, changes its kind, or starts to be null
  // or absent. Types are compared by shape, so renaming a Go type is free.
  function compare(where, before, after, request = false, refinesJSON = false) {
    // A documented refinement of existing validation does not narrow what
    // a previously successful caller could send.
    const alreadyValidated = request && refinesJSON
      && (before.kind === "json" || (openObject(before) && after.kind === "ref"));
    if (!sameKind(before, after, request) && !alreadyValidated) {
      breaking.push(`${where}: ${describe(before)} became ${describe(after)}`);
      return;
    }
    if (!request && !before.legacy_json && before.kind !== "json" && after.legacy_json) {
      breaking.push(`${where}: may now return other JSON shapes`);
    }
    if (!request && !before.nullable && after.nullable) breaking.push(`${where}: may now be null`);
    if (before.elem && after.elem) compare(`${where}[]`, before.elem, after.elem, request, refinesJSON);
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
        const staffNavigationCutover = where === "GET /api/me/navigation"
          && beforeType.go_type === OLD_STAFF_NAVIGATION
          && RETIRED_STAFF_NAVIGATION_FIELDS.has(field.name);
        if (!field.deprecated && !beforeType.request && !staffNavigationCutover) breaking.push(`${at}: removed without a release as deprecated`);
        continue;
      }
      if (!beforeType.request && !field.optional && next.optional) breaking.push(`${at}: may now be absent`);
      compare(at, field.schema, next.schema, Boolean(beforeType.request), Boolean(next.refines_json?.trim()));
    }
  }

  const headRoutes = new Map(head.routes.map((route) => [`${route.method} ${route.pattern}`, route]));
  for (const route of base.routes) {
    const key = `${route.method} ${route.pattern}`;
    const next = headRoutes.get(key);
    if (!next) {
      const retiredType = RETIRED_SUPERVISION_ROUTES.get(key);
      const retiredSupervisionRoute = retiredType !== undefined
        && route.portals.length === 1 && route.portals[0] === "tenant"
        && route.response?.kind === "array" && route.response.elem.kind === "ref"
        && baseTypes.get(route.response.elem.ref)?.go_type === retiredType;
      if (!route.deprecated && !retiredSupervisionRoute) breaking.push(`${key}: route removed without a release as deprecated`);
      continue;
    }
    for (const portal of route.portals) {
      if (!next.portals.includes(portal)) breaking.push(`${key}: portal ${portal} removed`);
    }
    if (route.request && next.request) compare(`${key} request`, route.request, next.request, true);
    // A multipart upload and a JSON body are different requests: a client
    // of the base would send the other kind.
    if (Boolean(route.multipart) !== Boolean(next.multipart)) {
      breaking.push(`${key} request: ${route.multipart ? "multipart" : "json"} became ${next.multipart ? "multipart" : "json"}`);
    }
    // Both envelopes require status and data; only the paginated one also
    // requires pagination. Adding it is safe because readers ignore extras.
    if (route.paginated && !next.paginated) breaking.push(`${key}.pagination: may now be absent`);
    // No data and a file are explicit response kinds, not a removed
    // response. A reader of one cannot read another, so a change either way
    // breaks old readers.
    const defaultResponse = (entry) => entry.file ? { kind: "file" } : entry.no_data ? { kind: "no_data" } : entry.variants
      ? entry.variants.cases[entry.variants.default] : entry.response;
    // Compare what an existing request selects, not just equal case names.
    // No selector uses the default; a renamed selector ignores the old key.
    const cases = [["", defaultResponse(route)], ...(route.variants ? Object.entries(route.variants.cases) : [])];
    for (const [value, schema] of cases) {
      const where = value ? `${key} ?${route.variants.query_param}=${value}` : key;
      const after = value && route.variants.query_param === next.variants?.query_param
        ? next.variants.cases[value] : defaultResponse(next);
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
