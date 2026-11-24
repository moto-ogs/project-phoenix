import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { lintSource, removeProbeDirectories } from "./oxlint-probe";

afterAll(removeProbeDirectories);

const RULE = "bff-boundary(no-numeric-identifier)";
const regressions = [
  "Number(room.id)",
  "parseInt(studentId, 10)",
  "Number.parseFloat(groupIds)",
  "+room.id",
  "room.id * 1",
  "BigInt(id)",
  "Number(row.photo_consent_given_by)",
  "Number(row.photo_consent_given_by as string)",
  "Number(projected.student)",
  "Number(aliased.student)",
  "Number(selected)",
  "Number(nullable)",
  "Number(parenthesized)",
  "Number(pick.student)",
  "Number(shorthand.copied)",
  "Number(query.group_id?.[0])",
  "Number(keyDateQuery.template)",
  "Number(iotQuery.registered_by_id)",
  "query.group_id?.map(Number)",
  "keys.map(Number)",
  "keys.map((key) => Number(key))",
  "keys.map((key: string) => Number(key))",
  'keys["map"]((key) => Number(key))',
  "keys.sort((_left, right) => Number(right))",
  "keys.reduce((sum, key) => sum + Number(key), 0)",
  "Array.from(keys, (key) => Number(key))",
  "Number(keys.at(0))",
  "Number(filtered[0])",
  "Number(keys[brandedIndex])",
  "function <I extends number>(index: I) { return Number(keys[index]); }",
  "(() => { for (const index in keys) Number(keys[index]); })()",
  "(() => { for (const index in keysOrTuple) Number(keysOrTuple[index]); })()",
  "(() => { for (const index in keys) Number(keys[(index)]); })()",
  "(() => { let index: string; for (index in keys) Number(keys[index]); })()",
  "(() => { for (const key of keys) Number(key); })()",
  "Number(firstKey)",
  "(() => { const coerce = Number; return coerce(row.id); })()",
  "(() => { const { BigInt: coerce } = globalThis; return coerce(row.id); })()",
  "(() => { function read(value: string) { return Number(value); } return read(row.id); })()",
  "(() => { function read(value: string) { return Number(value); } return [row.id].map(read); })()",
  "(() => { const read = (value: string) => BigInt(value); const alias = read; return alias(row.id); })()",
  "(() => { function read(value: string) { return +value; } return read(row.id); })()",
  "Array.from(readonlyKeys, BigInt)",
  "genericKeys.map(Number)",
  "Array.from(query.group_id ?? [], BigInt)",
  'Number(row.photo_consent_given_by ?? "0")',
  "Number(actor)",
  "Number(copied)",
  "Number(window.globalThis ? row.photo_consent_given_by : undefined)",
];
const permitted = [
  "Number(width)",
  "Number(isValid)",
  "Number(numeric.id)",
  "Number(optionalNumeric.id)",
  "numbered.groupIds.map(Number)",
  "nameIds.map(Number)",
  "nameIds.map((key) => Number(key))",
  "nameIds.map((id: string) => Number(id))",
  "Number(nameIds.at(0))",
  'Number(keys.filter(Boolean)["length"])',
  '(() => { for (const key in dictionary) if (key === "length") Number(keys[key]); })()',
  '(() => { for (const key in keys) if (key === "length") Number(keys[key]); })()',
  "Number(keys[JSON.parse('\"length\"')])",
  "keys.reduce((id: number, _key) => Number(id), 0)",
  "Number(firstName)",
  "Array.from(groupIdsAsNumbers.groupIds, Number)",
  "Number(invoice)",
  'parseInt(yearId ?? "", 10)',
  "row.id + '-label'",
  "custom.Number(studentId)",
];

describe("bff-boundary/no-numeric-identifier", () => {
  it("reports numeric conversions, using the wire type even after a rename", async () => {
    const source = [
      'import type { StudentResponse, routes as studentRoutes } from "~/lib/contract/students.generated";',
      'import type { routes as reportRoutes } from "~/lib/contract/traeger-reports.generated";',
      'import type { routes as iotRoutes } from "~/lib/contract/iot.generated";',
      'import type { BffQuery } from "~/lib/bff-fetch";',
      "declare const row: StudentResponse;",
      'declare const projected: { student: StudentResponse["id"] };',
      'type StudentKey = StudentResponse["id"];',
      "declare const aliased: { student: StudentKey };",
      "declare const selected: StudentKey;",
      "declare const nullable: StudentKey | undefined;",
      "type MaybeKey = (StudentKey | undefined);",
      "declare const parenthesized: MaybeKey;",
      "const pick = { student: row.id };",
      'declare const query: BffQuery<typeof studentRoutes["GET /api/students/"]>;',
      'declare const keyDateQuery: BffQuery<typeof reportRoutes["GET /traeger/reports/key-date"]>;',
      "const yearId = keyDateQuery.key_date;",
      'declare const iotQuery: BffQuery<typeof iotRoutes["GET /api/iot/"]>;',
      'declare const keys: StudentResponse["id"][];',
      "declare const keysOrTuple: StudentKey[] | readonly [StudentKey];",
      "declare const brandedIndex: number & { readonly brand: unique symbol };",
      "const dictionary: { [index: number]: string; length: number } = { length: 1 };",
      "const [firstKey] = keys;",
      "const filtered = keys.filter(Boolean);",
      'declare const readonlyKeys: readonly StudentResponse["id"][];',
      "declare const genericKeys: ReadonlyArray<StudentKey>;",
      'declare const nameIds: StudentResponse["first_name"][];',
      "const [firstName] = nameIds;",
      "declare const optionalNumeric: { id?: number };",
      "const { id: invoice } = optionalNumeric;",
      "declare const room: { id: string };",
      "declare const id: string, studentId: string, groupIds: string[], width: string, isValid: boolean;",
      "declare const numeric: { id: number };",
      "declare const custom: { Number: (input: string) => void };",
      "const { photo_consent_given_by: actor } = row;",
      "declare const numbered: { groupIds: number[] };",
      "declare const groupIdsAsNumbers: { groupIds: readonly number[] };",
      "const copied = row.photo_consent_given_by;",
      "const shorthand = { copied };",
      ...regressions.map((line) => `void (${line});`),
      ...permitted.map((line) => `void (${line});`),
    ].join("\n");
    const result = await lintSource(source, undefined, undefined, resolve("."));
    const reported = result.output
      .split(RULE)
      .slice(1)
      .map((diagnostic) => diagnostic.split("\n")[2]);
    expect(reported, result.output).toEqual(
      regressions.map((line) => `void (${line});`),
    );
    // Ein einziger oxlint-Lauf mit Typinformation: lokal etwa 2,5 s, auf
    // dem ausgelasteten CI-Shard über den 5-s-Standard von Vitest.
  }, 30_000);
});
