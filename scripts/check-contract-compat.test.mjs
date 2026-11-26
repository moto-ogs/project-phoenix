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
const base = model([field("id", "id"), field("name", "string"), field("nick", "string", { optional: true }), field("old", "string", { deprecated: true })]);
const withFields = (change) => model(change(structuredClone(base.types[0].fields)));

test("additions and a dropped deprecated field are compatible", () => {
  const head = withFields((fields) => [
    fields[0],
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
  const named = model([field("id", "id"), field("name", "enum"), field("nick", "clock", { optional: true }), field("old", "string", { deprecated: true })]);
  assert.deepEqual(breakingChanges(base, named), [], "naming the form of a string keeps the wire");
  assert.ok(breakingChanges(named, base).includes("GET /api/rows/[].name: enum became string"));
});

test("the #8085 cutover only retires the old staff navigation fields", () => {
  const route = { pattern: "/api/me/navigation", response: { kind: "ref", ref: "Row" } };
  const fields = [field("current_staff", "json"), field("school_switches", "json")];
  const before = model([...fields, field("educational_groups", "json"), field("incomplete", "bool"), field("supervised_groups", "json"), field("unavailable_sections", "json")], route);
  before.types[0].go_type = "identityaccess.NavigationResponse[github.com/moto-ogs/project-phoenix/modules/peopledirectory.Staff,*github.com/moto-ogs/project-phoenix/roots/owners.CallerGroupRow,*github.com/moto-ogs/project-phoenix/modules/studentpresence/internal/ports.ActiveGroup]";
  assert.deepEqual(breakingChanges(before, model(fields, route)), []);
  assert.deepEqual(breakingChanges(before, model(fields.slice(0, 1), route)), [
    "GET /api/me/navigation.school_switches: removed without a release as deprecated",
  ]);

  before.types[0].go_type = "identityaccess.FutureResponse";
  assert.equal(breakingChanges(before, model(fields, route)).length, 4);
});

test("the supervision cleanup only retires the two former tenant reads", () => {
  for (const [pattern, goType] of [
    ["/api/active/supervisors/all", "presence.ActiveGroupResponse"],
    ["/api/students/ogs-group-navigation", "grouplive.NavigationGroup"],
  ]) {
    const before = model(base.types[0].fields, { pattern });
    before.types[0].go_type = goType;
    const after = { ...before, routes: [] };
    assert.deepEqual(breakingChanges(before, after), []);

    const breaking = [`GET ${pattern}: route removed without a release as deprecated`];
    before.routes[0].portals = ["tenant", "school"];
    assert.deepEqual(breakingChanges(before, after), breaking);
    before.routes[0].portals = ["tenant"];
    before.types[0].go_type = "future.Replacement";
    assert.deepEqual(breakingChanges(before, after), breaking);
  }

  const supervised = model(base.types[0].fields, { pattern: "/api/me/groups/supervised" });
  assert.deepEqual(breakingChanges(supervised, { ...supervised, routes: [] }), [
    "GET /api/me/groups/supervised: route removed without a release as deprecated",
  ]);
});

test("a decimal string identifier may become an id on either side", () => {
  const body = (kind) => {
    const route = model([field("id", kind)], { method: "POST", request: { kind: "ref", ref: "Row" }, response: undefined, no_data: true });
    route.types[0].request = true;
    return route;
  };
  for (const kind of ["string", "legacy_id"]) {
    assert.deepEqual(breakingChanges(body(kind), body("id")), [], `Go reads a ${kind} identifier as an id`);
  }
  assert.deepEqual(breakingChanges(body("lax_id"), body("id")), ["POST /api/rows/ request.id: lax_id became id"]);
  assert.deepEqual(breakingChanges(body("id"), body("string")), ["POST /api/rows/ request.id: id became string"]);
  assert.deepEqual(breakingChanges(model([field("id", "string")]), model([field("id", "id")])), []);
  assert.deepEqual(breakingChanges(model([field("id", "id")]), model([field("id", "string")])), ["GET /api/rows/[].id: id became string"]);
});

test("a released reader accepts string answers for legacy numeric identifiers", () => {
  const old = model([field("student_id", "legacy_id")]);
  const typed = model([field("student_id", "id")]);
  assert.deepEqual(breakingChanges(old, typed), []);
  assert.deepEqual(breakingChanges(typed, old), ["GET /api/rows/[].student_id: id became legacy_id"]);
});

test("an answer's json may gain a type, a request's json may not", () => {
  const attachments = (kind) => kind === "json"
    ? { kind: "json", nullable: true }
    : { kind: "array", elem: { kind: "ref", ref: "Attachment" } };
  const answer = (kind) => ({
    ...model([field("id", "id"), { name: "attachments", schema: attachments(kind), optional: true }]),
    types: [
      { name: "Row", go_type: "rows.Row", fields: [field("id", "id"), { name: "attachments", schema: attachments(kind), optional: true }] },
      { name: "Attachment", go_type: "rows.Attachment", fields: [field("id", "id"), field("filename", "string")] },
    ],
  });
  assert.deepEqual(breakingChanges(answer("json"), answer("typed")), [], "a reader of json reads every shape");
  assert.deepEqual(breakingChanges(answer("typed"), answer("json")), ["GET /api/rows/[].attachments: array<object> became json"]);
  const body = (kind) => {
    const route = model([field("payload", kind)], { method: "POST", request: { kind: "ref", ref: "Row" }, response: undefined, no_data: true });
    route.types[0].request = true;
    return route;
  };
  assert.deepEqual(breakingChanges(body("json"), body("string")), ["POST /api/rows/ request.payload: json became string"]);
});

test("a deprecated route may leave and a variant may not", () => {
  assert.deepEqual(breakingChanges(model(base.types[0].fields, { deprecated: true }), { ...base, routes: [] }), []);
  const variants = (cases) => model(base.types[0].fields, { response: undefined, variants: { query_param: "view", default: "full", cases } });
  const row = { kind: "array", elem: { kind: "ref", ref: "Row" } };
  assert.deepEqual(breakingChanges(variants({ full: row, slim: row }), variants({ full: row })), ["GET /api/rows/ ?view=slim: response removed"]);
});

test("no-data responses stay compatible and cannot change to or from data responses", () => {
  const noData = model(base.types[0].fields, { response: undefined, no_data: true });
  const variants = model(base.types[0].fields, {
    response: undefined,
    variants: { query_param: "view", default: "full", cases: { full: base.routes[0].response, slim: base.routes[0].response } },
  });
  assert.deepEqual(breakingChanges(noData, structuredClone(noData)), []);
  for (const data of [base, variants]) {
    assert.deepEqual(breakingChanges(noData, data), ["GET /api/rows/: no_data became array<object>"]);
    const requests = data.routes[0].variants ? ["", " ?view=full", " ?view=slim"] : [""];
    assert.deepEqual(breakingChanges(data, noData), requests.map((query) => `GET /api/rows/${query}: array<object> became no_data`));
  }
  const wrongPortal = structuredClone(noData);
  wrongPortal.routes[0].portals = ["parent"];
  assert.deepEqual(breakingChanges(noData, wrongPortal), ["GET /api/rows/: portal tenant removed"]);
});

test("a file answer and a multipart request are kinds of their own", () => {
  const file = model(base.types[0].fields, { response: undefined, file: true });
  assert.deepEqual(breakingChanges(file, structuredClone(file)), []);
  assert.deepEqual(breakingChanges(file, base), ["GET /api/rows/: file became array<object>"]);
  assert.deepEqual(breakingChanges(base, file), ["GET /api/rows/: array<object> became file"]);
  const upload = model(base.types[0].fields, { method: "POST", multipart: true });
  const json = model(base.types[0].fields, { method: "POST", request: { kind: "ref", ref: "Row" } });
  assert.deepEqual(breakingChanges(upload, structuredClone(upload)), []);
  assert.deepEqual(breakingChanges(upload, json), ["POST /api/rows/ request: multipart became json"]);
  assert.deepEqual(breakingChanges(json, upload), ["POST /api/rows/ request: json became multipart"]);
});

test("the committed model is compatible with itself", () => {
  const committed = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", MODEL_PATH), "utf8"));
  assert.deepEqual(breakingChanges(committed, committed), []);
  assert.ok(committed.routes.length > 0);
});

test("required pagination may not disappear, but adding it is compatible", () => {
  const paginated = model(base.types[0].fields, { paginated: true });
  for (const head of [base, model(base.types[0].fields, { paginated: false })]) {
    assert.deepEqual(breakingChanges(paginated, head), ["GET /api/rows/.pagination: may now be absent"]);
  }
  assert.deepEqual(breakingChanges(base, paginated), []);
});

const variantModel = () => ({
  routes: [{
    method: "GET", pattern: "/api/rows/", portals: ["tenant"],
    variants: {
      query_param: "view", default: "full",
      cases: { full: { kind: "ref", ref: "Full" }, names: { kind: "ref", ref: "Names" } },
    },
  }],
  enums: [],
  types: [
    { name: "Full", fields: [field("name", "string"), field("sick", "bool")] },
    { name: "Names", fields: [field("name", "string")] },
  ],
});

test("requests without a selector must still receive a compatible response", () => {
  const before = variantModel();
  const head = structuredClone(before);
  head.routes[0].variants.default = "names";
  assert.deepEqual(breakingChanges(before, head), ["GET /api/rows/.sick: removed without a release as deprecated"]);
  assert.deepEqual(breakingChanges(head, before), [], "a richer default still satisfies old readers");

  const plain = structuredClone(before);
  plain.routes[0].response = plain.routes[0].variants.cases.full;
  delete plain.routes[0].variants;
  assert.deepEqual(breakingChanges(plain, head), ["GET /api/rows/.sick: removed without a release as deprecated"]);
  assert.deepEqual(breakingChanges(plain, before), [], "adding selectors can preserve the default shape");
  assert.deepEqual(breakingChanges(before, plain), [], "one richer response can satisfy all old variants");
});

test("old selector requests are checked against the response the new selector chooses", () => {
  const before = variantModel();
  before.routes[0].variants.default = "names";
  const head = structuredClone(before);
  head.routes[0].variants.query_param = "projection";
  assert.deepEqual(breakingChanges(before, head), ["GET /api/rows/ ?view=full.sick: removed without a release as deprecated"]);

  head.routes[0].variants.default = "full";
  assert.deepEqual(breakingChanges(before, head), [], "a renamed selector is safe if its default satisfies all old readers");
});

test("renaming the student selector breaks slim-only fields even with an unchanged default", () => {
  const before = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", MODEL_PATH), "utf8"));
  const head = structuredClone(before);
  head.routes.find((route) => route.pattern === "/api/students/").variants.query_param = "projection";
  assert.ok(breakingChanges(before, head).includes("GET /api/students/ ?view=slim[].departure_modes: removed without a release as deprecated"));
});

test("an open object answer can gain a struct without accepting other answer kinds", () => {
  const before = model([{ name: "snapshot", schema: { kind: "map", elem: { kind: "json" }, nullable: true } }]);
  const typed = model([{ name: "snapshot", schema: { kind: "ref", ref: "Snapshot", nullable: true } }]);
  typed.types.push({ name: "Snapshot", fields: [field("name", "string")] });
  assert.deepEqual(breakingChanges(before, typed), []);
  assert.deepEqual(breakingChanges(before, model([field("snapshot", "string")])), [
    "GET /api/rows/[].snapshot: map<json> became string",
  ]);
});

test("a legacy fallback can refine an open answer but must not widen a closed one", () => {
  const fieldWithFallback = { name: "flag", schema: { kind: "bool", legacy_json: true } };
  const withFallback = model([fieldWithFallback]);
  assert.deepEqual(breakingChanges(model([field("flag", "json")]), withFallback), []);
  assert.deepEqual(breakingChanges(model([field("flag", "bool")]), withFallback), [
    "GET /api/rows/[].flag: may now return other JSON shapes",
  ]);
});

test("a closed request needs evidence that old callers can still send the accepted values", () => {
  const body = (payload) => ({
    ...model([], { method: "POST", request: { kind: "ref", ref: "Body" } }),
    types: [base.types[0], { name: "Body", request: true, fields: [payload] }],
  });
  const before = body(field("note", "json"));
  const after = field("note", "string");
  assert.equal(breakingChanges(before, body(after)).length, 1);
  assert.deepEqual(
    breakingChanges(before, body({ ...after, refines_json: "Previously validated as a string" })),
    [],
  );
  assert.equal(
    breakingChanges(body(field("note", "bool")), body({ ...after, refines_json: "Unrelated marker" })).length,
    1,
  );
});
