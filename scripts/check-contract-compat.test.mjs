import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { MODEL_PATH, breakingChanges } from "./check-contract-compat.mjs";

const field = (name, kind, extra = {}) => ({ name, schema: { kind }, ...extra });
const model = (fields, route = {}) => ({
  routes: [{ method: "GET", pattern: "/api/rows/", portals: ["tenant"], response: { kind: "array", elem: { kind: "ref", ref: "Row" } }, ...route }],
  enums: [],
  types: [{ name: "Row", go_type: "rows.Row", fields }],
});
const base = model([field("id", "legacy_id"), field("name", "string"), field("nick", "string", { optional: true }), field("old", "string", { deprecated: true })]);
const withFields = (change) => model(change(structuredClone(base.types[0].fields)));

test("additions, a dropped deprecated field and string identifiers are compatible", () => {
  const head = withFields((fields) => [
    { ...fields[0], schema: { kind: "id" } },
    fields[1],
    { ...fields[2], optional: false },
    field("added", "string"),
  ]);
  head.types[0].name = "Renamed";
  head.routes[0].response.elem.ref = "Renamed";
  head.routes[0].portals.push("parent");
  assert.deepEqual(breakingChanges(base, head), []);
});

test("every change that breaks a reader of the base is named", () => {
  const cases = [
    ["a removed field", withFields((fields) => fields.filter((entry) => entry.name !== "name")), "GET /api/rows/[].name: removed without a release as deprecated"],
    ["a renamed field", withFields((fields) => fields.map((entry) => (entry.name === "nick" ? { ...entry, name: "alias" } : entry))), "GET /api/rows/[].nick: removed without a release as deprecated"],
    ["a changed kind", withFields((fields) => fields.map((entry) => (entry.name === "name" ? field("name", "int") : entry))), "GET /api/rows/[].name: string became int"],
    ["required to optional", withFields((fields) => fields.map((entry) => (entry.name === "name" ? { ...entry, optional: true } : entry))), "GET /api/rows/[].name: may now be absent"],
    ["non-null to nullable", withFields((fields) => fields.map((entry) => (entry.name === "name" ? { ...entry, schema: { kind: "string", nullable: true } } : entry))), "GET /api/rows/[].name: may now be null"],
    ["a removed route", { ...base, routes: [] }, "GET /api/rows/: route removed without a release as deprecated"],
    ["a removed portal", model(base.types[0].fields, { portals: ["parent"] }), "GET /api/rows/: portal tenant removed"],
  ];
  for (const [name, head, message] of cases) {
    assert.ok(breakingChanges(base, head).includes(message), `${name}: ${JSON.stringify(breakingChanges(base, head))}`);
  }
  const stringBase = model([field("id", "id")]);
  assert.deepEqual(breakingChanges(stringBase, model([field("id", "legacy_id")])), ["GET /api/rows/[].id: id became legacy_id"]);
});

test("a deprecated route may leave and a variant may not", () => {
  assert.deepEqual(breakingChanges(model(base.types[0].fields, { deprecated: true }), { ...base, routes: [] }), []);
  const variants = (cases) => model(base.types[0].fields, { response: undefined, variants: { query_param: "view", default: "full", cases } });
  const row = { kind: "array", elem: { kind: "ref", ref: "Row" } };
  assert.deepEqual(breakingChanges(variants({ full: row, slim: row }), variants({ full: row })), ["GET /api/rows/ ?view=slim: response removed"]);
});

test("the committed model is compatible with itself", () => {
  const committed = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", MODEL_PATH), "utf8"));
  assert.deepEqual(breakingChanges(committed, committed), []);
  assert.ok(committed.routes.length > 0);
});
