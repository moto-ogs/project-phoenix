// Storybook-a11y-Ratsche (#7108): global steht a11y.test auf "error", jede
// Story-Ausnahme ("todo") nennt das Issue, das ihre axe-Verstöße behebt.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function storyFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return storyFiles(path);
    return /\.stories\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test("Storybook prüft a11y global als Fehler", () => {
  const preview = readFileSync(join(frontend, ".storybook/preview.tsx"), "utf8");
  assert.match(preview, /a11y:\s*\{\s*test:\s*"error"/);
});

test('jede a11y-Ausnahme "todo" nennt ihr Issue', () => {
  const missing = [];
  for (const file of storyFiles(join(frontend, "src"))) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (!/\btest:\s*["']todo["']/.test(line)) return;
      // Der Kommentar steht direkt über der Ausnahme oder über ihrem
      // parameters-Block.
      const context = lines.slice(Math.max(0, index - 2), index + 1).join("\n");
      if (!/\/\/.*Behebung in #\d+/.test(context)) {
        missing.push(`${relative(frontend, file)}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(missing, [], "Kommentar „Behebung in #<Issue>“ fehlt");
});
