import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setTestClock, TEST_CLOCK_INSTANT } from "~/test/clock";
import {
  isChunkLoadError,
  reloadAfterChunkLoadError,
} from "./chunk-load-recovery";

function chunkLoadError(): Error {
  const error = new Error(
    "Failed to load chunk /_next/static/chunks/0ub6smytks-74.js from module 621186",
  );
  error.name = "ChunkLoadError";
  return error;
}

describe("isChunkLoadError", () => {
  it("recognises the Turbopack and webpack chunk failures", () => {
    expect(isChunkLoadError(chunkLoadError())).toBe(true);
    expect(
      isChunkLoadError(new Error("Loading chunk 4711 failed.\n(error: x)")),
    ).toBe(true);
    expect(isChunkLoadError(new Error("Loading CSS chunk app failed"))).toBe(
      true,
    );
  });

  it("leaves every other error alone", () => {
    expect(isChunkLoadError(new Error("x is undefined"))).toBe(false);
    expect(isChunkLoadError("Failed to load chunk")).toBe(false);
  });
});

describe("reloadAfterChunkLoadError", () => {
  let reload: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sessionStorage.clear();
    reload = vi
      .spyOn(globalThis.location, "reload")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    reload.mockRestore();
    sessionStorage.clear();
  });

  it("reloads once and then lets a repeat failure through", () => {
    expect(reloadAfterChunkLoadError(chunkLoadError())).toBe(true);
    expect(reloadAfterChunkLoadError(chunkLoadError())).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads again for a failure a minute after the last reload", () => {
    expect(reloadAfterChunkLoadError(chunkLoadError())).toBe(true);
    setTestClock(new Date(new Date(TEST_CLOCK_INSTANT).getTime() + 61_000));

    expect(reloadAfterChunkLoadError(chunkLoadError())).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does not reload for another error", () => {
    expect(reloadAfterChunkLoadError(new Error("x is undefined"))).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload without sessionStorage, which guards the loop", () => {
    const getItem = vi
      .spyOn(globalThis.sessionStorage, "getItem")
      .mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });

    expect(reloadAfterChunkLoadError(chunkLoadError())).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    getItem.mockRestore();
  });
});
