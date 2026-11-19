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
});
