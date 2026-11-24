import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { ApiError } from "~/lib/api-error";
import type {
  OfferingCorrectionContract,
  OfferingCorrectionResult,
} from "~/lib/traeger-offering-correction-api";
import { firstOfNextMonth } from "~/components/traeger/care-contract-offering-correction-format";
import { TEST_CLOCK_TODAY, testClockDay } from "~/test/clock";
import TraegerOfferingCorrectionPage from "./page";

const LATER_DAY = testClockDay(90);

const api = vi.hoisted(() => ({
  previewOfferingCorrection: vi.fn(),
  applyOfferingCorrection: vi.fn(),
}));
vi.mock("~/lib/traeger-offering-correction-api", async (original) => ({
  ...(await original<object>()),
  ...api,
}));
vi.unmock("swr");
vi.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => ({
    data: { user: { id: "A", scope: "org", orgId: "7" } },
  }),
}));
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));
vi.mock("~/lib/traeger-api", () => ({
  fetchTraegerBuero: () => Promise.resolve({ members: [] }),
}));
vi.mock("~/components/ui/tenant-page", () => ({
  TenantPage: ({ children }: { children: ReactNode }) => children,
}));
// The calendar is the kit's; the page only reacts to a chosen day.
vi.mock("~/components/ui/date-picker", () => ({
  ISODatePicker: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <button
      type="button"
      aria-label={label}
      onClick={() => onChange(LATER_DAY)}
    >
      {value}
    </button>
  ),
}));

function contract(
  overrides: Partial<OfferingCorrectionContract> = {},
): OfferingCorrectionContract {
  return {
    reference: "41",
    line: 2,
    contractId: "41",
    schoolName: "Grundschule Nord",
    childFirstName: "Mia",
    childLastName: "Beispiel",
    status: "ready",
    effectiveFrom: "2026-10-01",
    versionNumber: 2,
    changes: [
      {
        weekdays: ["mon", "tue", "wed", "thu"],
        from: "OGS 4 Tage",
        to: "OGS Regelschule",
      },
    ],
    problems: [],
    hints: [],
    ...overrides,
  };
}

function preview(
  overrides: Partial<OfferingCorrectionResult> = {},
): OfferingCorrectionResult {
  return {
    encoding: "utf-8",
    delimiter: ";",
    headers: ["Vertrag", "Wochentag", "Bisheriges_Modul", "Neues_Modul"],
    missingColumns: [],
    effectiveFrom: "2026-10-01",
    fingerprint: "preview-1",
    applied: false,
    counts: { ready: 1, unchanged: 0, held: 1, invalid: 0, corrected: 0 },
    contracts: [
      contract(),
      contract({
        reference: "57",
        line: 4,
        contractId: "57",
        childFirstName: "Ben",
        status: "held",
        changes: [{ weekdays: ["fri"], from: "Freitag kurz", to: "" }],
      }),
    ],
    ...overrides,
  };
}

async function choose(result = preview()) {
  api.previewOfferingCorrection.mockResolvedValueOnce(result);
  render(
    <TraegerResourceTestProvider>
      <TraegerOfferingCorrectionPage />
    </TraegerResourceTestProvider>,
  );
  fireEvent.change(screen.getByLabelText("Datei wählen"), {
    target: {
      files: [
        new File(["Vertrag;Wochentag"], "module.csv", { type: "text/csv" }),
      ],
    },
  });
  await waitFor(() =>
    expect(api.previewOfferingCorrection).toHaveBeenCalledTimes(1),
  );
}

describe("Module neu zuordnen", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows each contract with its change and applies the confirmed preview", async () => {
    await choose();
    await screen.findByRole("heading", { name: "Prüfen und ändern" });
    // The first of next month is the proposed day.
    expect(api.previewOfferingCorrection).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveFrom: firstOfNextMonth(TEST_CLOCK_TODAY),
      }),
    );
    expect(screen.getAllByText("OGS Regelschule").length).toBeGreaterThan(0);
    expect(screen.getAllByText("noch offen").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Zurückgestellt 1" }),
    ).toBeInTheDocument();

    api.applyOfferingCorrection.mockResolvedValueOnce(
      preview({
        applied: true,
        counts: { ready: 0, unchanged: 0, held: 1, invalid: 0, corrected: 1 },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "1 Vertrag ändern" }));
    // moto asks first; nothing is sent before the confirmation.
    expect(
      await screen.findByText("Eltern bekommen keine Nachricht."),
    ).toBeInTheDocument();
    expect(api.applyOfferingCorrection).not.toHaveBeenCalled();
    const confirm = screen.getAllByRole("button", { name: "1 Vertrag ändern" });
    fireEvent.click(confirm[confirm.length - 1]!);

    await screen.findByText("1 Vertrag geändert");
    expect(api.applyOfferingCorrection).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: "preview-1",
        effectiveFrom: "2026-10-01",
      }),
    );
    expect(
      screen.getByText(/Unverändert: 1 zurückgestellt\./),
    ).toBeInTheDocument();
  });

  it("names the columns the file lacks instead of a preview", async () => {
    await choose(
      preview({
        missingColumns: ["target_offering"],
        fingerprint: "",
        contracts: [],
        counts: { ready: 0, unchanged: 0, held: 0, invalid: 0, corrected: 0 },
      }),
    );
    expect(
      await screen.findByText("In der Datei fehlen Spalten"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Neues Modul: Überschrift „Neues_Modul“"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Prüfen und ändern" }),
    ).not.toBeInTheDocument();
  });

  it("checks the file again for a new day", async () => {
    await choose();
    await screen.findByRole("heading", { name: "Prüfen und ändern" });
    api.previewOfferingCorrection.mockResolvedValueOnce(
      preview({ effectiveFrom: LATER_DAY }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Gilt ab" }));
    await waitFor(() =>
      expect(api.previewOfferingCorrection).toHaveBeenLastCalledWith(
        expect.objectContaining({ effectiveFrom: LATER_DAY }),
      ),
    );
  });

  it("reads the file again when a contract changed before the correction", async () => {
    await choose();
    await screen.findByRole("heading", { name: "Prüfen und ändern" });
    api.applyOfferingCorrection.mockRejectedValueOnce(
      new ApiError("Request failed (409)", 409, {
        code: "care_contract.import_changed",
      }),
    );
    api.previewOfferingCorrection.mockResolvedValueOnce(
      preview({ fingerprint: "preview-2" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "1 Vertrag ändern" }));
    await screen.findByText("Eltern bekommen keine Nachricht.");
    const confirm = screen.getAllByRole("button", { name: "1 Vertrag ändern" });
    fireEvent.click(confirm[confirm.length - 1]!);
    await waitFor(() =>
      expect(api.previewOfferingCorrection).toHaveBeenCalledTimes(2),
    );
  });
});
