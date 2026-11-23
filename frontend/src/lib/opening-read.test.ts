import { describe, expect, it } from "vitest";

import { followOpeningRead, type OpenedRead } from "./opening-read";

const read = (
  data: string | undefined,
  isValidating: boolean,
  error?: unknown,
) => ({
  data,
  isValidating,
  error,
});

/** Runs the reads of one opening through the follower, as renders do. */
function follow(...reads: ReturnType<typeof read>[]) {
  let opened: OpenedRead<string> | undefined;
  for (const state of reads) opened = followOpeningRead(opened, "form", state);
  return opened;
}

describe("followOpeningRead", () => {
  it("holds the opening's read against later background reads", () => {
    const opened = follow(
      read("cached", false),
      read("cached", true),
      read("current", false),
      read("background", true),
      read("background", false),
    );
    expect(opened).toMatchObject({
      data: "current",
      settled: true,
      failed: false,
    });
  });

  it("reports a failed first read over cached data", () => {
    // A cached read starts without isValidating; only the read it saw run
    // settles the opening.
    const opened = follow(
      read("cached", false),
      read("cached", true),
      read("cached", false, new Error("window closed")),
    );
    expect(opened).toMatchObject({
      data: "cached",
      settled: true,
      failed: true,
    });
  });

  it("keeps the opened data when a later background read fails", () => {
    const opened = follow(
      read(undefined, true),
      read("first", false),
      read("first", true),
      read("first", false, new Error("offline")),
    );
    expect(opened).toMatchObject({ data: "first", failed: false });
  });

  it("returns the same state while nothing changes", () => {
    const opened = follow(read(undefined, true), read("first", false));
    expect(followOpeningRead(opened, "form", read("first", false))).toBe(
      opened,
    );
  });
});
