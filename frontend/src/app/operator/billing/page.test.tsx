/**
 * Tests for the operator billing page (#2791): key day, monthly key-date
 * counts with totals, CSV downloads and the empty state.
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
// eslint-disable-next-line no-restricted-imports -- operator pages are not tenant-scoped
import { SWRConfig } from "~/lib/swr/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { testClockDay } from "~/test/clock-instant";
import { setTestClock } from "~/test/clock";
import type {
  BillingKeyDateCount,
  BillingKeyDay,
} from "~/lib/operator/billing-api";

const {
  mockGetKeyDay,
  mockUpdateKeyDay,
  mockListKeyDateCounts,
  mockDownload,
  mockToastSuccess,
  mockToastError,
  mockSetBreadcrumb,
  mockListOrganizations,
  mockListSchools,
} = vi.hoisted(() => ({
  mockListOrganizations: vi.fn(),
  mockListSchools: vi.fn(),
  mockGetKeyDay: vi.fn(),
  mockUpdateKeyDay: vi.fn(),
  mockListKeyDateCounts: vi.fn(),
  mockDownload: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockSetBreadcrumb: vi.fn(),
}));

// The page's loading, empty and saved states come from SWR itself, so this
// file runs the real library over a fresh cache per test.
vi.unmock("swr");

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "operator-1", scope: "operator" } },
  }),
}));

vi.mock("~/lib/breadcrumb-context", () => ({
  useSetBreadcrumb: mockSetBreadcrumb,
}));

vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useToast: () => ({ success: mockToastSuccess, error: mockToastError }),
}));

vi.mock("~/lib/operator/billing-api", async () => {
  const actual = await vi.importActual<
    typeof import("~/lib/operator/billing-api")
  >("~/lib/operator/billing-api");
  return {
    ...actual,
    operatorBillingService: {
      getKeyDay: mockGetKeyDay,
      updateKeyDay: mockUpdateKeyDay,
      listKeyDateCounts: mockListKeyDateCounts,
      downloadKeyDateCounts: mockDownload,
    },
  };
});

// The key day dialog reads the Träger and schools it can reach.
vi.mock("~/lib/operator/provisioning-api", () => ({
  operatorProvisioningService: {
    listOrganizations: mockListOrganizations,
    listSchools: mockListSchools,
  },
}));

import OperatorBillingPage from "./page-content";

const keyDay: BillingKeyDay = {
  keyDay: 15,
  nextKeyDate: "2026-09-15",
  updatedAt: "2026-09-01T08:00:00Z",
  overrides: [],
};

function count(
  overrides: Partial<BillingKeyDateCount> = {},
): BillingKeyDateCount {
  return {
    schoolId: "11",
    schoolName: "OGS Am Berg",
    organizationName: "Träger Nord",
    period: "2026-08-01",
    keyDate: "2026-08-15",
    activeStudents: 120,
    activeTerminals: 3,
    recordedAt: "2026-08-15T04:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <OperatorBillingPage />
      </SWRConfig>
    </ToastProvider>,
  );
}

describe("OperatorBillingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetKeyDay.mockResolvedValue(keyDay);
    mockDownload.mockResolvedValue(undefined);
    mockListOrganizations.mockResolvedValue([]);
    mockListSchools.mockResolvedValue([]);
  });

  it("shows each school's own key date in its row (#7301)", async () => {
    mockListKeyDateCounts.mockResolvedValue([
      count({ schoolId: "11", keyDate: "2026-08-15" }),
      count({
        schoolId: "12",
        schoolName: "OGS Lindenweg",
        keyDate: "2026-08-05",
      }),
    ]);
    renderPage();

    const linden = (await screen.findAllByText("OGS Lindenweg"))
      .map((cell) => cell.closest("tr"))
      .find(Boolean) as HTMLElement;
    expect(within(linden).getByText("05.08.2026")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /^Stichtag/ }),
    ).toBeInTheDocument();
  });

  // The pending school's key date lies in the running month; whether it is
  // still ahead or already past depends on the day, so each case sets it.
  function mockRunningMonthWithPendingSchool() {
    const month = "2026-11";
    mockListKeyDateCounts.mockResolvedValue([
      count({
        period: `${month}-01`,
        keyDate: `${month}-05`,
        recordedAt: `${month}-05T05:00:00Z`,
      }),
    ]);
    mockGetKeyDay.mockResolvedValue({
      ...keyDay,
      overrides: [
        {
          scope: "organization",
          id: "4",
          organizationId: "4",
          name: "Träger Nord",
          organizationName: "",
          keyDay: 20,
          nextKeyDate: `${month}-20`,
          updatedAt: "2026-08-01T08:00:00Z",
        },
      ],
    });
    mockListOrganizations.mockResolvedValue([
      { id: "4", name: "Träger Nord", deletedAt: null },
    ]);
    mockListSchools.mockResolvedValue([
      { id: "11", organizationId: "4", name: "OGS Am Berg", deletedAt: null },
      { id: "13", organizationId: "4", name: "OGS Neu", deletedAt: null },
      {
        id: "14",
        organizationId: "4",
        name: "OGS Alt",
        deletedAt: "2026-01-01",
      },
    ]);
  }

  async function pendingRow(): Promise<HTMLElement> {
    renderPage();
    return (await screen.findAllByText("OGS Neu"))
      .map((cell) => cell.closest("tr"))
      .find(Boolean) as HTMLElement;
  }

  it("lists the schools still without figures in the running month (#7301)", async () => {
    setTestClock("2026-11-10T12:00:00+01:00");
    mockRunningMonthWithPendingSchool();

    const neu = await pendingRow();
    // Its Träger's own day gives the key date of the month.
    expect(within(neu).getByText("20.11.2026")).toBeInTheDocument();
    expect(within(neu).getByText("noch nicht erfasst")).toBeInTheDocument();
    expect(screen.queryAllByText("OGS Alt")).toHaveLength(0);
    expect(screen.getByText("1 von 2")).toBeInTheDocument();
    expect(screen.getByText("Schulen erfasst")).toBeInTheDocument();
    expect(
      screen.getByText(/Schulen ohne Zahlen stehen mit ihrem Stichtag dabei\./),
    ).toBeInTheDocument();
  });

  it("marks a school whose key date passed without figures (#7301)", async () => {
    // The first Berlin day after the key date, while UTC is still on the 20th.
    setTestClock("2026-11-21T00:30:00+01:00");
    mockRunningMonthWithPendingSchool();

    const neu = await pendingRow();
    // Anker: the pending row is loaded and marked as overdue.
    expect(within(neu).getByText("20.11.2026")).toBeInTheDocument();
    expect(within(neu).getByText("Zahlen fehlen")).toBeInTheDocument();
    expect(within(neu).queryByText("noch nicht erfasst")).toBeNull();
  });

  it("shows the key day and the next key date", async () => {
    mockListKeyDateCounts.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText("Jeden Monat am 15.")).toBeInTheDocument();
    expect(screen.getByText("nächster am 15.09.2026")).toBeInTheDocument();
  });

  it("uses Stichtagszahlen as the report title", async () => {
    mockListKeyDateCounts.mockResolvedValue([]);
    renderPage();

    await screen.findByText("Jeden Monat am 15.");
    expect(mockSetBreadcrumb).toHaveBeenCalledWith({
      pageTitle: "Stichtagszahlen",
    });
    expect(screen.getAllByText("Stichtagszahlen")).not.toHaveLength(0);
  });

  it("explains when the first counts arrive while none are captured", async () => {
    mockListKeyDateCounts.mockResolvedValue([]);
    renderPage();

    expect(
      await screen.findByText("Noch keine Stichtagszahlen"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        "moto erfasst die Zahlen am Stichtag ab 6 Uhr. Fällt die Erfassung am Stichtag aus, holt moto sie im selben Monat nach.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Weitere Aktionen" }),
    ).not.toBeInTheDocument();
  });

  it("explains that active physical terminals count while offline", async () => {
    mockListKeyDateCounts.mockResolvedValue([]);
    renderPage();

    // #7301: the counting rules sit in the info next to the title.
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Erklärung zu Stichtagszahlen",
      }),
    );
    expect(
      await screen.findByText(/Auch offline Geräte zählen/),
    ).toBeInTheDocument();
  });

  it("explains that immediately activated children count before their planned start", async () => {
    mockListKeyDateCounts.mockResolvedValue([]);
    renderPage();

    // #7301: the counting rules sit in the info next to the title.
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Erklärung zu Stichtagszahlen",
      }),
    );
    expect(
      await screen.findByText(/Ein sofort aktiviertes Kind zählt auch/),
    ).toBeInTheDocument();
  });

  it("shows the newest month with its totals and only that month's rows", async () => {
    mockListKeyDateCounts.mockResolvedValue([
      count({ period: "2026-08-01", schoolId: "11", activeStudents: 120 }),
      count({
        period: "2026-08-01",
        schoolId: "12",
        schoolName: "OGS Am See",
        activeStudents: 80,
        activeTerminals: 2,
      }),
      count({
        period: "2026-07-01",
        keyDate: "2026-07-15",
        schoolId: "11",
        schoolName: "OGS Juli",
        activeStudents: 999,
        recordedAt: "2026-07-15T04:00:00Z",
      }),
    ]);
    renderPage();

    expect(await screen.findAllByText("OGS Am See")).not.toHaveLength(0);
    expect(screen.getAllByText("15.08.2026")).not.toHaveLength(0);
    expect(screen.queryAllByText("OGS Juli")).toHaveLength(0);
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("marks a capture that ran after the key date as late", async () => {
    mockListKeyDateCounts.mockResolvedValue([
      count({ recordedAt: "2026-08-17T07:30:00Z" }),
    ]);
    renderPage();

    // The table renders its desktop and its stacked phone layout.
    expect(
      await screen.findAllByText("17.08.2026, 09:30 Uhr · nachträglich"),
    ).not.toHaveLength(0);
  });

  it("does not mark a capture from its key date as late later on", async () => {
    mockListKeyDateCounts.mockResolvedValue([count()]);
    renderPage();

    await screen.findAllByText("15.08.2026, 06:00 Uhr");
    expect(screen.queryByText(/nachträglich/)).not.toBeInTheDocument();
  });

  it("downloads the chosen month and every month as CSV", async () => {
    mockListKeyDateCounts.mockResolvedValue([count()]);
    renderPage();

    // #7301: the downloads sit in the page menu under „Herunterladen“.
    fireEvent.click(
      await screen.findByRole("button", { name: "Weitere Aktionen" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /August 2026 als CSV/ }),
    );
    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith("2026-08"));

    fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Alle Monate als CSV/ }),
    );
    await waitFor(() =>
      expect(mockDownload).toHaveBeenLastCalledWith(undefined),
    );
  });

  it("reports a failed download without leaving the page", async () => {
    mockListKeyDateCounts.mockResolvedValue([count()]);
    mockDownload
      .mockRejectedValueOnce(new ApiError("boom", 503))
      .mockResolvedValueOnce(undefined);
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Weitere Aktionen" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /August 2026 als CSV/ }),
    );
    // #2519: catalog text by code in the toast, with retry.
    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Datei mit den Stichtagszahlen"),
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(2));
  });

  it("shows a failed counts load with retry", async () => {
    mockListKeyDateCounts
      .mockRejectedValueOnce(new ApiError("boom", 500))
      .mockResolvedValueOnce([count()]);
    renderPage();

    expect(
      await screen.findByText(
        catalogText("general.server", "die Liste der Stichtagszahlen"),
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect((await screen.findAllByText("OGS Am Berg")).length).toBeGreaterThan(
      0,
    );
  });

  /** Opens the standard's dialog through its row menu (#7301). */
  async function openStandardDialog() {
    fireEvent.click(
      await screen.findByRole("button", { name: "Aktionen für den Standard" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Tag ändern/ }),
    );
    return screen.findByRole("dialog");
  }

  async function chooseDay(dialog: HTMLElement, day: string) {
    fireEvent.click(
      within(dialog).getByRole("combobox", { name: /Tag im Monat/ }),
    );
    fireEvent.click(await screen.findByRole("option", { name: day }));
  }

  it("changes the standard key day in its dialog", async () => {
    mockListKeyDateCounts.mockResolvedValue([]);
    mockUpdateKeyDay.mockResolvedValue({
      ...keyDay,
      keyDay: 10,
      nextKeyDate: "2026-10-10",
    });
    renderPage();

    const dialog = await openStandardDialog();
    const save = within(dialog).getByRole("button", {
      name: "Stichtag festlegen",
    });
    // The standard day itself is no change.
    expect(save).toHaveAttribute("aria-disabled", "true");
    await chooseDay(dialog, "10.");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Stichtag festlegen" }),
    );

    await waitFor(() => expect(mockUpdateKeyDay).toHaveBeenCalledWith(10));
    expect(await screen.findByText("Jeden Monat am 10.")).toBeInTheDocument();
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Der Standard ist jetzt der 10. Nächster Stichtag: 10.10.2026.",
    );
  });

  it("keeps the dialog open and says so when saving fails", async () => {
    mockListKeyDateCounts.mockResolvedValue([]);
    mockUpdateKeyDay.mockRejectedValue(
      new ApiError("key day out of range", 400, {
        code: "general.input",
        errors: [{ field: "key_day", reason: "out_of_range" }],
      }),
    );
    renderPage();

    const dialog = await openStandardDialog();
    await chooseDay(dialog, "20.");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Stichtag festlegen" }),
    );

    expect(
      await within(dialog).findByText(
        catalogText("general.input", "der Stichtag"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("key day out of range")).toBeNull();
    expect(mockToastError).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps the schools without figures listed when the key days fail to load (#7301)", async () => {
    const month = testClockDay(0).slice(0, 7);
    mockListKeyDateCounts.mockResolvedValue([
      count({ period: `${month}-01`, keyDate: `${month}-05` }),
    ]);
    mockGetKeyDay.mockRejectedValue(new ApiError("boom", 503));
    mockListOrganizations.mockResolvedValue([
      { id: "4", name: "Träger Nord", deletedAt: null },
    ]);
    mockListSchools.mockResolvedValue([
      { id: "11", organizationId: "4", name: "OGS Am Berg", deletedAt: null },
      { id: "13", organizationId: "4", name: "OGS Neu", deletedAt: null },
    ]);
    renderPage();

    const neu = (await screen.findAllByText("OGS Neu"))
      .map((cell) => cell.closest("tr"))
      .find(Boolean) as HTMLElement;
    expect(within(neu).getByText("unbekannt")).toBeInTheDocument();
    expect(screen.getByText("1 von 2")).toBeInTheDocument();
  });
});
