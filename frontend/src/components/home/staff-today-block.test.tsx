import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "~/lib/api-error";
import type { DashboardAnalytics } from "~/lib/dashboard-helpers";
import type { DashboardSummary } from "~/lib/staff-overview-api";
import { catalogText } from "~/test/error-catalog-text";

const swr = vi.hoisted(() => ({
  data: undefined as DashboardSummary | undefined,
  error: undefined as Error | undefined,
  isLoading: false,
  mutate: vi.fn(),
}));

vi.mock("~/lib/swr", () => ({
  useSWRAuth: () => swr,
}));
vi.mock("~/lib/tenant-path", () => ({
  useTenantAwarePath: () => (path: string) => `/test-tenant${path}`,
}));
vi.mock("~/lib/staff-overview-api", () => ({
  staffOverviewService: { getDashboardSummary: vi.fn() },
}));

import { StaffTodayBlock, staffTiles } from "./staff-today-block";

function summary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    activeStaffCount: 12,
    sickToday: 1,
    vacationToday: 2,
    currentlyClockedIn: 6,
    expectedClockedIn: 8,
    sollMinutes: 0,
    istMinutes: 0,
    deltaMinutes: 0,
    saldoSchoolTotalMinutes: 0,
    pendingRequestsCount: 3,
    ...overrides,
  };
}

const analytics = { supervisorsToday: 7 } as DashboardAnalytics;

describe("StaffTodayBlock (#2180)", () => {
  beforeEach(() => {
    swr.data = summary();
    swr.error = undefined;
    swr.isLoading = false;
  });

  // Krank und Urlaub stehen mit Namen in „Heute anders“, nicht noch einmal
  // als Zahl hier (#7668).
  it("zeigt Aufsicht, Stempeluhr und Team, aber nicht Krank und Urlaub", () => {
    render(<StaffTodayBlock analytics={analytics} />);

    expect(screen.getByText("In Aufsicht")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("6 von 8")).toBeInTheDocument();
    expect(screen.getByText("Team gesamt")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.queryByText("Krank")).not.toBeInTheDocument();
    expect(screen.queryByText("Im Urlaub")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Personal heute: zum Team" }),
    ).toHaveAttribute("href", "/test-tenant/staff");
  });

  // Die Stempeluhr steht nur da, wo sie benutzt wird; ohne Betriebszahlen
  // fehlt die Aufsicht, und das Team gesamt bleibt.
  it("lässt weg, was die Schule nicht nutzt", () => {
    const tiles = staffTiles(
      summary({ currentlyClockedIn: 0, expectedClockedIn: 0 }),
      undefined,
    );

    expect(tiles.map((tile) => tile.label)).toEqual(["Team gesamt"]);
  });

  it("zeigt mit allem genau Aufsicht, Stempeluhr und Team", () => {
    expect(staffTiles(summary(), analytics).map((tile) => tile.label)).toEqual([
      "In Aufsicht",
      "Eingestempelt",
      "Team gesamt",
    ]);
  });

  it("unterscheidet einen Ladefehler von Nullen", async () => {
    swr.data = undefined;
    swr.error = new ApiError("boom", 503, { code: "general.unavailable" });

    render(<StaffTodayBlock analytics={analytics} />);

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Karte „Personal heute“"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Team gesamt")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(swr.mutate).toHaveBeenCalled();
  });
});
