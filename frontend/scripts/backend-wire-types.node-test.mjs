import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import {
  findBackendWireTypes,
  scanBackendWireTypes,
  wireTypeKey,
} from "./backend-wire-types.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SRC = join(HERE, "..", "src");
const BASELINE = JSON.parse(
  readFileSync(join(HERE, "backend-wire-types-baseline.json"), "utf8"),
);

const summary = (findings) =>
  findings.map((finding) => [finding.kind, finding.name, finding.fields]);

test("finds a hand-written wire type by its shape, whatever its name", () => {
  const findings = findBackendWireTypes(
    "x.ts",
    `
    export interface GroupRow { id: string; room_id: string; created_at: string }
    type Page = { next_cursor: string | null; unread_count: number };
    interface BackendRoom { room_name: string }
    `,
  );
  assert.deepEqual(summary(findings), [
    ["shape", "GroupRow", ["room_id", "created_at"]],
    ["shape", "Page", ["next_cursor", "unread_count"]],
    ["shape", "BackendRoom", ["room_name"]],
  ]);
});

test("finds renamed and merely aliased generated types", () => {
  const findings = findBackendWireTypes(
    "x.ts",
    `
    import type { GroupResponse as GroupWire } from "./contract/groups.generated";
    import type * as roomsContract from "~/lib/contract/rooms.generated";
    export type RoomWire = roomsContract.RoomResponse;
    `,
  );
  assert.deepEqual(summary(findings), [
    ["rename", "GroupWire", ["GroupResponse"]],
    ["alias", "RoomWire", ["roomsContract.RoomResponse"]],
  ]);
});

test("passes domain types, single snake fields and derived contract types", () => {
  const findings = findBackendWireTypes(
    "x.ts",
    `
    import type * as roomsContract from "~/lib/contract/rooms.generated";
    interface Room { id: string; roomName: string }
    interface Filter { group_id?: string; search: string }
    type Rooms = Omit<roomsContract.RoomResponse, "floor"> & { floor: number };
    type BackendMethod = "GET" | "POST";
    `,
  );
  assert.deepEqual(findings, []);
});

// Response and request types come from src/lib/contract/*.generated.ts
// (#2353, #7806): import the generated type, or derive from it. The
// baseline lists the findings that stood when the guard came in; it only
// shrinks. A new finding fails, and so does an entry without a finding, so
// a fixed type leaves the baseline in the same change.
test("frontend/src adds no hand-written wire type beyond the baseline", () => {
  const found = new Set(scanBackendWireTypes(SRC).map(wireTypeKey));
  const listed = new Set(BASELINE);
  assert.deepEqual(
    [...found].filter((key) => !listed.has(key)).sort(),
    [],
    "new hand-written wire types: import or derive the generated type",
  );
  assert.deepEqual(
    [...listed].filter((key) => !found.has(key)).sort(),
    [],
    "fixed wire types: remove them from backend-wire-types-baseline.json",
  );
});
