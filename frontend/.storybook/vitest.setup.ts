import { beforeEach, vi } from "vitest";
import { page } from "vitest/browser";

import { TEST_CLOCK_INSTANT } from "../src/test/clock-instant";

// Dieselbe feste Uhr wie in der Unit-Suite (`src/test/setup-common.ts`,
// #7296): `Date` steht auf TEST_CLOCK_INSTANT, Timer laufen weiter. Ohne sie
// hingen Kalender, „heute“-Markierungen und damit die a11y-Prüfung am Tag
// des Laufs. Schon beim Laden, weil Stories ihre Daten auf Modulebene bauen
// (`storyNow()` in `clock.ts`); vor jeder Story erneut, falls eine `play`-
// Funktion die Zeit verstellt hat.
vi.setSystemTime(TEST_CLOCK_INSTANT);
beforeEach(() => {
  vi.setSystemTime(TEST_CLOCK_INSTANT);
});

// Lässt die Prüfung auf überdeckten Text (`text-collisions.ts`) jede Story
// auch bei Telefonbreite ansehen: Nur der Test kann das Fenster der Story
// verkleinern, die Storybook-Oberfläche nicht.
(
  globalThis as { __motoSetViewport?: (w: number, h: number) => Promise<void> }
).__motoSetViewport = (width, height) => page.viewport(width, height);
