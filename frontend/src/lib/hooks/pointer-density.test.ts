import { act } from "@testing-library/react";
import type { Window as HappyWindow } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { COARSE_POINTER, FINE_POINTER } from "./use-media-query";

/*
 * Zeigerart entscheidet Bedienmaße und Trefferflächen (ADR 0321).
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

describe("COARSE_POINTER / FINE_POINTER", () => {
  it("fragen den Hauptzeiger ab, nicht irgendeinen Zeiger", () => {
    expect(COARSE_POINTER).toBe("(pointer: coarse)");
    expect(FINE_POINTER).toBe("(pointer: fine)");
  });

  // Viewports im iOS-Simulator gemessen (ADR 0321); die Breite ändert die
  // Zeigerart nicht.
  it.each([
    { name: "iPad (A16) quer", width: 1180, height: 688, touch: true },
    { name: "iPad mini hoch", width: 756, height: 1072, touch: true },
    { name: "Telefon", width: 390, height: 844, touch: true },
    { name: "13-Zoll-Laptop", width: 1440, height: 900, touch: false },
    {
      name: "schmales Fenster mit Maus",
      width: 700,
      height: 900,
      touch: false,
    },
  ])("$name: grob $touch", ({ touch, ...device }) => {
    setDevice({ ...device, touch });

    expect(window.matchMedia(COARSE_POINTER).matches).toBe(touch);
    expect(window.matchMedia(FINE_POINTER).matches).toBe(!touch);
  });
});
