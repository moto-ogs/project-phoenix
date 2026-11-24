import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { touchTargetExceptions } from "./kit-touch-targets-exceptions.mjs";
import {
  checkStory,
  orphanedEntries,
  TOUCH_WIDTHS,
  validateExceptions,
  validateKnownViolations,
  type KnownViolations,
} from "./kit-touch-targets-lib.mjs";
import { measureTouchTargets } from "./kit-touch-targets-measure";
import {
  kitStories,
  openStory,
  prepareStorybookPage,
  switchStory,
} from "./kit-pixel-storybook";

// Trefferflächen unter `pointer: coarse` (#8060, Regel aus #8059): Jedes
// bedienbare Element der Kit-Stories braucht 44 × 44 px, gemessen mit
// `elementFromPoint`. Läuft im Projekt `phone` (Pixel 7, Touch) in zwei
// Breiten: Telefon und iPad hochkant, weil manche Größe heute nur an
// `max-sm:` hängt. Start: `pnpm run kit-pixel touch`.
//
// Ein Test je Story-Datei: Die Vorschau lädt einmal, die Stories wechseln
// über Storybooks Kanal. Das Laden kostete je Story ein Vielfaches der
// Messung (gemessen 870 ms gegen 30 ms).

const KNOWN_FILE = path.join(
  import.meta.dirname,
  "kit-touch-targets-known.json",
);
const known = JSON.parse(readFileSync(KNOWN_FILE, "utf8")) as KnownViolations;

/** iPad Air hochkant (820 × 1180), breiter als `sm`. */
const TABLET_VIEWPORT = { width: 820, height: 1180 };

/** 44 px Trefferfläche, Messpunkte alle 4 px. */
const MEASURE = { size: 44, step: 4 };

const stories = kitStories();
const findingsDir = path.join(process.env.KIT_PIXEL_WORK_DIR ?? "", "touch");

const storiesByFile = new Map<string, string[]>();
for (const story of stories) {
  const ids = storiesByFile.get(story.importPath) ?? [];
  ids.push(story.id);
  storiesByFile.set(story.importPath, ids);
}

test("Liste und Ausnahmen sind gültig", () => {
  const errors = [
    ...validateKnownViolations(known),
    ...validateExceptions(touchTargetExceptions),
  ];
  // Mit Filter fehlen Stories absichtlich.
  if (!process.env.KIT_PIXEL_FILTER && !process.env.KIT_PIXEL_ALL_STORIES) {
    for (const id of orphanedEntries({
      known,
      exceptions: touchTargetExceptions,
      storyIds: stories.map((story) => story.id),
    })) {
      errors.push(`${id}: Story fehlt im Build (gelöscht oder umbenannt)`);
    }
  }
  expect(errors, "kit-touch-targets-known.json / -exceptions.mjs").toEqual([]);
});

test.describe("Trefferflächen", () => {
  test.beforeEach(prepareStorybookPage);

  for (const [importPath, ids] of storiesByFile) {
    test(importPath.replace("./src/components/", ""), async ({ page }) => {
      const problems: string[] = [];
      const measured: Record<string, Record<string, unknown>> = {};
      for (const width of TOUCH_WIDTHS) {
        if (width === "tablet") await page.setViewportSize(TABLET_VIEWPORT);
        for (const [index, id] of ids.entries()) {
          if (width === "phone" && index === 0) {
            await openStory(page, id);
          } else {
            await switchStory(page, id, { remount: ids.length === 1 });
          }
          const findings = await page.evaluate(measureTouchTargets, MEASURE);
          (measured[id] ??= {})[width] = findings;
          const { unexpected, stale } = checkStory({
            story: id,
            width,
            findings,
            known,
            exceptions: touchTargetExceptions,
          });
          for (const finding of unexpected) {
            problems.push(
              `${id} (${width}) neu: ${finding.key}. ${finding.hint ?? finding.detail}`,
            );
          }
          for (const key of stale) {
            problems.push(
              `${id} (${width}) behoben: ${key}. Aus der Liste streichen, sie wird nur kürzer.`,
            );
          }
        }
      }
      // Messwerte für die Fehlersuche. Neue Verstöße werden behoben, nicht
      // in die Liste eingetragen.
      mkdirSync(findingsDir, { recursive: true });
      for (const [id, byWidth] of Object.entries(measured)) {
        writeFileSync(
          path.join(findingsDir, `${id}.json`),
          `${JSON.stringify(byWidth, null, 2)}\n`,
        );
      }
      expect(problems, `Trefferflächen in ${importPath}`).toEqual([]);
    });
  }
});
