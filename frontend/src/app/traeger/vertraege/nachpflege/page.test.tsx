import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { ApiError } from "~/lib/api-error";
import type {
  ContractCorrectionRow,
  ContractCorrectionRun,
} from "~/lib/traeger-contract-correction-api";
import TraegerContractCorrectionPage from "./page";

const api = vi.hoisted(() => ({
  previewContractCorrections: vi.fn(),
  applyContractCorrections: vi.fn(),
  fetchContractCorrectionLog: vi.fn(),
  downloadContractCorrectionList: vi.fn(),
}));
vi.mock("~/lib/traeger-contract-correction-api", async (original) => ({
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
vi.mock("~/lib/auth-utils", () => ({ hasPermission: () => true }));
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));
vi.mock("~/lib/traeger-api", () => ({
  fetchTraegerBuero: () => Promise.resolve({ members: [] }),
}));
vi.mock("~/components/ui/tenant-page", () => ({
  TenantPage: ({
    children,
    overlays,
  }: {
    children: ReactNode;
    overlays?: ReactNode;
  }) => (
    <>
      {children}
      {overlays}
    </>
  ),
}));

const BEFORE = {
  parties: ["Eva Beispiel"],
  method: "papier",
  concludedOn: "2026-03-12",
  dateUnknown: false,
} as const;

function row(
  line: number,
  overrides: Partial<ContractCorrectionRow> = {},
): ContractCorrectionRow {
  return {
    line,
    status: "unchanged",
    contractId: String(line),
    childName: "Mia Beispiel",
    schoolName: "Grundschule Nord",
    changes: [],
    before: BEFORE,
    after: BEFORE,
    evidence: "",
    problems: [],
    repeatsLine: null,
    ...overrides,
  };
}

function preview(
  overrides: Partial<ContractCorrectionRun> = {},
): ContractCorrectionRun {
  return {
    encoding: "utf-8",
    delimiter: ";",
    headers: ["Vertrag-ID", "Kind", "Beleg"],
    missing: [],
    fingerprint: "preview-1",
    applied: false,
    counts: { change: 1, unchanged: 1, invalid: 1, corrected: 0 },
    rows: [
      row(2, {
        status: "change",
        childName: "Ben Muster",
        changes: ["parties", "method", "concluded_on"],
        after: {
          parties: ["Eva Beispiel", "Jan Beispiel"],
          method: "einfach_elektronisch",
          concludedOn: null,
          dateUnknown: true,
        },
        evidence: "Vertrag-Muster.pdf",
      }),
      row(3),
      row(4, {
        status: "invalid",
        childName: "Lea Fehler",
        problems: [{ field: "contract_id", code: "not_imported" }],
      }),
    ],
    ...overrides,
  };
}

async function upload(result = preview()) {
  api.previewContractCorrections.mockResolvedValueOnce(result);
  render(
    <TraegerResourceTestProvider>
      <TraegerContractCorrectionPage />
    </TraegerResourceTestProvider>,
  );
  fireEvent.change(screen.getByLabelText("Datei wählen"), {
    target: {
      files: [new File(["Vertrag-ID;Kind"], "liste.csv", { type: "text/csv" })],
    },
  });
}

describe("Vertragsangaben nachpflegen", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.fetchContractCorrectionLog.mockResolvedValue([]);
  });

  it("shows every change as old and new and changes the confirmed preview", async () => {
    await upload();
    await screen.findByRole("heading", { name: "Prüfen und ändern" });
    // The preview reads the file alone; only the change names a preview.
    expect(api.previewContractCorrections).toHaveBeenCalledWith({
      file: expect.objectContaining({ name: "liste.csv" }),
    });
    // The counts of the file.
    expect(screen.getByText("Werden geändert")).toBeInTheDocument();
    // Tile and the status of row 3.
    expect(screen.getAllByText("Bereits aktuell")).toHaveLength(2);
    expect(screen.getByText("Mit Fehler")).toBeInTheDocument();
    // Old struck through, new emphasized; an unknown day is no date.
    expect(screen.getAllByText("12.03.2026")[0]?.tagName).toBe("DEL");
    expect(screen.getAllByText("Unbekannt")[0]?.tagName).toBe("INS");
    expect(screen.getAllByText("Papier")[0]?.tagName).toBe("DEL");
    expect(screen.getAllByText("Online")[0]?.tagName).toBe("INS");
    expect(
      screen.getAllByText("Jan Beispiel")[0]?.closest("ins"),
    ).not.toBeNull();
    // A problem stands in its column, as a sentence.
    expect(
      screen.getAllByText(
        "Dieser Vertrag kommt nicht aus einem Import. Seine Angaben stammen aus moto.",
      ).length,
    ).toBeGreaterThan(0);

    api.applyContractCorrections.mockResolvedValueOnce(
      preview({
        applied: true,
        counts: { change: 0, unchanged: 1, invalid: 1, corrected: 1 },
        rows: preview().rows.map((r) =>
          r.status === "change" ? { ...r, status: "corrected" as const } : r,
        ),
      }),
    );
    api.fetchContractCorrectionLog.mockResolvedValueOnce([
      {
        file: "liste.csv",
        accountId: "4",
        correctedAt: "2026-09-09T10:00:00Z",
        contracts: 1,
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "1 Vertrag ändern" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Vertragsangaben ändern?",
    });
    expect(
      within(dialog).getByText(/Es entsteht kein neuer Vertrag/),
    ).toBeInTheDocument();
    expect(api.applyContractCorrections).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "1 Vertrag ändern" }),
    );

    await screen.findByRole("heading", { name: "Ergebnis" });
    expect(api.applyContractCorrections).toHaveBeenCalledWith(
      expect.objectContaining({ fingerprint: "preview-1" }),
    );
    expect(screen.getAllByText("Geändert").length).toBeGreaterThan(0);
    expect(await screen.findAllByText("liste.csv")).not.toHaveLength(0);
  });

  it("names the columns the file lacks and shows no rows", async () => {
    await upload(
      preview({
        missing: ["contract_id", "evidence"],
        fingerprint: "",
        counts: { change: 0, unchanged: 0, invalid: 0, corrected: 0 },
        rows: [],
      }),
    );
    expect(
      await screen.findByText(
        /Es fehlen die Spalten „Vertrag-ID“ und „Beleg“\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Prüfen und ändern" }),
    ).not.toBeInTheDocument();
  });

  it("blocks the change with a reason when no row changes anything", async () => {
    await upload(
      preview({
        counts: { change: 0, unchanged: 1, invalid: 0, corrected: 0 },
        rows: [row(2)],
      }),
    );
    expect(
      await screen.findByRole("button", { name: "0 Verträge ändern" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("Alle Verträge der Liste sind schon aktuell."),
    ).toBeInTheDocument();
  });

  it("reads the list again when the contracts changed since the preview", async () => {
    await upload();
    await screen.findByRole("heading", { name: "Prüfen und ändern" });
    api.applyContractCorrections.mockRejectedValueOnce(
      new ApiError("Request failed (409)", 409, {
        code: "care_contract.import_changed",
      }),
    );
    api.previewContractCorrections.mockResolvedValueOnce(
      preview({ fingerprint: "preview-2" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "1 Vertrag ändern" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Vertragsangaben ändern?",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "1 Vertrag ändern" }),
    );
    await waitFor(() =>
      expect(api.previewContractCorrections).toHaveBeenCalledTimes(2),
    );
    expect(
      screen.getByRole("heading", { name: "Prüfen und ändern" }),
    ).toBeInTheDocument();
  });
});
