import { SWRConfig } from "~/lib/swr/testing";
vi.unmock("swr");
import {
  fireEvent,
  render as rtlRender,
  screen,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import type { HolidayPeriod } from "~/lib/traeger-api";

const { mockFetchPeriods, mockPush } = vi.hoisted(() => ({
  mockFetchPeriods: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("~/lib/traeger-api", () => ({
  fetchHolidayPeriods: () => mockFetchPeriods(),
}));
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import TraegerHolidayPeriodsPage from "./page";

const period: HolidayPeriod = {
  id: "5",
  name: "Osterferien 2027",
  registrationOpensOn: "2027-01-11",
  registrationClosesOn: "2027-02-26",
  binding: true,
  holidayWishRule: false,
  notes: "",
  status: "published",
  publishedAt: "2027-01-04T09:00:00Z",
  publicToken: "token",
  registrationCount: 0,
  version: "period-read",
  weeks: [
    {
      id: "7",
      startsOn: "2027-03-22",
      endsOn: "2027-03-26",
      hostSchoolId: "31",
      timeModels: [],
    },
    {
      id: "8",
      startsOn: "2027-03-29",
      endsOn: "2027-04-02",
      hostSchoolId: "32",
      timeModels: [],
    },
  ],
};

describe("TraegerHolidayPeriodsPage", () => {
  beforeEach(() => {
    mockFetchPeriods.mockReset();
    mockPush.mockReset();
  });

  it("lists the periods with registration, weeks and status and opens one", async () => {
    mockFetchPeriods.mockResolvedValue([period]);
    render(<TraegerHolidayPeriodsPage />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Osterferien 2027")).toBeInTheDocument();
    // Anker: die Zahl der Zeiträume steht in der Statuszeile.
    // Statuszeile: Zahl und Wort als Paar, ohne Trennpunkt (#7402).
    expect(
      screen.getByText("veröffentlicht").parentElement?.parentElement,
    ).toHaveTextContent("1 Ferienzeitraum, 1 veröffentlicht");
    expect(screen.queryByText("·")).not.toBeInTheDocument();
    expect(
      within(table).getByText("11.01.2027 bis 26.02.2027"),
    ).toBeInTheDocument();
    expect(
      within(table).getByText("2 Wochen: 22.03.2027 bis 02.04.2027"),
    ).toBeInTheDocument();
    expect(within(table).getByText("Veröffentlicht")).toBeInTheDocument();

    fireEvent.click(within(table).getByText("Osterferien 2027"));
    expect(mockPush).toHaveBeenCalledWith("/ferien/5");
    expect(
      screen.getByRole("link", { name: "Ferienzeitraum anlegen" }),
    ).toHaveAttribute("href", "/ferien/neu");
  });

  it("says what to do when the Träger has no period yet", async () => {
    mockFetchPeriods.mockResolvedValue([]);
    render(<TraegerHolidayPeriodsPage />);

    expect(
      (await screen.findAllByText("Noch kein Ferienzeitraum.")).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: "Ferienzeitraum anlegen" }),
    ).toBeInTheDocument();
  });
});

function render(ui: React.ReactElement) {
  return rtlRender(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map() }}>{ui}</SWRConfig>
    </ToastProvider>,
  );
}

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "A", scope: "org", orgId: 7 } },
    status: "authenticated",
  }),
}));
