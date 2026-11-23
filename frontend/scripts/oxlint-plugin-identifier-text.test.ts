import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  statSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

  it("rechecks unchanged operands after changes to resolution or the wire contract", () => {
    const root = mkdtempSync(join(tmpdir(), "identifier-lint-"));
    try {
      const frontend = join(root, "frontend");
      const write = (path: string, text: string) => {
        const file = join(frontend, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, text);
      };
      const contract = (kind: "id" | "string") => {
        write(
          "../backend/api/contract/contract.json",
          JSON.stringify({
            routes: [],
            types: [
              { name: "Row", fields: [{ name: "id", schema: { kind } }] },
            ],
          }),
        );
      };
      mkdirSync(join(frontend, "scripts"), { recursive: true });
      for (const script of [
        "identifier-provenance.mjs",
        "oxlint-plugin-bff-boundary.mjs",
      ]) {
        copyFileSync(
          resolve("scripts", script),
          join(frontend, "scripts", script),
        );
      }
      mkdirSync(join(frontend, "node_modules"));
      symlinkSync(
        resolve("node_modules/typescript"),
        join(frontend, "node_modules/typescript"),
        "dir",
      );
      write(
        ".oxlintrc.json",
        JSON.stringify({
          jsPlugins: ["./scripts/oxlint-plugin-bff-boundary.mjs"],
          rules: { "bff-boundary/no-numeric-identifier": "error" },
        }),
      );
      write(
        "tsconfig.json",
        JSON.stringify({
          compilerOptions: {
            module: "ESNext",
            moduleResolution: "Bundler",
            noLib: true,
            types: [],
            paths: { "#key": ["./types/preferred", "./types/fallback"] },
          },
          // A new module outside the roots can still change resolution.
          include: ["src/probe.ts"],
        }),
      );
      write(
        "src/probe.ts",
        'import type { Key } from "#key";\ndeclare const key: Key;\nvoid Number(key);',
      );
      write(
        "src/lib/contract/probe.generated.ts",
        "export interface Row { id: string }",
      );
      const key =
        'import type { Row } from "../src/lib/contract/probe.generated";\nexport type Key = Row["id"];';
      write("types/fallback.ts", key);
      contract("id");

      const lint = (expectedStatus: number) => {
        const result = spawnSync(
          resolve("node_modules/.bin/oxlint"),
          ["-f", "json", "src/probe.ts"],
          {
            cwd: frontend,
            encoding: "utf8",
            env: { ...process.env, CI: "" },
          },
        );
        expect(result.status, result.stderr || result.stdout).toBe(
          expectedStatus,
        );
        const { diagnostics } = JSON.parse(result.stdout) as {
          diagnostics: { code: string }[];
        };
        expect(diagnostics.map(({ code }) => code)).toEqual(
          expectedStatus ? [RULE] : [],
        );
      };
      lint(1);
      const cache = join(
        frontend,
        "node_modules/.cache/identifier-provenance.json",
      );
      const inode = statSync(cache).ino;
      lint(1);
      // A miss replaces the cache atomically. Check that the second invocation
      // actually reused it before exercising invalidation.
      expect(statSync(cache).ino).toBe(inode);
      write("types/preferred.ts", "export type Key = string;");
      lint(0);
      write("types/preferred.ts", key);
      lint(1);
      contract("string");
      lint(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
