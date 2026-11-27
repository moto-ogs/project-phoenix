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
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "A", scope: "org", orgId: "7" } },
    status: "authenticated",
  }),
}));

import TraegerHolidayPeriodsPage from "../page-content";
import TraegerExtraDaysPage from "./page-content";

function day(overrides: Partial<HolidayPeriod>): HolidayPeriod {
  return {
    id: "7",
    kind: "extra_day",
    includedInFee: true,
    name: "Brückentag nach Himmelfahrt",
    registrationOpensOn: "2099-04-01",
    registrationClosesOn: "2099-05-08",
    binding: true,
    holidayWishRule: false,
    notes: "",
    status: "published",
    publishedAt: null,
    publicToken: "token",
    registrationCount: 3,
    version: "day-read",
    weeks: ["31", "32"].map((hostSchoolId, index) => ({
      id: `7${index}`,
      startsOn: "2099-05-22",
      endsOn: "2099-05-22",
      hostSchoolId,
      placed: index === 0 ? 2 : 1,
      timeModels: [
        {
          id: `70${index}`,
          name: "Betreuung",
          startsAt: "07:30",
          endsAt: "16:00",
          priceCents: 0,
        },
      ],
    })),
    ...overrides,
  };
}

const holidays = day({
  id: "5",
  kind: "holiday",
  includedInFee: false,
  name: "Osterferien 2099",
});

function render(ui: React.ReactElement) {
  return rtlRender(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map() }}>{ui}</SWRConfig>
    </ToastProvider>,
  );
}

describe("TraegerExtraDaysPage", () => {
  beforeEach(() => {
    mockFetchPeriods.mockReset();
    mockPush.mockReset();
  });

  it("lists only the extra days with day, schools, fee and children", async () => {
    mockFetchPeriods.mockResolvedValue([
      holidays,
      day({}),
      day({
        id: "8",
        name: "Beweglicher Ferientag",
        includedInFee: false,
        status: "draft",
        weeks: [
          {
            id: "80",
            startsOn: "2099-02-16",
            endsOn: "2099-02-16",
            hostSchoolId: "31",
            placed: 0,
            timeModels: [
              {
                id: "800",
                name: "Betreuung",
                startsAt: "08:00",
                endsAt: "15:00",
                priceCents: 1800,
              },
            ],
          },
        ],
      }),
    ]);
    render(<TraegerExtraDaysPage />);

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    // The next day comes first; the holiday period is no extra day.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Beweglicher Ferientag");
    expect(rows[0]).toHaveTextContent("Mo., 16.02.2099");
    expect(rows[0]).toHaveTextContent("1 Schule");
    expect(rows[0]).toHaveTextContent("pro Tag");
    expect(rows[0]).toHaveTextContent("Entwurf");
    expect(rows[1]).toHaveTextContent("Brückentag nach Himmelfahrt");
    expect(rows[1]).toHaveTextContent("Fr., 22.05.2099");
    expect(rows[1]).toHaveTextContent("2 Schulen");
    expect(rows[1]).toHaveTextContent("08.05.2099");
    expect(rows[1]).toHaveTextContent("Im Monatsbeitrag enthalten");
    expect(rows[1]).toHaveTextContent("Veröffentlicht");
    expect(within(table).queryByText("Osterferien 2099")).toBeNull();
    expect(
      screen.getByText("Kinder mit Platz").parentElement?.parentElement,
    ).toHaveTextContent("2 Zusatztage, 1 veröffentlicht, 3 Kinder mit Platz");

    fireEvent.click(within(table).getByText("Brückentag nach Himmelfahrt"));
    expect(mockPush).toHaveBeenCalledWith("/ferien/7");
    expect(
      screen.getByRole("link", { name: "Zusatztag anlegen" }),
    ).toHaveAttribute("href", "/ferien/zusatztage/neu");
  });

  it("says what to do when the Träger has no extra day yet", async () => {
    mockFetchPeriods.mockResolvedValue([holidays]);
    render(<TraegerExtraDaysPage />);

    expect(
      (await screen.findAllByText("Noch kein Zusatztag.")).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: "Zusatztag anlegen" }),
    ).toBeInTheDocument();
  });

  it("keeps the extra days out of the list of holiday periods", async () => {
    mockFetchPeriods.mockResolvedValue([holidays, day({})]);
    render(<TraegerHolidayPeriodsPage />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Osterferien 2099")).toBeInTheDocument();
    expect(within(table).queryByText("Brückentag nach Himmelfahrt")).toBeNull();
    // Both lists are one click apart.
    expect(screen.getByRole("tab", { name: "Zusatztage" })).toHaveAttribute(
      "href",
      "/ferien/zusatztage",
    );
  });
});
