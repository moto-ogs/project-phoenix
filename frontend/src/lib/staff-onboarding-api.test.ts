import { describe, expect, it, vi } from "vitest";
import * as sessionCache from "./session-cache";
import {
  fetchStaffOnboarding,
  mapStaffOnboardingState,
  setStaffOnboardingDismissed,
} from "./staff-onboarding-api";

describe("fetchStaffOnboarding", () => {
  it("refuses a state without step lists instead of reopening every step", async () => {
    vi.spyOn(sessionCache, "sessionFetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { dismissed: false } }), {
        status: 200,
      }),
    );

    await expect(fetchStaffOnboarding()).rejects.toMatchObject({
      status: 500,
      code: "general.server",
    });
  });

  it("has no checklist without a school account", async () => {
    vi.spyOn(sessionCache, "sessionFetch").mockResolvedValue(
      new Response(null, { status: 403 }),
    );

    await expect(fetchStaffOnboarding()).resolves.toBeNull();
  });
});

describe("setStaffOnboardingDismissed", () => {
  const hidden = () =>
    new Response(
      JSON.stringify({
        data: { dismissed: true, done_steps: [], skipped_steps: [] },
      }),
      { status: 200 },
    );

  // Nur „Abschließen“ sagt es der Nutzungsanalyse der Schule (#7553).
  it("tells a finished checklist apart from a closed one", async () => {
    const fetch = vi
      .spyOn(sessionCache, "sessionFetch")
      .mockImplementation(() => Promise.resolve(hidden()));
    fetch.mockClear();

    await setStaffOnboardingDismissed(true, { completed: true });
    await setStaffOnboardingDismissed(true);

    expect(fetch.mock.calls.map(([path]) => path)).toEqual([
      "/api/staff-onboarding/dismissal?outcome=completed",
      "/api/staff-onboarding/dismissal",
    ]);
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ dismissed: true }),
    );
  });
});

describe("mapStaffOnboardingState", () => {
  it("maps the backend status and drops unknown steps", () => {
    expect(
      mapStaffOnboardingState({
        dismissed: false,
        school_ready: true,
        done_steps: ["students", "retired"],
        skipped_steps: ["work_time"],
      }),
    ).toEqual({
      dismissed: false,
      schoolReady: true,
      doneSteps: ["students"],
      skippedSteps: ["work_time"],
    });
  });
});
