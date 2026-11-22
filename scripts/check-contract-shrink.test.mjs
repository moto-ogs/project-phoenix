import assert from "node:assert/strict";
import test from "node:test";
import { addedRows, catalogRows, report, unregisteredRows } from "./check-contract-shrink.mjs";

const model = { routes: [{ method: "GET", pattern: "/api/rows/{id}" }, { method: "GET", pattern: "/api/iot/" }] };

test("a catalog row is registered by its exact pattern or without the root mount's /*/", () => {
  const rows = catalogRows(["GET /api/rows/{id}\nPOST /api/rows/{id}\n", "GET /api/iot/*/\n\nGET /auth/login\n"]);
  assert.deepEqual(unregisteredRows(rows, model), ["POST /api/rows/{id}", "GET /auth/login"]);
});

test("the debt may shrink and a parameter may be renamed", () => {
  assert.deepEqual(report({
    baseRows: ["POST /api/rows/{id}", "GET /auth/login"], headRows: ["POST /api/rows/{rowId}"],
  }), []);
});

test("a new unregistered route fails", () => {
  const problems = report({
    baseRows: ["GET /auth/login"], headRows: ["GET /auth/login", "GET /api/rows/{id}/report"],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /New backend routes without a contract \(1\):\nGET \/api\/rows\/\{id\}\/report\n/);
});

test("a route on another router is new, though its path reads the same", () => {
  assert.deepEqual(addedRows(["GET /api/iot/*/{id}"], ["GET /api/iot/{deviceId}"]), ["GET /api/iot/{deviceId}"]);
});

test("a new ADR that names the whole catalog line admits an unregistered route", () => {
  const rows = ["POST /auth/mfa/new-step"];
  assert.deepEqual(addedRows([], rows, ["The step `POST /auth/mfa/new-step` mints a session."]), []);
  assert.deepEqual(addedRows([], rows, ["POST /auth/mfa/new-step\nends the line."]), []);
  assert.deepEqual(addedRows([], rows, ["Names `POST /auth/mfa/new-step/confirm` only."]), rows);
  assert.deepEqual(addedRows([], rows, ["Names POST /auth/mfa/other only."]), rows);
});
