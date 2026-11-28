import { afterEach, describe, expect, it, vi } from "vitest";

import type { FeedbackEntry } from "~/lib/feedback-api";
import {
  feedbackChartData,
  feedbackClock,
  feedbackSince,
  groupFeedbackByDay,
} from "./feedback-history-view";

// Runs in `school-date-dom`: only forked processes apply a runtime TZ change.
afterEach(() => vi.unstubAllEnvs());

function entry(
  id: string,
  day: string,
  time: string,
  feedbackType: FeedbackEntry["feedbackType"] = "positive",
): FeedbackEntry {
  return { id, day, time, feedbackType, isMensaFeedback: false };
}

// Unordered on purpose: the view must not rely on the API's order.
const entries = [
  entry("1", "2026-11-25", "08:05:00", "neutral"),
  entry("2", "2026-11-26", "15:30:23", "negative"),
  entry("3", "2026-11-26", "23:30:23"),
  entry("4", "2026-10-25", "02:30:00"),
];

describe.each(["Europe/Berlin", "UTC", "America/New_York", "Asia/Tokyo"])(
  "feedback history view in a browser in %s (#8270)",
  (zone) => {
    it("keeps school day and wall clock as they are", () => {
      vi.stubEnv("TZ", zone);
      // The zone change took effect, or the cases below prove nothing.
      expect(new Date("2026-11-26T22:30:23Z").getHours()).toBe(
        {
          "Europe/Berlin": 23,
          UTC: 22,
          "America/New_York": 17,
          "Asia/Tokyo": 7,
        }[zone],
      );

      expect(
        groupFeedbackByDay(entries).map((group) => ({
          day: group.day,
          label: group.label,
          times: group.entries.map((e) => feedbackClock(e.time)),
        })),
      ).toEqual([
        {
          day: "2026-11-26",
          label: "Donnerstag, 26. November 2026",
          times: ["23:30", "15:30"],
        },
        {
          day: "2026-11-25",
          label: "Mittwoch, 25. November 2026",
          times: ["08:05"],
        },
        {
          day: "2026-10-25",
          label: "Sonntag, 25. Oktober 2026",
          times: ["02:30"],
        },
      ]);

      expect(feedbackChartData(entries)).toEqual([
        { day: "So", label: "So 25.10.", positive: 1, neutral: 0, negative: 0 },
        { day: "Mi", label: "Mi 25.11.", positive: 0, neutral: 1, negative: 0 },
        { day: "Do", label: "Do 26.11.", positive: 1, neutral: 0, negative: 1 },
      ]);

      expect(feedbackSince(entries, "2026-11-26").map((e) => e.id)).toEqual([
        "2",
        "3",
      ]);
    });
  },
);
