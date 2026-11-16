import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type { SettingsSchema } from "~/lib/settings-api";
import type {
  PayrollReport,
  TimeReport,
} from "~/lib/traeger-staff-exports-api";

const api = vi.hoisted(() => ({
  fetchPayrollReport: vi.fn(),
  fetchTimeReport: vi.fn(),
  downloadPayrollFile: vi.fn(),
  downloadTimeFile: vi.fn(),
}));
const settingsApi = vi.hoisted(() => ({
  saveTraegerSettingValue: vi.fn(),
  clearTraegerSettingValue: vi.fn(),
}));
const schema = vi.hoisted(() => ({
  data: undefined as SettingsSchema | undefined,
  mutate: vi.fn(),
}));
const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}));
const download = vi.hoisted(() => ({ downloadBlob: vi.fn() }));

vi.mock("~/lib/traeger-staff-exports-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
vi.mock("~/lib/traeger-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...settingsApi,
}));
vi.mock("~/lib/file-download", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...download,
}));
vi.mock("~/components/traeger/use-traeger-resources", () => ({
  useTraegerSettingsSchema: () => ({
    data: schema.data,
    isLoading: false,
    loadError: null,
    mutate: schema.mutate,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: navigation.replace }),
  usePathname: () => "/personal/lohnexport",
  useSearchParams: () => navigation.params,
}));

import TraegerPayrollExportPage from "./page";

const NOT_READY: PayrollReport = {
  year: 2026,
  month: 8,
  format: "datev_lodas",
  contracts: 3,
  people: 2,
  schools: 2,
  lineCount: 4,
  kinds: [
    { kind: "part_time", contracts: 1, lines: 1 },
    { kind: "uebungsleiter", contracts: 1, lines: 1 },
  ],
  withoutNumber: [{ recordId: "12", firstName: "Jonas", lastName: "Keller" }],
  unconfigured: [{ category: "plus_stunden", kind: "part_time" }],
  missingClient: true,
  noWageType: false,
  openSchools: ["OGS Nord"],
  contractChanges: [],
  ready: false,
};

const READY: PayrollReport = {
  ...NOT_READY,
  withoutNumber: [],
  missingClient: false,
  openSchools: [],
  ready: true,
};

const TIMES: TimeReport = {
  year: 2026,
  month: 8,
  people: 2,
  schools: 2,
  rows: 5,
  withoutNumber: [],
};

function payrollSchema(values: Record<string, string>): SettingsSchema {
  return {
    tabs: [
      {
        key: "lohnexport",
        label: "Lohnexport",
        categories: [
          {
            key: "lohnarten",
            label: "Lohnarten",
            items: Object.entries(values).map(([key, value]) => ({
              key,
              label: key,
              description: "",
              type: "text",
              default: "",
              value,
              is_default: value === "",
              writable: true,
            })),
          },
        ],
      },
    ],
  } as unknown as SettingsSchema;
}

function renderPage() {
  return render(
    <ToastProvider>
      <TraegerPayrollExportPage />
    </ToastProvider>,
  );
}

describe("TraegerPayrollExportPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.params = new URLSearchParams();
    api.fetchPayrollReport.mockResolvedValue(NOT_READY);
    api.fetchTimeReport.mockResolvedValue(TIMES);
    schema.data = payrollSchema({
      "traeger_payroll.datev_consultant_number": "",
      "traeger_payroll.wage_type.regelarbeit.minijob": "200",
    });
  });

  it("opens the last month and names what the file still waits for", async () => {
    renderPage();
    // The test clock stands in September 2026: the Lohnbüro bills August.
    expect(await screen.findByText("Das fehlt noch")).toBeInTheDocument();
    expect(api.fetchPayrollReport).toHaveBeenCalledWith(2026, 8, "datev_lodas");
    expect(
      screen.getByText("Jonas Keller hat noch keine Personalnummer."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Personalakte von Jonas Keller öffnen",
      }),
    ).toHaveAttribute("href", "/traeger/personal/12");
    expect(
      screen.getByText(
        "Für LODAS fehlen die Beraternummer oder die Mandantennummer.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Noch nicht abgeschlossen: OGS Nord/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Herunterladen/ }),
    ).toHaveAttribute("aria-disabled", "true");
    // Each kind of contract is its own row with what it lacks.
    expect(screen.getAllByText("Übungsleiter").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Plus-Stunden").length).toBeGreaterThan(0);
  });

  it("downloads the file once it is ready, in the chosen format", async () => {
    api.fetchPayrollReport.mockResolvedValue(READY);
    api.downloadPayrollFile.mockResolvedValue({
      blob: new Blob(["x"]),
      filename: "lohnexport_datev_lug_2026-08.txt",
    });
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Lohn und Gehalt" }),
    );
    await waitFor(() =>
      expect(api.fetchPayrollReport).toHaveBeenLastCalledWith(
        2026,
        8,
        "datev_lug",
      ),
    );
    const button = await screen.findByRole("button", { name: /Herunterladen/ });
    await waitFor(() =>
      expect(button).not.toHaveAttribute("aria-disabled", "true"),
    );
    fireEvent.click(button);
    await waitFor(() =>
      expect(download.downloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        "lohnexport_datev_lug_2026-08.txt",
      ),
    );
    expect(api.downloadPayrollFile).toHaveBeenCalledWith(2026, 8, "datev_lug");
  });

  it("goes to an earlier month and back to the last month", async () => {
    renderPage();
    await screen.findByText("Das fehlt noch");
    fireEvent.click(screen.getByRole("button", { name: "Vorheriger Monat" }));
    await waitFor(() =>
      expect(api.fetchPayrollReport).toHaveBeenLastCalledWith(
        2026,
        7,
        "datev_lodas",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Letzter Monat" }));
    await waitFor(() =>
      expect(api.fetchPayrollReport).toHaveBeenLastCalledWith(
        2026,
        8,
        "datev_lodas",
      ),
    );
  });

  it("keeps the shown month when an earlier answer comes late", async () => {
    let answerAugust: (report: PayrollReport) => void = () => undefined;
    api.fetchPayrollReport.mockImplementation((_year: number, month: number) =>
      month === 8
        ? new Promise<PayrollReport>((resolve) => {
            answerAugust = resolve;
          })
        : Promise.resolve({ ...READY, month, contracts: 7 }),
    );
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Vorheriger Monat" }),
    );
    await waitFor(() =>
      expect(api.fetchPayrollReport).toHaveBeenLastCalledWith(2026, 7, "datev_lodas"),
    );
    await waitFor(() => expect(screen.getByText("7")).toBeInTheDocument());
    answerAugust({ ...NOT_READY, contracts: 3 });
    await waitFor(() => expect(screen.getByText("7")).toBeInTheDocument());
    expect(screen.queryByText("Das fehlt noch")).toBeNull();
  });

  it("refreshes the shown month after a download of another month fails", async () => {
    api.fetchPayrollReport.mockImplementation((_year: number, month: number) =>
      Promise.resolve({ ...READY, month, contracts: month === 8 ? 3 : 7 }),
    );
    let failDownload: (err: unknown) => void = () => undefined;
    api.downloadPayrollFile.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          failDownload = reject;
        }),
    );
    renderPage();
    const button = await screen.findByRole("button", { name: /Herunterladen/ });
    await waitFor(() =>
      expect(button).not.toHaveAttribute("aria-disabled", "true"),
    );
    fireEvent.click(button);
    await waitFor(() => expect(api.downloadPayrollFile).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Vorheriger Monat" }));
    await waitFor(() => expect(screen.getByText("7")).toBeInTheDocument());
    failDownload(
      new ApiError("down", 503, { code: "general.unavailable" }),
    );
    await waitFor(() =>
      expect(api.fetchPayrollReport).toHaveBeenCalledTimes(3),
    );
    expect(api.fetchPayrollReport).toHaveBeenLastCalledWith(
      2026,
      7,
      "datev_lodas",
    );
    await waitFor(() => expect(screen.getByText("7")).toBeInTheDocument());
  });

  it("names a contract change within the month", async () => {
    api.fetchPayrollReport.mockResolvedValue({
      ...READY,
      contractChanges: [
        { recordId: "11", firstName: "Mira", lastName: "Sommer" },
      ],
    });
    renderPage();
    expect(
      await screen.findByText(/Vertragswechsel in diesem Monat: Mira Sommer\./),
    ).toBeInTheDocument();
  });

  it("shows the time export with its fixed columns", async () => {
    navigation.params = new URLSearchParams("tab=zeitexport");
    api.downloadTimeFile.mockResolvedValue({
      blob: new Blob(["x"]),
      filename: null,
    });
    renderPage();
    const button = await screen.findByRole("button", {
      name: /CSV herunterladen/,
    });
    expect(api.fetchTimeReport).toHaveBeenCalledWith(2026, 8);
    await waitFor(() =>
      expect(button).not.toHaveAttribute("aria-disabled", "true"),
    );
    fireEvent.click(button);
    await waitFor(() =>
      expect(download.downloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        "zeitexport_2026-08.csv",
      ),
    );
    expect(screen.getByText("Spalten der Datei")).toBeInTheDocument();
  });

  it("clears the time report error once its retry succeeds", async () => {
    navigation.params = new URLSearchParams("tab=zeitexport");
    api.fetchTimeReport
      .mockRejectedValueOnce(
        new ApiError("down", 503, { code: "general.unavailable" }),
      )
      .mockResolvedValue(TIMES);
    renderPage();
    const retry = await screen.findByRole("button", {
      name: "Wiederholen",
    });
    fireEvent.click(retry);
    await waitFor(() => expect(api.fetchTimeReport).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Wiederholen" }),
      ).toBeNull(),
    );
    expect(
      await screen.findByRole("button", { name: /CSV herunterladen/ }),
    ).toBeInTheDocument();
  });

  it("saves only the changed Lohnarten and clears an emptied one", async () => {
    navigation.params = new URLSearchParams("tab=lohnarten");
    settingsApi.saveTraegerSettingValue.mockResolvedValue(undefined);
    settingsApi.clearTraegerSettingValue.mockResolvedValue(undefined);
    renderPage();
    const minijob = await screen.findByRole("textbox", {
      name: "Lohnart Regelarbeit bei Minijob",
    });
    expect(minijob).toHaveValue("200");
    fireEvent.change(minijob, { target: { value: "" } });
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Lohnart Regelarbeit bei Übungsleiter",
      }),
      { target: { value: "300" } },
    );
    const bar = screen.getByText("2 Änderungen").parentElement as HTMLElement;
    fireEvent.click(within(bar).getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(settingsApi.saveTraegerSettingValue).toHaveBeenCalledWith(
        "traeger_payroll.wage_type.regelarbeit.uebungsleiter",
        "300",
      ),
    );
    expect(settingsApi.clearTraegerSettingValue).toHaveBeenCalledWith(
      "traeger_payroll.wage_type.regelarbeit.minijob",
    );
    expect(settingsApi.saveTraegerSettingValue).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(schema.mutate).toHaveBeenCalled());
  });

  it("reloads the shown month after the Lohnarten are saved", async () => {
    navigation.params = new URLSearchParams("tab=lohnarten");
    settingsApi.saveTraegerSettingValue.mockResolvedValue(undefined);
    let revalidated: () => void = () => undefined;
    schema.mutate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          revalidated = resolve;
        }),
    );
    renderPage();
    fireEvent.change(
      await screen.findByRole("textbox", {
        name: "Lohnart Regelarbeit bei Übungsleiter",
      }),
      { target: { value: "300" } },
    );
    const bar = screen.getByText("1 Änderung").parentElement as HTMLElement;
    fireEvent.click(within(bar).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(schema.mutate).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Vorheriger Monat" }));
    await waitFor(() =>
      expect(api.fetchPayrollReport).toHaveBeenLastCalledWith(
        2026,
        7,
        "datev_lodas",
      ),
    );
    revalidated();
    await waitFor(() =>
      expect(api.fetchPayrollReport).toHaveBeenCalledTimes(3),
    );
    expect(api.fetchPayrollReport).toHaveBeenLastCalledWith(
      2026,
      7,
      "datev_lodas",
    );
  });

  it("refuses a Lohnart that is not 1 to 4 digits before it saves", async () => {
    navigation.params = new URLSearchParams("tab=lohnarten");
    renderPage();
    fireEvent.change(
      await screen.findByRole("textbox", {
        name: "Lohnart Urlaub bei Teilzeit",
      }),
      { target: { value: "12a" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("1 bis 4 Ziffern.")).toBeInTheDocument();
    expect(settingsApi.saveTraegerSettingValue).not.toHaveBeenCalled();
  });

  it("explains a Träger without the release instead of the export", async () => {
    api.fetchPayrollReport.mockRejectedValue(
      new ApiError("not released", 409, {
        code: "workforce.traeger_staff_not_released",
      }),
    );
    renderPage();
    expect(
      await screen.findByText(
        "Personal beim Träger ist noch nicht freigeschaltet.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Herunterladen/ })).toBeNull();
  });
});
