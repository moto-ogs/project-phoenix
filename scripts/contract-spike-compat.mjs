#!/usr/bin/env node
// Spike #2342: compares two contract.json models and names what breaks a
// client that still runs the base version (expand-then-contract).
//   node scripts/contract-spike-compat.mjs <base.json> <head.json>
import { readFileSync } from "node:fs";

const [base, head] = process.argv.slice(2).map((path) => JSON.parse(readFileSync(path, "utf8")));
const breaking = [];
const typesOf = (doc) => new Map(doc.types.map((type) => [type.name, type]));
const describe = (schema) => !schema ? "none" : schema.kind === "ref" ? schema.ref
  : schema.elem ? `${schema.kind}<${describe(schema.elem)}>` : schema.kind;
const seen = new Set();

// A response may gain fields and may turn optional into required. A reader
// breaks when a field disappears, changes its type, or starts to be null/absent.
function compareSchema(where, before, after, baseTypes, headTypes) {
  if (describe(before).replace(/[A-Za-z]+Response|[A-Z]\w+/g, "ref") !== describe(after).replace(/[A-Za-z]+Response|[A-Z]\w+/g, "ref")) {
    breaking.push(`${where}: type ${describe(before)} -> ${describe(after)}`);
    return;
  }
  if (!before.nullable && after.nullable) breaking.push(`${where}: may now be null`);
  if (before.elem) compareSchema(`${where}[]`, before.elem, after.elem, baseTypes, headTypes);
  if (before.kind !== "ref" || seen.has(`${before.ref}>${after.ref}`)) return;
  seen.add(`${before.ref}>${after.ref}`);
  const beforeType = baseTypes.get(before.ref);
  const afterFields = new Map(headTypes.get(after.ref).fields.map((field) => [field.name, field]));
  const added = [...afterFields.keys()].filter((name) => !beforeType.fields.some((field) => field.name === name));
  for (const field of beforeType.fields) {
    const next = afterFields.get(field.name);
    if (!next) {
      const twin = added.find((name) => describe(afterFields.get(name).schema) === describe(field.schema));
      breaking.push(`${where}.${field.name}: removed${twin ? ` (renamed to ${twin}?)` : ""}`);
      continue;
    }
    if (!field.optional && next.optional) breaking.push(`${where}.${field.name}: may now be absent`);
    compareSchema(`${where}.${field.name}`, field.schema, next.schema, baseTypes, headTypes);
  }
}

const headRoutes = new Map(head.routes.map((route) => [`${route.method} ${route.pattern}`, route]));
for (const route of base.routes) {
  const key = `${route.method} ${route.pattern}`;
  const next = headRoutes.get(key);
  if (!next) { breaking.push(`${key}: route removed`); continue; }
  for (const portal of route.portals) if (!next.portals.includes(portal)) breaking.push(`${key}: portal ${portal} removed`);
  const cases = route.variants ? Object.entries(route.variants.cases) : [["", route.response]];
  for (const [value, schema] of cases) {
    const after = route.variants ? next.variants?.cases[value] : next.response;
    const where = value ? `${key} ?${route.variants.query_param}=${value}` : key;
    if (!after) { breaking.push(`${where}: response removed`); continue; }
    compareSchema(where, schema, after, typesOf(base), typesOf(head));
  }
}
if (breaking.length) {
  console.error(`contract breaks against base (${breaking.length}):\n${breaking.join("\n")}`);
  process.exit(1);
}
console.log("contract is compatible with base");
