import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useScrollRegion } from "./useScrollRegion";

describe("useScrollRegion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps an unmeasured active region keyboard reachable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const ref = { current: document.createElement("div") };

    const { result } = renderHook(() => useScrollRegion(ref));

    expect(result.current).toBe(true);
  });

  it("keeps an activated unmeasured region keyboard reachable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const ref = { current: document.createElement("div") };

    const { result, rerender } = renderHook(
      ({ active }) => useScrollRegion(ref, active),
      { initialProps: { active: false } },
    );

    expect(result.current).toBe(false);

    rerender({ active: true });

    expect(result.current).toBe(true);
  });
});
