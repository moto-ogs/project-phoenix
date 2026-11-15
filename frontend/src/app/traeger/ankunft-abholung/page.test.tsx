import { SWRConfig } from "~/lib/swr/testing";
vi.unmock("swr");
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSWRScope } from "~/lib/swr/scope";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type {
  ArrivalPickupWeekday,
  TraegerArrivalPickupTimes,
} from "~/lib/traeger-arrival-pickup-api";

const { mockFetch, mockDownload, mockDownloadBlob, mockUseSession } =
  vi.hoisted(() => ({
    mockFetch: vi.fn(),
    mockDownload: vi.fn(),
    mockDownloadBlob: vi.fn(),
    mockUseSession: vi.fn(),
  }));

vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path,
}));
vi.mock("next-auth/react", () => ({ useSession: mockUseSession }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/ankunft-abholung",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("~/lib/traeger-arrival-pickup-api", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/lib/traeger-arrival-pickup-api")
  >()),
  fetchTraegerArrivalPickupTimes: mockFetch,
  downloadTraegerArrivalPickupTimes: mockDownload,
}));
vi.mock("~/lib/file-download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/file-download")>()),
  downloadBlob: mockDownloadBlob,
}));
vi.mock("~/env.client", () => ({
  clientEnv: {
    NEXT_PUBLIC_TENANT_DOMAIN: "moto-app.de",
    NEXT_PUBLIC_TRAEGER_HOSTNAME: "traeger.moto-app.de",
  },
}));

import TraegerArrivalPickupPage from "./page";

/** 07:00 to 08:00 and 15:00 to 15:30, enough for the tests. */
function weekday(
  day: number,
  days: number,
  arrivals: [number, number],
  pickup: number,
): ArrivalPickupWeekday {
  return {
    weekday: day,
    days,
    slots: [
      { startMinute: 420, arrivals: arrivals[0], pickups: 0 },
      { startMinute: 450, arrivals: arrivals[1], pickups: 0 },
      { startMinute: 900, arrivals: 0, pickups: pickup },
    ],
  };
}

const TIMES: TraegerArrivalPickupTimes = {
  from: "2026-08-12",
  to: "2026-09-08",
  slotMinutes: 30,
  firstMinute: 420,
  lastMinute: 900,
  all: {
    weekdays: [weekday(1, 4, [3, 12.5], 9), weekday(2, 4, [2, 8], 21.5)],
  },
  schools: [
    {
      id: "2",
      name: "OGS Am Bach",
      slug: "am-bach",
      subdomain: "am-bach",
      city: "Bissendorf",
      firstDay: "2026-08-12",
      weekdays: [weekday(1, 4, [3, 10], 7), weekday(2, 4, [2, 6], 20)],
    },
    {
      id: "3",
      name: "OGS Lindenweg",
      slug: "lindenweg",
      subdomain: "lindenweg",
      city: "Melle",
      firstDay: "2026-08-26",
      weekdays: [weekday(1, 2, [0, 2.5], 2), weekday(2, 2, [0, 2], 1.5)],
    },
  ],
};

function renderPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>
        <TraegerArrivalPickupPage />
      </ToastProvider>
    </SWRConfig>,
  );
}

describe("TraegerArrivalPickupPage", () => {
  beforeEach(() => {
    resetSWRScope({ revalidate: false });
    mockFetch.mockReset();
    mockDownload.mockReset();
    mockDownloadBlob.mockReset();
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: "A",
          scope: "org",
          orgId: 7,
          permissions: ["traeger_reports:read"],
        },
      },
      status: "authenticated",
    });
  });

  it("reads the last four weeks up to yesterday and shows the busiest half hours of all schools", async () => {
    mockFetch.mockResolvedValue(TIMES);
    renderPage();

    const arrivals = await screen.findByRole("table", {
      name: "Ankunft je Wochentag und halbe Stunde",
    });
    expect(mockFetch).toHaveBeenCalledWith({
      from: "2026-08-12",
      to: "2026-09-08",
    });
    expect(
      screen.getByText("Im Schnitt 12,5 Kinder von 07:30 bis 08:00 Uhr."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Im Schnitt 21,5 Kinder von 15:00 bis 15:30 Uhr."),
    ).toBeInTheDocument();
    // Arrivals: Monday 15.5, Tuesday 10, so 13 children on an average day.
    const perDay = screen
      .getByText("So viele Kinder kommen an einem normalen Tag an.")
      .closest(".relative");
    expect(perDay).toHaveTextContent(/^Kinder am Tag13So viele/);
    expect(screen.getByText("12.08.2026 bis 08.09.2026")).toBeInTheDocument();
    expect(screen.queryByText("Schulen")).not.toBeInTheDocument();

    expect(
      within(arrivals).getByText(
        "Montag, 07:30 bis 08:00 Uhr: im Schnitt 12,5 Kinder kommen an.",
      ),
    ).toBeInTheDocument();
    expect(
      within(arrivals).getByText(
        "Montag, 15:00 bis 15:30 Uhr: kein Kind kommt an.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Am meisten: Dienstag, 15:00 bis 15:30 Uhr: im Schnitt 21,5 Kinder gehen.",
      ),
    ).toBeInTheDocument();
  });

  it("opens one school from its row and names a school whose data starts later", async () => {
    mockFetch.mockResolvedValue(TIMES);
    renderPage();
    expect(
      await screen.findByRole("heading", { name: /Je Schule/ }),
    ).toBeInTheDocument();
    const linden = screen.getByText("OGS Lindenweg").closest("tr")!;
    expect(within(linden).getByText("ab 26.08.2026")).toBeInTheDocument();

    fireEvent.click(linden);

    expect(
      await screen.findByText("Im Schnitt 2,5 Kinder von 07:30 bis 08:00 Uhr."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("aus 2 Tagen").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("heading", { name: /Je Schule/ }),
    ).not.toBeInTheDocument();
  });

  it("says so when no school checked a child in", async () => {
    mockFetch.mockResolvedValue({
      ...TIMES,
      all: { weekdays: [weekday(1, 0, [0, 0], 0)] },
      schools: TIMES.schools.map((school) => ({
        ...school,
        firstDay: null,
        weekdays: [weekday(1, 0, [0, 0], 0)],
      })),
    });
    renderPage();

    expect(
      await screen.findByText(
        "In diesem Zeitraum hat keine Schule Kinder eingecheckt.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("table", { name: /Ankunft je Wochentag/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the refusal of a role without the right instead of figures", async () => {
    mockFetch.mockRejectedValue(
      new ApiError("Forbidden", 403, { code: "general.forbidden" }),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Meiste Ankünfte")).not.toBeInTheDocument();
  });

  it("downloads the period as a table", async () => {
    mockFetch.mockResolvedValue(TIMES);
    const blob = new Blob(["Von;Bis"]);
    mockDownload.mockResolvedValue({
      blob,
      filename: "ankunft-und-abholung-2026-08-12-bis-2026-09-08.csv",
    });
    renderPage();
    await screen.findByRole("table", {
      name: "Ankunft je Wochentag und halbe Stunde",
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Ankunft und Abholung herunterladen",
      }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: /CSV/ }));

    await vi.waitFor(() =>
      expect(mockDownloadBlob).toHaveBeenCalledWith(
        blob,
        "ankunft-und-abholung-2026-08-12-bis-2026-09-08.csv",
      ),
    );
    expect(mockDownload).toHaveBeenCalledWith({
      from: "2026-08-12",
      to: "2026-09-08",
    });
  });
});
