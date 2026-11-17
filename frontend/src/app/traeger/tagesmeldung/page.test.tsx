import { SWRConfig } from "~/lib/swr/testing";
vi.unmock("swr");
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSWRScope } from "~/lib/swr/scope";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type {
  DailyAttendanceDay,
  DailyAttendanceSummary,
  TraegerDailyAttendance,
} from "~/lib/traeger-daily-attendance-api";
import { testClockDay } from "~/test/clock";

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
  usePathname: () => "/tagesmeldung",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("~/lib/traeger-daily-attendance-api", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/lib/traeger-daily-attendance-api")
  >()),
  fetchTraegerDailyAttendance: mockFetch,
  downloadTraegerDailyAttendance: mockDownload,
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

import TraegerDailyAttendancePage from "./page";

const EMPTY = {
  present: 0,
  sick: 0,
  excused: 0,
  classTrip: 0,
  withoutPickup: 0,
  firstArrival: null,
  lastPickup: null,
  averageMinutes: null,
  longestMinutes: null,
};

function day(
  date: string,
  figures: Partial<DailyAttendanceDay> = {},
): DailyAttendanceDay {
  return { ...EMPTY, date, ...figures };
}

function summary(
  figures: Partial<DailyAttendanceSummary>,
): DailyAttendanceSummary {
  return { ...EMPTY, daysWithChildren: 0, presentPerDay: 0, ...figures };
}

const MONDAY = day("2026-09-07", {
  present: 12,
  sick: 2,
  excused: 1,
  withoutPickup: 1,
  firstArrival: "2026-09-07T05:10:00Z",
  lastPickup: "2026-09-07T15:05:00Z",
  averageMinutes: 320,
  longestMinutes: 590,
});
const TUESDAY = day("2026-09-08", {
  present: 13,
  classTrip: 4,
  firstArrival: "2026-09-08T05:30:00Z",
  lastPickup: "2026-09-08T14:45:00Z",
  averageMinutes: 300,
  longestMinutes: 540,
});

// The page asks for the last week up to yesterday of the test day.
const LAST_WEEK = { from: testClockDay(-7), to: testClockDay(-1) };

// The server's answer is a fixed week; the page shows what it gets.
const REPORT: TraegerDailyAttendance = {
  from: "2026-09-02",
  to: "2026-09-08",
  otherSchools: 1,
  summary: summary({
    present: 25,
    sick: 2,
    excused: 1,
    classTrip: 4,
    daysWithChildren: 2,
    presentPerDay: 12.5,
    averageMinutes: 310,
    longestMinutes: 590,
  }),
  days: [day("2026-09-04"), MONDAY, TUESDAY],
  schools: [
    {
      id: "2",
      name: "Hort am Hafen",
      slug: "hafen",
      subdomain: "hafen",
      city: "Rostock",
      summary: summary({ present: 12, daysWithChildren: 1, presentPerDay: 12 }),
      days: [day("2026-09-04"), MONDAY, day("2026-09-08")],
    },
    {
      id: "3",
      name: "Hort Warnowblick",
      slug: "warnow",
      subdomain: "warnow",
      city: "Rostock",
      summary: summary({
        present: 13,
        classTrip: 4,
        daysWithChildren: 1,
        presentPerDay: 13,
      }),
      days: [day("2026-09-04"), day("2026-09-07"), TUESDAY],
    },
  ],
};

function renderPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>
        <TraegerDailyAttendancePage />
      </ToastProvider>
    </SWRConfig>,
  );
}

describe("TraegerDailyAttendancePage", () => {
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

  it("reads the last week up to yesterday and shows each day of all schools", async () => {
    mockFetch.mockResolvedValue(REPORT);
    renderPage();

    await screen.findByRole("heading", { name: /^Je Tag/ });
    const table = screen.getAllByRole("table")[0]!;
    expect(mockFetch).toHaveBeenCalledWith(LAST_WEEK);
    expect(screen.getByText("02.09.2026 bis 08.09.2026")).toBeInTheDocument();
    expect(
      screen.getByText("Schule in einem anderen Land, nicht enthalten"),
    ).toBeInTheDocument();
    expect(screen.getByText("12,5")).toBeInTheDocument();
    expect(
      screen.getByText("Im Schnitt an 2 Tagen mit Kindern."),
    ).toBeInTheDocument();
    expect(screen.getByText("5 Std. 10 Min.")).toBeInTheDocument();
    expect(screen.getByText("9 Std. 50 Min.")).toBeInTheDocument();
    expect(
      screen.getByText("2 krank · 1 entschuldigt · 4 Klassenfahrt"),
    ).toBeInTheDocument();

    const monday = within(table).getByText("Mo, 07.09.").closest("tr")!;
    expect(within(monday).getByText("07:10")).toBeInTheDocument();
    expect(within(monday).getByText("17:05")).toBeInTheDocument();
    expect(within(monday).getByText("5 Std. 20 Min.")).toBeInTheDocument();
    expect(
      within(monday).getByText("1 Kind nicht ausgecheckt"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Das Land legt das Format noch fest"),
    ).toBeInTheDocument();
  });

  it("opens one school from its row", async () => {
    mockFetch.mockResolvedValue(REPORT);
    renderPage();
    const schools = await screen.findByRole("heading", { name: /Je Schule/ });
    expect(schools).toBeInTheDocument();

    fireEvent.click(screen.getByText("Hort Warnowblick").closest("tr")!);

    expect(
      await screen.findByRole("heading", { name: /Je Tag: Hort Warnowblick/ }),
    ).toBeInTheDocument();
    const tuesday = screen.getByText("Di, 08.09.").closest("tr")!;
    expect(within(tuesday).getByText("13")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Je Schule/ }),
    ).not.toBeInTheDocument();
  });

  it("explains that the report is for schools in Mecklenburg-Vorpommern only", async () => {
    mockFetch.mockResolvedValue({
      ...REPORT,
      otherSchools: 3,
      days: [],
      schools: [],
    });
    renderPage();

    expect(
      await screen.findByText("Keine Schule in Mecklenburg-Vorpommern"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /^Je Tag/ }),
    ).not.toBeInTheDocument();
  });

  it("says so when no child was there in the period", async () => {
    mockFetch.mockResolvedValue({
      ...REPORT,
      summary: summary({}),
      days: [day("2026-09-07")],
      schools: REPORT.schools.map((school) => ({
        ...school,
        summary: summary({}),
        days: [day("2026-09-07")],
      })),
    });
    renderPage();

    expect(
      await screen.findByText("Im Zeitraum war an keiner Schule ein Kind da."),
    ).toBeInTheDocument();
  });

  it("shows the refusal of a role without the right instead of figures", async () => {
    mockFetch.mockRejectedValue(
      new ApiError("Forbidden", 403, { code: "general.forbidden" }),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Kinder am Tag")).not.toBeInTheDocument();
  });

  it("downloads the file for the state", async () => {
    mockFetch.mockResolvedValue(REPORT);
    const blob = new Blob(["Einrichtung;Ort"]);
    mockDownload.mockResolvedValue({
      blob,
      filename: "tagesmeldung-mv-2026-09-02-bis-2026-09-08.csv",
    });
    renderPage();
    await screen.findByRole("heading", { name: /^Je Tag/ });

    fireEvent.click(
      screen.getByRole("button", { name: "Tagesmeldung herunterladen" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: /CSV/ }));

    await vi.waitFor(() =>
      expect(mockDownloadBlob).toHaveBeenCalledWith(
        blob,
        "tagesmeldung-mv-2026-09-02-bis-2026-09-08.csv",
      ),
    );
    expect(mockDownload).toHaveBeenCalledWith(LAST_WEEK, "csv");
  });
});
