import assert from "node:assert/strict";
import test from "node:test";
import { addedPassThroughs, mergeFragments } from "./check-proxy-routes.mjs";

const base = {
  "api/groups": ["GET tenant /api/groups", "POST tenant /api/groups"],
  "api/rooms/[id]": ["GET tenant /api/rooms/id%2F1"],
};

test("a register that shrinks or moves a backend path adds nothing", () => {
  assert.deepEqual(addedPassThroughs(base, {
    "api/groups": ["GET tenant /api/school-groups query=q"],
  }), []);
});

test("a new route file and a new method on a known one are named", () => {
  assert.deepEqual(addedPassThroughs(base, {
    ...base,
    "api/rooms/[id]": ["GET tenant /api/rooms/id%2F1", "DELETE tenant /api/rooms/id%2F1"],
    "api/school/plans": ["GET school /school/plans"],
  }), [
    "api/rooms/[id]: DELETE tenant /api/rooms/id%2F1",
    "api/school/plans: GET school /school/plans",
  ]);
});

test("the fragments of the capabilities form one register", () => {
  assert.deepEqual(mergeFragments(['{"api/a":["GET tenant /api/a"]}', '{"api/b":["GET tenant /api/b"]}']), {
    "api/a": ["GET tenant /api/a"],
    "api/b": ["GET tenant /api/b"],
  });
});

test("an empty register adds nothing, and any row on it is new", () => {
  assert.deepEqual(addedPassThroughs(base, {}), []);
  assert.deepEqual(addedPassThroughs({}, { "api/new": ["GET tenant /api/new"] }), ["api/new: GET tenant /api/new"]);
});
