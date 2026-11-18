import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import type { HolidayWeekPlaces } from "~/lib/traeger-holiday-registrations-api";
import { HOLIDAY_PERIOD } from "~/test/fixtures/holiday-registrations";

vi.unmock("swr");
const { fetchPlaces } = vi.hoisted(() => ({ fetchPlaces: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "5" }) }));
vi.mock("~/components/traeger/use-traeger-resources", () => ({
  useTraegerHolidayPeriod: () => ({ data: HOLIDAY_PERIOD }),
}));
vi.mock("~/components/traeger/use-traeger-schools", () => ({
  useTraegerSchools: () => ({ schools: [] }),
}));
vi.mock("~/lib/traeger-holiday-registrations-api", async (original) => ({
  ...(await original<
    typeof import("~/lib/traeger-holiday-registrations-api")
  >()),
  fetchHolidayWeekPlaces: () => fetchPlaces(),
}));
vi.mock("~/components/ui/tenant-page", async (original) => ({
  TenantPageStats: (
    await original<typeof import("~/components/ui/tenant-page")>()
  ).TenantPageStats,
  TenantPage: ({
    stats,
    children,
  }: {
    stats: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      {stats}
      {children}
    </div>
  ),
}));
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));

import HolidayPlacesPage from "./page";

describe("holiday places summary", () => {
  it("counts a child waiting in three weeks only once", async () => {
    const weeks: HolidayWeekPlaces[] = ["51", "52", "53"].map((weekId) => ({
      weekId,
      startsOn: "2027-07-05",
      endsOn: "2027-07-09",
      hostSchoolId: "31",
      capacity: 0,
      placed: 0,
      waitlist: [
        {
          childId: "21",
          childFirstName: "Tom",
          childLastName: "Platz",
          registrationId: "14",
          registrationStatus: "received",
          submittedAt: "2026-11-09T13:12:00Z",
          timeModelName: "bis 13 Uhr",
          deferred: false,
          position: 1,
        },
      ],
    }));
    fetchPlaces.mockResolvedValue(weeks);
    render(
      <TraegerResourceTestProvider>
        <HolidayPlacesPage />
      </TraegerResourceTestProvider>,
    );
    // Zahl und Text sind ein Paar der Statuszeile (#7402).
    expect(
      (await screen.findByText("Kind wartet auf einen Platz")).parentElement,
    ).toHaveTextContent("1 Kind wartet auf einen Platz");
    expect(screen.getAllByRole("link", { name: /Tom Platz/ })).toHaveLength(3);

    // #7304: the week cards sit in one grid, so the last one keeps its height.
    const cards = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.closest("section"));
    expect(cards).toHaveLength(3);
    const grid = cards[0]?.parentElement;
    expect(grid).toHaveClass("grid");
    for (const card of cards) expect(card?.parentElement).toBe(grid);
  });
});
