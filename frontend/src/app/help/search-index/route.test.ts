import { describe, expect, it } from "vitest";

import { HELP_TOPICS } from "~/lib/help-topics";

import { GET } from "./route";

describe("GET /help/search-index", () => {
  it("lists every article with title, question and summary, without its steps", async () => {
    const entries = (await GET().json()) as Record<string, unknown>[];
    const vacation = entries.find((entry) => entry.id === HELP_TOPICS.vacation);
    expect(vacation).toEqual({
      id: HELP_TOPICS.vacation,
      title: expect.any(String),
      question: expect.any(String),
      summary: expect.any(String),
    });
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    expect(entries.length).toBe(Object.keys(HELP_TOPICS).length);
  });
});
