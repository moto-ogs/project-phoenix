import { act } from "@testing-library/react";
import type { Window as HappyWindow } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { COARSE_POINTER, FINE_POINTER } from "./use-media-query";

/*
 * Zeigerart entscheidet Bedienmaße und Trefferflächen (ADR 0323).
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

  // iPad-Viewports im iOS-Simulator gemessen (ADR 0323): Ein iPad quer ist
  // breit wie ein Laptop und bleibt trotzdem Finger.
  it.each([
    { name: "iPad (A16) quer", width: 1180, height: 688, touch: true },
    { name: "iPad mini hoch", width: 756, height: 1072, touch: true },
    { name: "Laptop mit Maus", width: 1180, height: 688, touch: false },
  ])("$name: Finger = $touch", ({ touch, ...device }) => {
    setDevice({ ...device, touch });

    expect(window.matchMedia(COARSE_POINTER).matches).toBe(touch);
    expect(window.matchMedia(FINE_POINTER).matches).toBe(!touch);
  });
});
