import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";

import type { ReactNode } from "react";
import { ApiError } from "~/lib/api-error";
import { SWRConfig } from "~/lib/swr/testing";
import type { PaymentOverviewRow } from "~/lib/guardian-payment-api";
import { releaseFakeTimers } from "~/test/clock";
import { catalogText } from "~/test/error-catalog-text";
import {
  DESKTOP_WIDTH,
  PHONE_WIDTH,
  setViewportWidth,
} from "~/test/helpers/viewport";

vi.unmock("swr");

function render(ui: ReactNode) {
  const cache = new Map();
  return rtlRender(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <SWRConfig value={{ provider: () => cache, errorRetryCount: 0 }}>
        {children}
      </SWRConfig>
    ),
  });
}

const mockFetchOverview = vi.fn();
const mockExport = vi.fn();
vi.mock("~/lib/guardian-payment-api", () => ({
  fetchPaymentOverview: () => mockFetchOverview(),
  exportPaymentOverview: (...args: unknown[]) => mockExport(...args),
}));

let mockPermissions: string[] = ["guardians:financial"];
let mockSessionStatus: "authenticated" | "loading" = "authenticated";
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "1", permissions: mockPermissions } },
    status: mockSessionStatus,
  }),
}));

const mockPush = vi.fn();
vi.mock("~/lib/tenant-router", () => ({
  useTenantRouter: () => ({ push: mockPush, replace: mockPush }),
}));

// Der Export-Dialog ist ein SlideOver; Vaul rendert in jsdom nichts.
vi.mock("vaul", () => import("~/test/mocks/vaul"));

// Load and export errors run through the real hooks (#2517, #4748).
vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    remove: vi.fn(),
  }),
}));

import BankverbindungenPage from "./page";
import { useSWRAuth } from "~/lib/swr";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";

function openExportDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Exportieren" }));
}

function row(overrides: Partial<PaymentOverviewRow>): PaymentOverviewRow {
  return {
    studentId: "1",
    studentName: "Mia Schneider",
    schoolClass: "1a",
    guardianId: "10",
    guardianName: "Sabine Schneider",
    relationshipType: "parent",
    accountHolder: "Sabine Schneider",
    ibanMasked: "•••• 3000",
    ...overrides,
  };
}

describe("BankverbindungenPage", () => {
  beforeEach(() => {
    mockPermissions = ["guardians:financial"];
    mockSessionStatus = "authenticated";
    mockFetchOverview.mockReset();
    mockExport.mockReset();
    mockFetchOverview.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("withdraws cached financial data after a 403 until an authorized read succeeds", async () => {
    let reload!: () => Promise<unknown>;
    function Probe() {
      const resource = useSWRAuth(
        tenantAdminKeys.paymentOverview(),
        mockFetchOverview,
      );
      reload = () => resource.mutate();
      return null;
    }
    mockFetchOverview.mockResolvedValue([row({})]);
    render(
      <>
        <BankverbindungenPage />
        <Probe />
      </>,
    );
    expect(await screen.findByText("Sabine Schneider")).toBeVisible();
    mockFetchOverview.mockRejectedValue(
      new ApiError("forbidden", 403, { code: "general.permission" }),
    );
    await act(async () => {
      await reload();
    });
    // Anker: die Ablehnung ersetzt die zuvor geladene Tabelle.
    expect(
      await screen.findByText(
        catalogText("general.permission", "die Liste der Bankverbindungen"),
      ),
    ).toBeVisible();
    expect(screen.queryByText("Sabine Schneider")).not.toBeInTheDocument();
    expect(screen.queryByText("•••• 3000")).not.toBeInTheDocument();
    mockFetchOverview.mockRejectedValue(new ApiError("offline", 503));
    await act(async () => {
      await reload();
    });
    expect(screen.queryByText("Sabine Schneider")).not.toBeInTheDocument();
    mockFetchOverview.mockResolvedValue([row({})]);
    await act(async () => {
      await reload();
    });
    expect(await screen.findByText("Sabine Schneider")).toBeVisible();
  });

  it("refuses the page without the bank permission", () => {
    mockPermissions = ["users:read", "users:update"];

    render(<BankverbindungenPage />);

    expect(
      screen.getByText("Kein Zugriff auf Bankverbindungen"),
    ).toBeInTheDocument();
    expect(mockFetchOverview).not.toHaveBeenCalled();
  });

  // DataTable renders only the layout for the window width (#6220): the
  // table at the default desktop width, the stacked list at phone width.
  afterEach(() => setViewportWidth(DESKTOP_WIDTH));
  const table = () => within(screen.getByTestId("data-table-table"));
  const stacked = () => within(screen.getByTestId("data-table-stacked"));
  // Die Suchzeile rendert die Auswahl einmal je Anordnung; CSS zeigt auf
  // jeder Breite genau eine. Unter der Desktop-Breite steht sie in ihrer
  // eigenen Zeile unter der Suche (#7132).
  const missingIbanChoice = (layout: "phone" | "desktop") => {
    const choice = screen
      .getAllByRole("button", { name: "Ohne IBAN (1)" })
      .find(
        (button) =>
          (button.closest('[data-testid="search-row-primary-action"]') !==
            null) ===
          (layout === "phone"),
      );
    if (!choice) throw new Error(`Keine Auswahl „Ohne IBAN“ (${layout})`);
    return choice;
  };

  it("shows children without bank details as a gap, not as a blank cell", async () => {
    mockFetchOverview.mockResolvedValue([
      row({}),
      row({
        studentId: "2",
        studentName: "Lea Wolf",
        guardianId: null,
        guardianName: "",
        accountHolder: "",
        ibanMasked: "",
      }),
    ]);

    render(<BankverbindungenPage />);

    await waitFor(() =>
      expect(table().getByText("Mia Schneider")).toBeInTheDocument(),
    );
    expect(table().getByText("Nicht zugeordnet")).toBeInTheDocument();
    expect(table().getByText("Fehlt")).toBeInTheDocument();
    expect(missingIbanChoice("desktop")).toBeInTheDocument();
    expect(missingIbanChoice("phone")).toBeInTheDocument();
  });

  it("narrows the list to the children still missing an IBAN", async () => {
    mockFetchOverview.mockResolvedValue([
      row({}),
      row({ studentId: "2", studentName: "Lea Wolf", ibanMasked: "" }),
    ]);

    render(<BankverbindungenPage />);
    await waitFor(() =>
      expect(table().getByText("Mia Schneider")).toBeInTheDocument(),
    );

    fireEvent.click(missingIbanChoice("desktop"));

    expect(table().queryByText("Mia Schneider")).not.toBeInTheDocument();
    expect(table().getByText("Lea Wolf")).toBeInTheDocument();
    expect(screen.queryByTestId("data-table-stacked")).not.toBeInTheDocument();
  });

  it("narrows the phone list to the children still missing an IBAN", async () => {
    setViewportWidth(PHONE_WIDTH);
    mockFetchOverview.mockResolvedValue([
      row({}),
      row({ studentId: "2", studentName: "Lea Wolf", ibanMasked: "" }),
    ]);

    render(<BankverbindungenPage />);
    await waitFor(() =>
      expect(stacked().getByText("Mia Schneider")).toBeInTheDocument(),
    );

    // Die Auswahl in der Telefon-Fassung der Suchzeile: Vorher gab es sie
    // nur auf dem Desktop (#7132).
    fireEvent.click(missingIbanChoice("phone"));

    expect(stacked().queryByText("Mia Schneider")).not.toBeInTheDocument();
    expect(stacked().getByText("Lea Wolf")).toBeInTheDocument();
    expect(screen.queryByTestId("data-table-table")).not.toBeInTheDocument();
  });

  it("downloads in the chosen format", async () => {
    mockFetchOverview.mockResolvedValue([row({})]);
    mockExport.mockResolvedValue(undefined);

    render(<BankverbindungenPage />);
    await waitFor(() =>
      expect(table().getByText("Mia Schneider")).toBeInTheDocument(),
    );

    openExportDialog();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Herunterladen" }));

    await waitFor(() => expect(mockExport).toHaveBeenCalledWith("pdf"));
  });

  it("prints the PDF in the tab opened from the dialog", async () => {
    const target = {} as Window;
    vi.spyOn(globalThis, "open").mockReturnValue(target);
    mockFetchOverview.mockResolvedValue([row({})]);
    mockExport.mockResolvedValue(undefined);

    render(<BankverbindungenPage />);
    await waitFor(() =>
      expect(table().getByText("Mia Schneider")).toBeInTheDocument(),
    );
    openExportDialog();
    fireEvent.click(screen.getByRole("button", { name: "Drucken" }));

    await waitFor(() => expect(mockExport).toHaveBeenCalledWith("pdf", target));
  });

  // The defect this layout exists to fix: in the table the IBAN is a fourth
  // column that a phone viewport cannot show.
  it("carries the IBAN as a labelled field in the stacked layout", async () => {
    setViewportWidth(PHONE_WIDTH);
    mockFetchOverview.mockResolvedValue([row({})]);

    render(<BankverbindungenPage />);
    await waitFor(() =>
      expect(stacked().getByText("Mia Schneider")).toBeInTheDocument(),
    );

    expect(stacked().getByText("IBAN")).toBeInTheDocument();
    expect(stacked().getByText("Kontoinhaber")).toBeInTheDocument();
    expect(stacked().getByText("•••• 3000")).toBeInTheDocument();
    expect(stacked().getByText("1a")).toBeInTheDocument();
  });

  it("reveals the rest of a long list on demand instead of rendering it all", async () => {
    setViewportWidth(PHONE_WIDTH);
    mockFetchOverview.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) =>
        row({ studentId: String(i), studentName: `Kind ${i}` }),
      ),
    );

    render(<BankverbindungenPage />);
    await waitFor(() =>
      expect(stacked().getByText("Kind 0")).toBeInTheDocument(),
    );

    // Rows render in the table's sort order (by name), so the tail of the
    // first page is "Kind 4" — "Kind 9" is on the second.
    expect(stacked().queryByText("Kind 9")).not.toBeInTheDocument();

    fireEvent.click(
      stacked().getByRole("button", { name: "Mehr laden (25 von 30)" }),
    );

    expect(stacked().getByText("Kind 9")).toBeInTheDocument();
  });

  it("warns that the downloaded file carries full IBANs", async () => {
    render(<BankverbindungenPage />);

    await waitFor(() =>
      expect(screen.getByText(/enthält die ganzen IBANs/)).toBeInTheDocument(),
    );
  });

  it("disables export until a non-empty list is available", async () => {
    let resolveOverview: (rows: PaymentOverviewRow[]) => void = () => undefined;
    mockFetchOverview.mockReturnValue(
      new Promise<PaymentOverviewRow[]>((resolve) => {
        resolveOverview = resolve;
      }),
    );

    render(<BankverbindungenPage />);

    const actions = screen.getByRole("button", { name: "Weitere Aktionen" });
    expect(actions).toBeDisabled();

    resolveOverview([]);
    expect(
      await screen.findAllByText("Noch keine Kinder in der Liste"),
    ).toHaveLength(1);
    // Gesperrt mit Grund (#6757): das Kebab bleibt fokussierbar und nennt,
    // warum es nichts zu exportieren gibt.
    expect(actions).toHaveAttribute("aria-disabled", "true");
    expect(actions).toHaveAccessibleDescription(
      "Es stehen noch keine Kinder in der Liste.",
    );
    fireEvent.click(actions);
    expect(actions).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps export available after a failed refetch with retained rows", async () => {
    mockFetchOverview
      .mockResolvedValueOnce([row({})])
      .mockRejectedValueOnce(
        new ApiError("down", 503, { code: "general.unavailable" }),
      );

    // The session switch below refetches once the shared reader's
    // deduplication window has passed.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { rerender } = render(<BankverbindungenPage />);
    await waitFor(() =>
      expect(table().getByText("Mia Schneider")).toBeInTheDocument(),
    );
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    releaseFakeTimers();

    mockSessionStatus = "loading";
    rerender(<BankverbindungenPage />);
    mockSessionStatus = "authenticated";
    rerender(<BankverbindungenPage />);

    await waitFor(() => expect(mockFetchOverview).toHaveBeenCalledTimes(2));
    expect(table().getByText("Mia Schneider")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Weitere Aktionen" }),
    ).toBeEnabled();

    openExportDialog();
    expect(
      screen.getByRole("heading", { name: "Bankverbindungen exportieren" }),
    ).toBeInTheDocument();
  });

  // #2517: a failed load replaces the list, never "Noch keine Kinder".
  it("shows a failed load instead of the empty list and retries", async () => {
    mockFetchOverview
      .mockRejectedValueOnce(
        new ApiError("down", 503, { code: "general.unavailable" }),
      )
      .mockResolvedValueOnce([row({})]);

    render(<BankverbindungenPage />);

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Liste der Bankverbindungen"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Noch keine Kinder in der Liste"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Weitere Aktionen" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));

    await waitFor(() =>
      expect(table().getByText("Mia Schneider")).toBeInTheDocument(),
    );
  });

  // #4748: der Export läuft über den gemeinsamen Export-Dialog; ein Fehler
  // bleibt dort stehen, mit Katalogtext und Wiederholen.
  it("keeps a failed download in the export dialog", async () => {
    mockFetchOverview.mockResolvedValue([row({})]);
    mockExport
      .mockRejectedValueOnce(
        new ApiError("boom", 500, { code: "general.server" }),
      )
      .mockResolvedValueOnce(undefined);

    render(<BankverbindungenPage />);
    await waitFor(() =>
      expect(table().getByText("Mia Schneider")).toBeInTheDocument(),
    );
    openExportDialog();
    fireEvent.click(screen.getByRole("button", { name: "Herunterladen" }));

    const message = catalogText(
      "general.server",
      "das Herunterladen der Bankverbindungen",
    );
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toContainElement(
      screen.getByText(message),
    );
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() => expect(mockExport).toHaveBeenCalledTimes(2));
    expect(mockExport).toHaveBeenLastCalledWith("xlsx");
  });
});
