import { page } from "vitest/browser";

// Lässt die Prüfung auf überdeckten Text (`text-collisions.ts`) jede Story
// auch bei Telefonbreite ansehen: Nur der Test kann das Fenster der Story
// verkleinern, die Storybook-Oberfläche nicht.
(
  globalThis as { __motoSetViewport?: (w: number, h: number) => Promise<void> }
).__motoSetViewport = (width, height) => page.viewport(width, height);
