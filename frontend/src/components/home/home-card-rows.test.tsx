import { renderHook } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { setTestClock } from "~/test/clock";

vi.mock("~/lib/hooks/use-media-query", () => ({
  BELOW_SM: "not all and (min-width: 40rem)",
  useMediaQuery: () => false,
}));

import {
  upcomingFirst,
  useBerlinClock,
  useHomeCardRows,
} from "./home-card-rows";

describe("useBerlinClock", () => {
  it("has the Berlin time on the first client navigation commit", () => {
    setTestClock("2026-11-25T10:20:00+01:00");
    const commits = vi.fn();
    renderHook(() => {
      const now = useBerlinClock();
      useLayoutEffect(() => {
        commits(now);
      }, [now]);
    });

    expect(commits).toHaveBeenNthCalledWith(1, "10:20");
  });
});

describe("upcomingFirst", () => {
  it("behält vergangene Einträge für den Restzähler und zeigt die neuesten", () => {
    const items = [
      { id: "1", endTime: "08:00" },
      { id: "2", endTime: "09:00" },
      { id: "3", endTime: "10:00" },
      { id: "4", endTime: "11:00" },
      { id: "5", endTime: "12:00" },
      { id: "6", endTime: "13:00" },
    ];

    const { items: past, allPast } = upcomingFirst(
      items,
      (item) => item.endTime,
      "16:00",
    );
    const { result } = renderHook(() =>
      useHomeCardRows(past, 3, { preferLatest: allPast }),
    );

    expect(result.current.shown.map((item) => item.id)).toEqual(["5", "6"]);
    expect(result.current.hidden).toBe(4);
  });
});
