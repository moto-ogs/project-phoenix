import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FIXED_LAYER_SHIFT_VAR,
  useFixedLayersFollowViewport,
} from "./useFixedLayersFollowViewport";

// The installed app: layout viewport 874 px, like an iPhone 17.
const LAYOUT_HEIGHT = 874;

describe("useFixedLayersFollowViewport", () => {
  const originalViewport = window.visualViewport;
  const originalInnerHeight = window.innerHeight;
  const originalMatchMedia = window.matchMedia;

  const setup = ({
    height = LAYOUT_HEIGHT,
    offsetTop = 0,
    scale = 1,
    standalone = true,
  }: {
    height?: number;
    offsetTop?: number;
    scale?: number;
    standalone?: boolean;
  }) => {
    window.innerHeight = LAYOUT_HEIGHT;
    const viewport = Object.assign(new EventTarget(), {
      height,
      offsetTop,
      scale,
    });
    Object.defineProperty(window, "visualViewport", {
      value: viewport,
      configurable: true,
    });
    window.matchMedia = vi.fn((query: string) => ({
      matches: standalone && query === "(display-mode: standalone)",
    })) as unknown as typeof window.matchMedia;
    return viewport;
  };

  const shift = () =>
    document.documentElement.style.getPropertyValue(FIXED_LAYER_SHIFT_VAR);

  afterEach(() => {
    window.innerHeight = originalInnerHeight;
    window.matchMedia = originalMatchMedia;
    Object.defineProperty(window, "visualViewport", {
      value: originalViewport,
      configurable: true,
    });
    document.documentElement.style.removeProperty(FIXED_LAYER_SHIFT_VAR);
  });

  it("moves the fixed layers back to the visible bottom after the keyboard left the viewport shifted", () => {
    // iOS 26: keyboard closed, full height again, but offsetTop stuck.
    setup({ offsetTop: 608 });

    renderHook(() => useFixedLayersFollowViewport());

    expect(shift()).toBe("608px");
  });

  it("follows the shift while the page scrolls on", () => {
    const viewport = setup({ offsetTop: 300 });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    renderHook(() => useFixedLayersFollowViewport());

    viewport.offsetTop = 450;
    viewport.dispatchEvent(new Event("scroll"));

    expect(shift()).toBe("450px");
  });

  it("leaves the layers alone when the viewport is where it belongs", () => {
    setup({});

    renderHook(() => useFixedLayersFollowViewport());

    expect(shift()).toBe("");
  });

  it("leaves the layers alone while the keyboard is open", () => {
    // The installed app pans the visual viewport by the keyboard height.
    setup({ height: 478, offsetTop: 396 });

    renderHook(() => useFixedLayersFollowViewport());

    expect(shift()).toBe("");
  });

  it("leaves a pinch zoom alone", () => {
    setup({ height: 437, offsetTop: 300, scale: 2 });

    renderHook(() => useFixedLayersFollowViewport());

    expect(shift()).toBe("");
  });

  it("does nothing in the browser tab, where Safari moves its own bars", () => {
    setup({ offsetTop: 608, standalone: false });

    renderHook(() => useFixedLayersFollowViewport());

    expect(shift()).toBe("");
  });

  it("removes the shift when the shell unmounts", () => {
    setup({ offsetTop: 608 });
    const { unmount } = renderHook(() => useFixedLayersFollowViewport());

    unmount();

    expect(shift()).toBe("");
  });
});
