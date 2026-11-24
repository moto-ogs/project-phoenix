import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "@testing-library/react";
import type { Window as HappyWindow } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { COARSE_POINTER, FINE_POINTER } from "./use-media-query";

/*
 * Breite entscheidet die Struktur, die Zeigerart die Bedienmaße (ADR 0321).
 * Happy DOM leitet `pointer` aus `navigator.maxTouchPoints` ab: über 0 ist der
 * Hauptzeiger grob (Finger), 0 ist fein (Maus). Das iPad meldet im
 * Simulator 5 Berührungspunkte und `pointer: coarse`.
 */
function setDevice(device: {
  width: number;
  height: number;
  touch: boolean;
}): void {
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    get: () => (device.touch ? 5 : 0),
  });
  const { happyDOM } = window as unknown as HappyWindow;
  act(() => {
    happyDOM.setViewport({ width: device.width, height: device.height });
  });
}

afterEach(() => {
  setDevice({ width: 1920, height: 1080, touch: false });
  // Zurück zum Getter des Prototyps.
  delete (window.navigator as { maxTouchPoints?: number }).maxTouchPoints;
});

/** Die Media Query, aus der Tailwind die Variante `compact:` baut. */
function compactQuery(): string {
  const css = readFileSync(
    join(process.cwd(), "src/styles/globals.css"),
    "utf8",
  );
  const match = /@custom-variant compact \(@media (.+)\);/.exec(css);
  if (!match) throw new Error("@custom-variant compact fehlt in globals.css");
  return match[1]!;
}

/**
 * Wertet eine Abfrage mit genau einer geklammerten `or`-Gruppe aus. Happy DOM
 * (21) verknüpft die Teile von `or` und Komma-Listen mit „und“; deshalb wird
 * `A and ((B) or (C)) and D` hier in `A and (B) and D` oder `A and (C) and D`
 * zerlegt, wie der Browser es liest.
 */
function matchesWithOr(query: string): boolean {
  const group = /\(((?:\([^()]*\)\s*or\s*)+\([^()]*\))\)/.exec(query);
  if (!group) return window.matchMedia(query).matches;
  const rest = query.slice(group.index + group[0].length);
  if (rest.includes(" or ")) {
    throw new Error(`Mehr als eine or-Gruppe: ${query}`);
  }
  return group[1]!
    .split(/\s+or\s+/)
    .some(
      (branch) =>
        window.matchMedia(query.slice(0, group.index) + branch + rest).matches,
    );
}

describe("COARSE_POINTER / FINE_POINTER", () => {
  it("fragen den Hauptzeiger ab, nicht irgendeinen Zeiger", () => {
    expect(COARSE_POINTER).toBe("(pointer: coarse)");
    expect(FINE_POINTER).toBe("(pointer: fine)");
  });

  it.each([
    { touch: true, coarse: true },
    { touch: false, coarse: false },
  ])("Touch-Gerät $touch: grob $coarse", ({ touch, coarse }) => {
    setDevice({ width: 1180, height: 688, touch });

    expect(window.matchMedia(COARSE_POINTER).matches).toBe(coarse);
    expect(window.matchMedia(FINE_POINTER).matches).toBe(!coarse);
  });
});

describe("compact-Variante", () => {
  it("verlangt für beide Engen dieselbe Abfrage wie FINE_POINTER", () => {
    // Am Ende, außerhalb der or-Gruppe: gilt für beide Engen.
    expect(compactQuery().endsWith(`) and ${FINE_POINTER}`)).toBe(true);
  });

  // Maße der iPads: im iOS-Simulator gemessen, Safari-Viewport (ADR 0321).
  it.each([
    { name: "iPad (A16) quer", width: 1180, height: 688, touch: true },
    { name: "iPad (A16) hoch", width: 820, height: 1048, touch: true },
    { name: "iPad Pro 13 Zoll quer", width: 1376, height: 900, touch: true },
    { name: "Tablet mit Touch, schmal", width: 900, height: 600, touch: true },
  ])("greift nicht auf $name (Finger)", (device) => {
    setDevice(device);

    expect(matchesWithOr(compactQuery())).toBe(false);
  });

  it.each([
    { name: "halbes Fenster", width: 900, height: 1000 },
    { name: "13-Zoll-Laptop", width: 1440, height: 900 },
    { name: "Laptop 1366 x 768", width: 1366, height: 768 },
    { name: "schmales Fenster an der md-Grenze", width: 768, height: 1000 },
  ])("bleibt dicht mit Maus: $name", (device) => {
    setDevice({ ...device, touch: false });

    expect(matchesWithOr(compactQuery())).toBe(true);
  });

  it.each([
    { name: "großer Monitor", width: 1920, height: 1080 },
    { name: "Telefonbreite", width: 390, height: 844 },
    { name: "knapp unter md", width: 767, height: 700 },
  ])("greift mit Maus wie bisher nicht: $name", (device) => {
    setDevice({ ...device, touch: false });

    expect(matchesWithOr(compactQuery())).toBe(false);
  });
});
