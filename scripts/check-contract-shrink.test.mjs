import assert from "node:assert/strict";
import test from "node:test";
import { addedRows, outsideRows, report } from "./check-contract-shrink.mjs";

test("the outside lines are read from the model, typed routes are not among them", () => {
  const model = {
    routes: [{ method: "POST", pattern: "/auth/login", route_file: "installs the session cookie" }],
    outside: [{ method: "GET", pattern: "/health", reason: "probe", why: "liveness probe" }],
  };
  assert.deepEqual(outsideRows(model), ["GET /health"]);
  assert.deepEqual(outsideRows({ routes: [] }), []);
});

test("the outside lines may shrink and a parameter may be renamed", () => {
  assert.deepEqual(report({
    baseRows: ["POST /api/iot/rows/{id}", "GET /health"], headRows: ["POST /api/iot/rows/{rowId}"],
  }), []);
});

test("a new outside line fails", () => {
  const problems = report({
    baseRows: ["GET /health"], headRows: ["GET /health", "GET /api/iot/rows/{id}/report"],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /New catalog lines outside the contract \(1\):\nGET \/api\/iot\/rows\/\{id\}\/report\n/);
});

test("a route on another router is new, though its path reads the same", () => {
  assert.deepEqual(addedRows(["GET /api/iot/*/{id}"], ["GET /api/iot/{deviceId}"]), ["GET /api/iot/{deviceId}"]);
});

test("a new ADR that names the whole catalog line admits an outside line", () => {
  const rows = ["POST /api/iot/new-step"];
  assert.deepEqual(addedRows([], rows, ["The kiosk calls `POST /api/iot/new-step` with its device key."]), []);
  assert.deepEqual(addedRows([], rows, ["POST /api/iot/new-step\nends the line."]), []);
  assert.deepEqual(addedRows([], rows, ["Names `POST /api/iot/new-step/confirm` only."]), rows);
  assert.deepEqual(addedRows([], rows, ["Names POST /api/iot/other only."]), rows);
});
