import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { ApiError } from "~/lib/api-error";
import type {
  KeyDateReport,
  ReportFigures,
  ReportTemplate,
} from "~/lib/traeger-reports-api";
import { TEST_CLOCK_TODAY } from "~/test/clock";

vi.unmock("swr");
const {
  mockFetchReport,
  mockDownload,
  mockDelete,
  mockDownloadBlob,
  mockUseSession,
  mockTemplates,
  mockSearch,
} = vi.hoisted(() => ({
  mockFetchReport: vi.fn(),
  mockDownload: vi.fn(),
  mockDelete: vi.fn(),
  mockDownloadBlob: vi.fn(),
  mockUseSession: vi.fn(),
  mockTemplates: vi.fn(),
  mockSearch: { value: "" },
}));

vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path,
}));
vi.mock("next-auth/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth/react")>()),
  useSession: mockUseSession,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/berichte",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch.value),
}));
vi.mock("~/lib/traeger-reports-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/traeger-reports-api")>()),
  fetchKeyDateReport: mockFetchReport,
  downloadKeyDateReport: mockDownload,
  deleteReportTemplate: mockDelete,
}));
vi.mock("~/components/traeger/use-report-templates", () => ({
  useReportTemplates: mockTemplates,
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

import TraegerReportsPage from "./page";

function figures(overrides: Partial<ReportFigures>): ReportFigures {
  return {
    children: 0,
    withoutCareForm: 0,
    staff: 0,
    childrenPerStaff: null,
    presentDays: 0,
    sickDays: 0,
    excusedDays: 0,
    absenceRate: null,
    places: 0,
    bookedPlaces: 0,
    freePlaces: 0,
    booked: 0,
    open: 0,
    waitlisted: 0,
    demand: 0,
    ...overrides,
  };
}

const BACH = figures({
  children: 50,
  withoutCareForm: 2,
  staff: 5,
  childrenPerStaff: 10,
  presentDays: 1800,
  sickDays: 150,
  excusedDays: 50,
  absenceRate: 10,
  places: 45,
  bookedPlaces: 45,
  booked: 48,
  open: 4,
  waitlisted: 3,
  demand: 55,
});
const LINDE = figures({
  children: 30,
  staff: 4,
  childrenPerStaff: 7.5,
  places: 40,
  bookedPlaces: 28,
  freePlaces: 12,
  booked: 30,
  open: 1,
  demand: 31,
});
const TOTAL = figures({
  children: 80,
  withoutCareForm: 2,
  staff: 9,
  childrenPerStaff: 80 / 9,
  presentDays: 1800,
  sickDays: 150,
  excusedDays: 50,
  absenceRate: 10,
  places: 85,
  bookedPlaces: 73,
  freePlaces: 12,
  booked: 78,
  open: 5,
  waitlisted: 3,
  demand: 86,
});

// The last key date (MM-DD) on or before the test day.
function lastKeyDate(monthDay: string): string {
  const year = Number(TEST_CLOCK_TODAY.slice(0, 4));
  const thisYear = `${year}-${monthDay}`;
  return thisYear <= TEST_CLOCK_TODAY ? thisYear : `${year - 1}-${monthDay}`;
}
const LAST_15_OCTOBER = lastKeyDate("10-15");
const LAST_1_MARCH = lastKeyDate("03-01");

const STANDARD_REPORT: KeyDateReport = {
  keyDate: "2025-10-15",
  asOf: "2026-09-09T10:00:00Z",
  template: null,
  sections: ["children", "staff", "absences", "demand"],
  absenceWindow: { from: "2025-08-01", to: "2025-10-15" },
  schools: [
    {
      id: "2",
      name: "OGS Am Bach",
      city: "Bissendorf",
      district: null,
      attendanceFrom: "2025-09-01",
      figures: BACH,
      careForms: [
        { name: "Bis 16 Uhr", children: 45, capacity: 45, active: true },
        { name: "Frühbetreuung", children: 6, capacity: null, active: true },
      ],
    },
    {
      id: "3",
      name: "OGS Lindenweg",
      city: "Melle",
      district: null,
      attendanceFrom: null,
      figures: LINDE,
      careForms: [
        { name: "Bis 16 Uhr", children: 28, capacity: 40, active: true },
      ],
    },
  ],
  districts: [],
  total: { name: "", schools: 2, figures: TOTAL, careForms: [] },
};

const TEMPLATE: ReportTemplate = {
  id: "12",
  name: "Kommune Belegung",
  sections: ["demand"],
  keyDateMonth: 3,
  keyDateDay: 1,
  districts: [
    { schoolId: "2", district: "Nord" },
    { schoolId: "3", district: "Süd" },
  ],
  updatedAt: "2026-09-01T08:00:00Z",
};

const TEMPLATE_REPORT: KeyDateReport = {
  ...STANDARD_REPORT,
  keyDate: "2026-03-01",
  template: { id: "12", name: "Kommune Belegung" },
  sections: ["demand"],
  absenceWindow: null,
  schools: STANDARD_REPORT.schools.map((school, index) => ({
    ...school,
    district: index === 0 ? "Nord" : "Süd",
  })),
  districts: [
    { name: "Nord", unmapped: false, schools: 1, figures: BACH, careForms: [] },
    { name: "Süd", unmapped: false, schools: 1, figures: LINDE, careForms: [] },
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
      <TraegerReportsPage />
    </TraegerResourceTestProvider>,
  );
}

function tableNamed(name: RegExp | string): HTMLElement {
  const heading = screen.getByRole("heading", { name });
  return heading.closest("[data-testid='data-table-table']") as HTMLElement;
}

function rowOf(table: HTMLElement, text: string): HTMLElement {
  return within(table).getAllByText(text)[0]?.closest("tr") as HTMLElement;
}

async function openMenu(name: string) {
  const [menu] = await screen.findAllByRole("button", {
    name: `Aktionen für ${name}`,
  });
  fireEvent.click(menu!);
}

function openTab(name: string) {
  const tab = screen.getByRole("tab", { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
}

describe("TraegerReportsPage", () => {
  beforeEach(() => {
    mockFetchReport.mockReset();
    mockDownload.mockReset();
    mockDelete.mockReset();
    mockDownloadBlob.mockReset();
    mockSearch.value = "";
    mockTemplates.mockReturnValue({
      templates: [TEMPLATE],
      error: null,
      mutate: vi.fn().mockResolvedValue(undefined),
    });
    signIn(["traeger_reports:read"]);
  });

  it("opens the standard report on the last 15 October with every section and a total", async () => {
    mockFetchReport.mockResolvedValue(STANDARD_REPORT);
    renderPage();

    expect(await screen.findByText("Kinder am Stichtag")).toBeInTheDocument();
    expect(mockFetchReport).toHaveBeenCalledWith(LAST_15_OCTOBER, null);
    expect(screen.getByText("davon 2 ohne Betreuungsform")).toBeInTheDocument();
    // 73 of 85 places, the demand of 86 lacks one place.
    expect(screen.getByText("73 von 85 Plätzen")).toBeInTheDocument();
    expect(screen.getByText("1 Plätze fehlen")).toBeInTheDocument();
    expect(screen.getByText("8,9 Kinder je Person")).toBeInTheDocument();

    const demand = tableNamed("Belegung und Nachfrage");
    expect(
      within(rowOf(demand, "OGS Am Bach")).getByText("10 fehlen"),
    ).toBeInTheDocument();
    expect(
      within(rowOf(demand, "OGS Lindenweg")).getByText("9 frei"),
    ).toBeInTheDocument();
    expect(within(rowOf(demand, "Gesamt")).getByText("86")).toBeInTheDocument();

    expect(
      screen.getByRole("heading", {
        name: "Fehlzeiten vom 01.08.2025 bis 15.10.2025",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Bei einer Schule gibt es Check-ins erst ab 01.09.2025/),
    ).toBeInTheDocument();
  });

  it("opens the care forms of a school", async () => {
    mockFetchReport.mockResolvedValue(STANDARD_REPORT);
    renderPage();
    await screen.findByText("Kinder am Stichtag");

    const children = tableNamed("Kinder je Standort und Betreuungsform");
    fireEvent.click(rowOf(children, "OGS Am Bach"));
    expect(
      await within(children).findByText("Frühbetreuung"),
    ).toBeInTheDocument();
    expect(within(children).getByText("ohne Platzgrenze")).toBeInTheDocument();
    expect(within(children).getByText("45 Plätze")).toBeInTheDocument();
  });

  it("reads a template from the address, takes its key date and groups by district", async () => {
    mockSearch.value = "vorlage=12";
    mockFetchReport.mockResolvedValue(TEMPLATE_REPORT);
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Belegung und Nachfrage" }),
    ).toBeInTheDocument();
    expect(mockFetchReport).toHaveBeenCalledWith(LAST_1_MARCH, "12");
    // Only the demand section of the template.
    expect(screen.queryByText("Kinder am Stichtag")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Personal" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Je Sozialraum" }));
    const demand = tableNamed("Belegung und Nachfrage");
    expect(
      within(rowOf(demand, "Nord")).getByText("1 Schule"),
    ).toBeInTheDocument();
    expect(within(demand).queryByText("OGS Am Bach")).toBeNull();
  });

  it("downloads the report in the chosen format", async () => {
    mockFetchReport.mockResolvedValue(STANDARD_REPORT);
    const blob = new Blob(["%PDF"]);
    mockDownload.mockResolvedValue({
      blob,
      filename: "bericht-stichtag-2025-10-15.pdf",
    });
    renderPage();
    await screen.findByText("Kinder am Stichtag");

    fireEvent.click(
      screen.getByRole("button", { name: "Bericht herunterladen" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "PDF" }));
    await waitFor(() =>
      expect(mockDownloadBlob).toHaveBeenCalledWith(
        blob,
        "bericht-stichtag-2025-10-15.pdf",
      ),
    );
    expect(mockDownload).toHaveBeenCalledWith(LAST_15_OCTOBER, null, "pdf");
  });

  it("names the load error", async () => {
    mockFetchReport.mockRejectedValue(
      new ApiError("Request failed (500)", 500),
    );
    renderPage();
    await waitFor(() => expect(mockFetchReport).toHaveBeenCalled());
    expect(
      await screen.findByText(/Der Bericht konnte nicht/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Wiederholen" }),
    ).toBeInTheDocument();
  });

  it("shows a failed prerequisite template load on the report tab and retries it", async () => {
    mockSearch.value = "vorlage=12";
    const retry = vi.fn();
    mockTemplates.mockReturnValue({
      templates: null,
      error: {
        message: "Die Vorlagen konnten nicht geladen werden.",
        retry: { label: "Wiederholen", onClick: retry },
      },
      mutate: retry,
    });
    const view = renderPage();
    expect(
      await screen.findByText("Die Vorlagen konnten nicht geladen werden."),
    ).toBeInTheDocument();
    expect(mockFetchReport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(retry).toHaveBeenCalledOnce();

    mockFetchReport.mockResolvedValue(TEMPLATE_REPORT);
    mockTemplates.mockReturnValue({
      templates: [TEMPLATE],
      error: null,
      mutate: retry,
    });
    view.rerender(
      <TraegerResourceTestProvider>
        <TraegerReportsPage />
      </TraegerResourceTestProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "Belegung und Nachfrage" }),
    ).toBeInTheDocument();
    expect(mockFetchReport).toHaveBeenCalledWith(LAST_1_MARCH, "12");
  });

  it("lists templates read-only without the settings right", async () => {
    mockFetchReport.mockResolvedValue(STANDARD_REPORT);
    renderPage();
    await screen.findByText("Kinder am Stichtag");

    openTab("Vorlagen");
    expect(await screen.findByText("Kommune Belegung")).toBeInTheDocument();
    expect(
      screen.getByText("Stichtag 01.03. · 1 Abschnitt · 2 Sozialräume"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Neue Vorlage" })).toBeNull();
    await openMenu("Kommune Belegung");
    expect(
      await screen.findByRole("menuitem", { name: /Bericht zeigen/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Löschen/ })).toBeNull();
  });

  it("deletes a template after the second confirmation", async () => {
    signIn(["traeger_reports:read", "traeger_settings:manage"]);
    mockFetchReport.mockResolvedValue(STANDARD_REPORT);
    mockDelete.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText("Kinder am Stichtag");

    openTab("Vorlagen");
    expect(
      await screen.findByRole("link", { name: "Neue Vorlage" }),
    ).toHaveAttribute("href", "/traeger/berichte/vorlagen/neu");
    await openMenu("Kommune Belegung");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Löschen/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Ja, löschen" }),
    );
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Löschen" }),
    );
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("12"));
  });
});
