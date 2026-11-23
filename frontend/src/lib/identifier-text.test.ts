// Identifiers travel as text (ADR 0300, #7808): the generated types read
// them as strings, and a conversion to a number loses digits above 2^53 and
// sends the wrong type back. Browser code converts no identifier to a number.
// A bffJson parameter typed as a number already fails tsc; this guard covers
// the conversion itself (`Number(room.id)`, `parseInt(studentId, 10)`).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");

function isBrowserFile(path: string): boolean {
  return (
    !path.startsWith("app/api/") &&
    !path.startsWith("server/") &&
    !path.startsWith("test/") &&
    !path.startsWith("lib/contract/") &&
    !/\.server\.tsx?$/.test(path) &&
    !/\.(test|stories)\.tsx?$/.test(path)
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** `Number(x.id)`, `parseInt(studentId, 10)`, `Number.parseInt(ids)` … */
const ID_TO_NUMBER =
  /(?<![\w$.])(?:Number|parseInt|parseFloat|Number\.parseInt|Number\.parseFloat)\(\s*(?:[A-Za-z_$][\w$.?!]*)?(?:[a-z]Id|[a-z]Ids|\.id|\bid|ID|IDs)\s*[,)]/;

describe("identifiers stay text in browser code", () => {
  it("converts no identifier to a number", () => {
    const found = sourceFiles(SRC)
      .map((file) => ({ path: relative(SRC, file), text: readFileSync(file, "utf8") }))
      .filter(({ path }) => isBrowserFile(path))
      .flatMap(({ path, text }) =>
        text
          .split("\n")
          .map((line, index) => ({ line, at: `${path}:${index + 1}` }))
          .filter(({ line }) => ID_TO_NUMBER.test(line))
          .map(({ at, line }) => `${at} ${line.trim()}`),
      );

    expect(found).toEqual([]);
  });

  it("recognizes the forms it forbids", () => {
    for (const line of [
      "const n = Number(room.id);",
      "parseInt(studentId, 10)",
      "Number.parseInt(groupIds)",
      "Number(params.id)",
      "Number(id)",
    ]) {
      expect(ID_TO_NUMBER.test(line), line).toBe(true);
    }
    for (const line of ["Number(isValid)", "Number(count)", "Number(width)", "Number(paid)"]) {
      expect(ID_TO_NUMBER.test(line), line).toBe(false);
    }
  });
});
