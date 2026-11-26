import { render, renderHook, screen, waitFor } from "@testing-library/react";
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

  it.each([
    [400, 800],
    [800, 400],
  ])(
    "keeps a region with scroll dimensions %i × %i keyboard reachable",
    (scrollWidth, scrollHeight) => {
      const ref = { current: document.createElement("div") };
      Object.defineProperties(ref.current, {
        scrollWidth: { value: scrollWidth },
        scrollHeight: { value: scrollHeight },
        clientWidth: { value: 400 },
        clientHeight: { value: 400 },
      });

      const { result } = renderHook(() => useScrollRegion(ref));

      expect(result.current).toBe(true);
    },
  );

  it.each(["disabled", "hidden"])(
    "keeps the same-sized scroll area reachable when its only control becomes %s",
    async (attribute) => {
      render(
        <div>
          <button type="button">Edit</button>
        </div>,
      );
      const control = screen.getByRole("button", { name: "Edit" });
      const ref = { current: control.parentElement! };
      Object.defineProperties(ref.current, {
        scrollHeight: { value: 800 },
        clientHeight: { value: 400 },
      });
      const { result } = renderHook(() => useScrollRegion(ref));
      expect(result.current).toBe(false);

      control.setAttribute(attribute, "");
      await waitFor(() => expect(result.current).toBe(true));

      control.removeAttribute(attribute);
      await waitFor(() => expect(result.current).toBe(false));
    },
  );
});
