import { describe, it, expect, vi, beforeEach } from "vitest";

const mockBffJson = vi.fn();
vi.mock("./bff-fetch", () => ({
  bffJson: (...args: unknown[]) => mockBffJson(...args),
}));

import { fetchReminders, REMINDERS_SWR_KEY } from "./reminders-api";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reminders-api", () => {
  it("unwraps the proxy envelope and returns the reminders payload", async () => {
    const payload = {
      reminders: [
        {
          type: "pickup_overdue",
          title: "Hannah",
          due_time: "10:00",
          minutes_away: -5,
        },
      ],
      count: 1,
      enabled: true,
    };
    mockBffJson.mockResolvedValue(payload);

    const result = await fetchReminders();

    expect(mockBffJson).toHaveBeenCalledWith("tenant", "GET /api/reminders/");
    expect(result).toEqual(payload);
  });

  it("exposes a stable shared SWR key", () => {
    expect(REMINDERS_SWR_KEY).toBe("reminders");
  });
});
