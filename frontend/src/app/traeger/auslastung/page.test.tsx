import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import type {
  TraegerUtilization,
  UtilizationChildren,
} from "~/lib/traeger-utilization-api";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";

vi.unmock("swr");

const {
  mockFetchUtilization,
  mockFetchChildren,
  mockDownload,
  mockDownloadBlob,
  mockUseSession,
} = vi.hoisted(() => ({
  mockFetchUtilization: vi.fn(),
  mockFetchChildren: vi.fn(),
  mockDownload: vi.fn(),
  mockDownloadBlob: vi.fn(),
  mockUseSession: vi.fn(),
}));

vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path,
}));
vi.mock("next-auth/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth/react")>()),
  useSession: mockUseSession,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/auslastung",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("~/lib/traeger-utilization-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/traeger-utilization-api")>()),
  fetchTraegerUtilization: mockFetchUtilization,
  fetchUtilizationChildren: mockFetchChildren,
  downloadTraegerUtilization: mockDownload,
}));
vi.mock("~/lib/file-download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/file-download")>()),
  downloadBlob: mockDownloadBlob,
}));
// recharts measures its container, which jsdom does not lay out.
vi.mock("~/components/traeger/utilization-chart", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/components/traeger/utilization-chart")
  >()),
  UtilizationChart: ({
    data,
  }: {
    data: readonly { label: string; belegt: number | null }[];
  }) => (
    <ol aria-label="Verlauf">
      {data.map((point) => (
        <li key={point.label}>
          {point.label}: {point.belegt ?? "–"}
        </li>
      ))}
    </ol>
  ),
}));
vi.mock("~/env.client", () => ({
  clientEnv: {
    NEXT_PUBLIC_TENANT_DOMAIN: "moto-app.de",
    NEXT_PUBLIC_TRAEGER_HOSTNAME: "traeger.moto-app.de",
  },
}));

import TraegerUtilizationPage from "./page";

const DAYS = ["2026-09-07", "2026-09-08"];

const UTILIZATION: TraegerUtilization = {
  from: "2026-09-07",
  to: "2026-09-08",
  days: DAYS,
  asOf: "2026-09-09T10:00:00Z",
  schools: [
    {
      id: "2",
      name: "OGS Am Bach",
      slug: "am-bach",
      subdomain: "am-bach",
      city: "Bissendorf",
      places: 10,
      booked: [9, 10],
      bookedPlaces: [8, 10],
      present: [7, 9],
      attendanceFrom: "2026-09-07",
      roomDataFrom: "2026-09-07",
      offerings: [
        {
          id: "21",
          name: "OGS bis 16 Uhr",
          capacity: 10,
          active: true,
          booked: [8, 10],
        },
        {
          id: "22",
          name: "Frühbetreuung",
          capacity: null,
          active: true,
          booked: [2, 1],
        },
      ],
      rooms: [
        {
          id: "31",
          name: "Bärenraum",
          capacity: 12,
          children: [14, 16],
          peak: [6, 9],
        },
      ],
    },
    {
      id: "3",
      name: "OGS Lindenweg",
      slug: "lindenweg",
      subdomain: "lindenweg",
      city: "Melle",
      places: 10,
      booked: [5, 5],
      bookedPlaces: [5, 5],
      present: [null, null],
      attendanceFrom: null,
      roomDataFrom: null,
      offerings: [
        {
          id: "23",
          name: "OGS bis 15 Uhr",
          capacity: 10,
          active: false,
          booked: [5, 5],
        },
      ],
      rooms: [],
    },
  ],
};

const CHILDREN: UtilizationChildren = {
  schoolId: "2",
  schoolName: "OGS Am Bach",
  from: "2026-09-07",
  to: "2026-09-08",
  children: [
    {
      studentId: "501",
      firstName: "Mia",
      lastName: "Albers",
      schoolClass: "2b",
      groupName: "Bären",
      careDays: 2,
      presentDays: 1,
      sickDays: 1,
      excusedDays: 0,
      unexplainedDays: 0,
      attendanceRate: 50,
    },
  ],
};

function signIn(permissions: string[]) {
  mockUseSession.mockReturnValue({
    data: { user: { id: "A", scope: "org", orgId: 7, permissions } },
    status: "authenticated",
  });
}

function renderPage() {
  return render(
    <TraegerResourceTestProvider>
      <TraegerUtilizationPage />
    </TraegerResourceTestProvider>,
  );
}

function openTab(name: string) {
  const tab = screen.getByRole("tab", { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
}

function rowOf(table: HTMLElement, text: string): HTMLElement {
  return within(table).getAllByText(text)[0]?.closest("tr") as HTMLElement;
}

describe("TraegerUtilizationPage", () => {
  beforeEach(() => {
    mockFetchUtilization.mockReset();
    mockFetchChildren.mockReset();
    mockDownload.mockReset();
    mockDownloadBlob.mockReset();
    signIn(["traeger_reports:read"]);
  });

  it("loads the last three months and sums the schools over the window", async () => {
    mockFetchUtilization.mockResolvedValue(UTILIZATION);
    renderPage();

    // 17 of 20 places booked on average: (8+5 + 10+5) / 2.
    expect(await screen.findByText("70 %")).toBeInTheDocument();
    expect(mockFetchUtilization).toHaveBeenCalledWith({
      from: "2026-06-10",
      to: "2026-09-09",
    });
    expect(screen.getByText("Ø 14 von 20 Plätzen")).toBeInTheDocument();
    // The fullest day is Tuesday: 15 of 20.
    expect(screen.getByText("75 %")).toBeInTheDocument();
    expect(screen.getByText("1 von 2")).toBeInTheDocument();

    const table = screen.getByRole("table");
    const bach = rowOf(table, "OGS Am Bach");
    expect(within(bach).getByText("Ø 9")).toBeInTheDocument();
    expect(within(bach).getByText("Ø 8")).toBeInTheDocument();
    expect(
      within(table).getByRole("link", { name: "OGS Am Bach" }),
    ).toHaveAttribute("href", "/traeger/schulen/2");
    const linde = rowOf(table, "OGS Lindenweg");
    expect(
      within(linde).getByText("keine Check-ins im Zeitraum", { exact: false }),
    ).toBeInTheDocument();
  });

  it("shows one row per offering and marks one no longer offered", async () => {
    mockFetchUtilization.mockResolvedValue(UTILIZATION);
    renderPage();
    await screen.findByText("70 %");

    openTab("Betreuungsformen");
    const table = await screen.findByRole("table");
    const full = rowOf(table, "OGS bis 16 Uhr");
    expect(within(full).getByText("1 Tag")).toBeInTheDocument();
    const retired = rowOf(table, "OGS bis 15 Uhr");
    expect(
      within(retired).getByText("Nicht mehr angeboten"),
    ).toBeInTheDocument();
    const unlimited = rowOf(table, "Frühbetreuung");
    expect(within(unlimited).getByText("Ø 1,5")).toBeInTheDocument();
  });

  it("charts the fullest room without a click", async () => {
    mockFetchUtilization.mockResolvedValue(UTILIZATION);
    renderPage();
    await screen.findByText("70 %");

    openTab("Räume");
    expect(
      await screen.findByRole("heading", {
        name: /Verlauf · Bärenraum · OGS Am Bach/,
      }),
    ).toBeInTheDocument();
    // Three months group by week: both days fall into KW 37.
    const weeks = await screen.findByRole("list", { name: "Verlauf" });
    expect(
      within(weeks)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["KW 37: 7.5"]);

    fireEvent.click(screen.getByRole("button", { name: "Tage" }));
    const days = screen.getByRole("list", { name: "Verlauf" });
    expect(
      within(days)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Mo 07.09.: 6", "Di 08.09.: 9"]);
  });

  it("exports the shown window as CSV", async () => {
    mockFetchUtilization.mockResolvedValue(UTILIZATION);
    const blob = new Blob(["Datum;Schule"], { type: "text/csv" });
    mockDownload.mockResolvedValue({ blob, filename: "auslastung.csv" });
    renderPage();
    await screen.findByText("70 %");

    fireEvent.click(
      screen.getByRole("button", { name: "Auslastung herunterladen" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: /CSV/ }));

    await vi.waitFor(() =>
      expect(mockDownloadBlob).toHaveBeenCalledWith(blob, "auslastung.csv"),
    );
    expect(mockDownload).toHaveBeenCalledWith(
      { from: "2026-06-10", to: "2026-09-09" },
      undefined,
      "csv",
    );
  });

  it("keeps the names closed without the right to manage contracts", async () => {
    mockFetchUtilization.mockResolvedValue(UTILIZATION);
    renderPage();
    await screen.findByText("70 %");

    expect(
      screen.getByText(/Die Namen der Kinder sehen nur Personen/),
    ).toBeInTheDocument();
    fireEvent.click(rowOf(screen.getByRole("table"), "OGS Am Bach"));
    expect(
      screen.queryByRole("button", { name: "Namen anzeigen" }),
    ).not.toBeInTheDocument();
    expect(mockFetchChildren).not.toHaveBeenCalled();
  });

  it("loads the names of one school only on request", async () => {
    signIn(["traeger_reports:read", "traeger_contracts:manage"]);
    mockFetchUtilization.mockResolvedValue(UTILIZATION);
    mockFetchChildren.mockResolvedValue(CHILDREN);
    renderPage();
    await screen.findByText("70 %");

    expect(screen.getByText(/Wählen Sie oben eine Schule/)).toBeInTheDocument();
    fireEvent.click(rowOf(screen.getByRole("table"), "OGS Am Bach"));
    const open = await screen.findByRole("button", { name: "Namen anzeigen" });
    expect(mockFetchChildren).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(open);
    });
    expect(await screen.findByText("Albers, Mia")).toBeInTheDocument();
    // Before the first check-in every care day would read as a day missed
    // without a reason: the names count from that day on.
    expect(mockFetchChildren).toHaveBeenCalledWith("2", {
      from: "2026-09-07",
      to: "2026-09-09",
    });
    expect(
      screen.getByRole("heading", {
        name: /Kinder mit Namen · OGS Am Bach · ab 07\.09\.2026/,
      }),
    ).toBeInTheDocument();
  });

  it("offers no names for a school without a check-in in the window", async () => {
    signIn(["traeger_reports:read", "traeger_contracts:manage"]);
    mockFetchUtilization.mockResolvedValue(UTILIZATION);
    renderPage();
    await screen.findByText("70 %");

    fireEvent.click(rowOf(screen.getByRole("table"), "OGS Lindenweg"));
    expect(
      await screen.findByText(
        /Die OGS Lindenweg hat im Zeitraum keine Check-ins/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Namen anzeigen" }),
    ).not.toBeInTheDocument();
  });

  it("shows a refused load with a retry instead of an empty page", async () => {
    mockFetchUtilization.mockRejectedValueOnce(
      new ApiError("forbidden", 403, { code: "general.forbidden" }),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("70 %")).not.toBeInTheDocument();
  });
});
