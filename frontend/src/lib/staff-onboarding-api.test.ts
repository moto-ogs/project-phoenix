import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchStaffOnboarding,
  mapStaffOnboardingState,
  dismissStaffOnboarding,
} from "./staff-onboarding-api";

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

describe("fetchStaffOnboarding", () => {
  it("refuses a state without step lists instead of reopening every step", async () => {
    fetchMock.mockResolvedValue(
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
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));

    await expect(fetchStaffOnboarding()).resolves.toBeNull();
  });
});

describe("dismissStaffOnboarding", () => {
  const hidden = () =>
    new Response(
      JSON.stringify({
        data: { dismissed: true, done_steps: [], skipped_steps: [] },
      }),
      { status: 200 },
    );

  // Nur „Abschließen“ sagt es der Nutzungsanalyse der Schule (#7553).
  it("tells a finished checklist apart from a closed one", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(hidden()));
    fetchMock.mockClear();

    await dismissStaffOnboarding({ completed: true });
    await dismissStaffOnboarding();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/staff-onboarding/dismissal?outcome=completed",
      "/api/staff-onboarding/dismissal",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
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
