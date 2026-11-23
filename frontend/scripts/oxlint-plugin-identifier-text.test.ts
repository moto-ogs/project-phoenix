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
  "query.group_id?.map(Number)",
  "keys.map(Number)",
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
  "Array.from(groupIdsAsNumbers.groupIds, Number)",
  "Number(invoice)",
  "row.id + '-label'",
  "custom.Number(studentId)",
];

describe("bff-boundary/no-numeric-identifier", () => {
  it("reports numeric conversions, using the wire type even after a rename", async () => {
    const source = [
      'import type { StudentResponse, GetStudentsQuery } from "~/lib/contract/students.generated";',
      "declare const row: StudentResponse;",
      'declare const projected: { student: StudentResponse["id"] };',
      'type StudentKey = StudentResponse["id"];',
      "declare const aliased: { student: StudentKey };",
      "declare const selected: StudentKey;",
      "declare const nullable: StudentKey | undefined;",
      "type MaybeKey = (StudentKey | undefined);",
      "declare const parenthesized: MaybeKey;",
      "const pick = { student: row.id };",
      "declare const query: GetStudentsQuery;",
      'declare const keys: StudentResponse["id"][];',
      'declare const readonlyKeys: readonly StudentResponse["id"][];',
      "declare const genericKeys: ReadonlyArray<StudentKey>;",
      'declare const nameIds: StudentResponse["first_name"][];',
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
  });
});
