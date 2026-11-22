import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import {
  findBackendWireTypes,
  scanBackendWireTypes,
} from "./backend-wire-types.mjs";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");

test("finds a hand-written wire interface and a wire type literal", () => {
  const findings = findBackendWireTypes(
    "x.ts",
    `
    export interface BackendGroup { id: number; room_id?: number }
    type BackendRow = { nested: { created_at: string } };
    `,
  );
  assert.deepEqual(
    findings.map((finding) => [finding.name, finding.fields]),
    [
      ["BackendGroup", ["room_id"]],
      ["BackendRow", ["created_at"]],
    ],
  );
});

test("passes infrastructure types and wire types with other names", () => {
  const findings = findBackendWireTypes(
    "x.ts",
    `
    type BackendMethod = "GET" | "POST";
    interface BackendCall { endpoint: string; timeoutMs: number }
    export type BackendInput = Partial<Record<"id", string>>;
    interface GroupWire { room_id: string }
    `,
  );
  assert.deepEqual(findings, []);
});

// Response and request types come from src/lib/contract/*.generated.ts
// (#2353). A Backend* type with snake_case fields copies a wire shape the
// generator owns: import the generated type instead, or name a shape that
// is no wire type (an error body, a route outside the contract) after
// what it is.
test("frontend/src declares no hand-written Backend* wire type", () => {
  const findings = scanBackendWireTypes(SRC);
  assert.deepEqual(
    findings.map(
      (finding) =>
        `${finding.file}:${finding.line} ${finding.name} (${finding.fields.slice(0, 3).join(", ")})`,
    ),
    [],
  );
});
