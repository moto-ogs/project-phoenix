import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { ApiError } from "~/lib/api-error";
import type {
  ContractImportResult,
  ContractImportRow,
} from "~/lib/traeger-care-contract-import-api";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { traegerContractKeys } from "~/lib/swr/traeger-contract-keys";
import TraegerContractImportPage from "./page";

const api = vi.hoisted(() => ({
  previewContractImport: vi.fn(),
  applyContractImport: vi.fn(),
  fetchContractImportLog: vi.fn(),
}));
vi.mock("~/lib/traeger-care-contract-import-api", async (original) => ({
  ...(await original<object>()),
  ...api,
}));
vi.unmock("swr");
vi.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => ({
    data: { user: { id: "A", scope: "org", orgId: 7 } },
  }),
}));
vi.mock("~/lib/auth-utils", () => ({ hasPermission: () => true }));
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));
vi.mock("~/lib/traeger-api", () => ({
  fetchTraegerBuero: () => Promise.resolve({ members: [] }),
}));
vi.mock("~/components/ui/tenant-page", () => ({
  TenantPage: ({ children }: { children: ReactNode }) => children,
}));

function row(
  line: number,
  overrides: Partial<ContractImportRow> = {},
): ContractImportRow {
  return {
    line,
    status: "ready",
    childFirstName: "Mia",
    childLastName: "Beispiel",
    childBirthDate: "2018-05-03",
    schoolName: "Grundschule Nord",
    moduleNames: ["OGS bis 16 Uhr"],
    weekdays: ["mon", "tue", "wed", "thu"],
    effectiveFrom: "2026-08-01",
    endsOn: "2027-07-31",
    partyName: "Eva Beispiel",
    partyEmail: "eva.beispiel@example.org",
    problems: [],
    hints: [],
    contractId: null,
    repeatsLine: null,
    debtorNumber: "70001",
    debtorNumberStatus: "new",
    ...overrides,
  };
}

function preview(
  overrides: Partial<ContractImportResult> = {},
): ContractImportResult {
  return {
    encoding: "utf-8",
    delimiter: ";",
    headers: ["Vorname", "Nachname", "Beginn", "Zahler"],
    mapping: {
      columns: {
        child_first_name: "Vorname",
        child_last_name: "Nachname",
        child_birth_date: "",
        school: "",
        module: "",
        weekdays: "",
        effective_from: "Beginn",
        ends_on: "",
        concluded_on: "",
        party_first_name: "",
        party_last_name: "Zahler",
        party_email: "",
        debtor_number: "",
      },
      schoolId: "1",
      moduleName: "OGS bis 16 Uhr",
      effectiveFrom: "",
    },
    unmapped: [],
    schools: [
      {
        id: "1",
        name: "Grundschule Nord",
        modules: [
          { name: "OGS bis 16 Uhr", phaseName: "2026/27", hasConditions: true },
        ],
      },
      { id: "2", name: "Grundschule Süd", modules: [] },
    ],
    debtorNumberScope: "payer",
    fingerprint: "preview-1",
    applied: false,
    counts: {
      ready: 1,
      duplicate: 1,
      conflict: 0,
      invalid: 0,
      imported: 0,
      debtorNumbers: 1,
      debtorConflicts: 0,
    },
    rows: [
      row(2),
      row(3, {
        status: "duplicate",
        childFirstName: "Ben",
        contractId: "7",
        debtorNumber: "",
        debtorNumberStatus: "",
      }),
    ],
    ...overrides,
  };
}

async function choose(result = preview(), beside: ReactNode = null) {
  api.previewContractImport.mockResolvedValueOnce(result);
  render(
    <TraegerResourceTestProvider>
      <TraegerContractImportPage />
      {beside}
    </TraegerResourceTestProvider>,
  );
  fireEvent.change(screen.getByLabelText("Datei wählen"), {
    target: {
      files: [
        new File(["Vorname;Nachname"], "kinder.csv", { type: "text/csv" }),
      ],
    },
  });
  await screen.findByRole("heading", { name: "Spalten zuordnen" });
}

/** The contracts page's read of the children still waiting for a contract. */
function Candidates({ read }: { read: () => Promise<unknown> }) {
  useTraegerResource(traegerContractKeys.candidates(), read, "die Kinder");
  return null;
}

describe("Vertragsimport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.fetchContractImportLog.mockResolvedValue([]);
  });

  it("shows every row with what moto does and takes over the confirmed preview", async () => {
    await choose();
    expect(api.previewContractImport).toHaveBeenCalledWith(
      expect.objectContaining({ mapping: null }),
    );
    expect(screen.getAllByText("Mia Beispiel").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Debitorennummer 70001 wird eingetragen.").length,
    ).toBeGreaterThan(0);
    // Anker: the preview with its rows is on screen.
    expect(
      screen.getAllByText("Das Kind hat an dieser Schule schon einen Vertrag.")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/ohne Mail-Adresse$/)).not.toBeInTheDocument();

    const applied = preview({
      applied: true,
      counts: { ...preview().counts, ready: 0, imported: 1 },
    });
    api.applyContractImport.mockResolvedValueOnce(applied);
    api.fetchContractImportLog.mockResolvedValueOnce([
      {
        file: "kinder.csv",
        accountId: "4",
        importedAt: "2026-09-09T10:00:00Z",
        contracts: 1,
      },
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: "1 Vertrag übernehmen" }),
    );
    await screen.findByText("1 Vertrag übernommen");
    expect(api.applyContractImport).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: "preview-1",
        mapping: preview().mapping,
      }),
    );
    expect(
      screen.getByText(/1 schon vorhanden, 0 nicht übernommen/),
    ).toBeInTheDocument();
    expect(await screen.findAllByText("kinder.csv")).not.toHaveLength(0);
  });

  it("reads the children without a contract again after the import", async () => {
    const readCandidates = vi.fn().mockResolvedValue([]);
    await choose(preview(), <Candidates read={readCandidates} />);
    await waitFor(() => expect(readCandidates).toHaveBeenCalledOnce());
    api.applyContractImport.mockResolvedValueOnce(
      preview({
        applied: true,
        counts: { ...preview().counts, ready: 0, imported: 1 },
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "1 Vertrag übernehmen" }),
    );
    await screen.findByText("1 Vertrag übernommen");

    await waitFor(() => expect(readCandidates).toHaveBeenCalledTimes(2));
  });

  it("asks for the school and the module of a file without those columns", async () => {
    await choose(
      preview({
        mapping: { ...preview().mapping, schoolId: "", moduleName: "" },
        unmapped: ["school", "module"],
        fingerprint: "",
        rows: [],
        counts: { ...preview().counts, ready: 0, duplicate: 0 },
      }),
    );
    expect(
      screen.getByText("Bitte eine Spalte oder eine Schule wählen."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Ordnen Sie alle Pflichtfelder zu. Dann zeigt moto die Zeilen.",
      ),
    ).toBeInTheDocument();
    // Anker: the mapping is on screen, so the preview could show.
    expect(
      screen.queryByRole("heading", { name: "Prüfen und übernehmen" }),
    ).not.toBeInTheDocument();

    api.previewContractImport.mockResolvedValueOnce(preview());
    fireEvent.click(
      screen.getByRole("combobox", { name: /Schule für alle Zeilen/ }),
    );
    fireEvent.click(screen.getByRole("option", { name: "Grundschule Nord" }));
    await screen.findByRole("heading", { name: "Prüfen und übernehmen" });
    expect(api.previewContractImport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mapping: expect.objectContaining({ schoolId: "1", moduleName: "" }),
      }),
    );
  });

  it("asks for the first day of a file without that column", async () => {
    const base = preview();
    await choose(
      preview({
        mapping: {
          ...base.mapping,
          columns: { ...base.mapping.columns, effective_from: "" },
        },
        unmapped: ["effective_from"],
        fingerprint: "",
        rows: [],
        counts: { ...base.counts, ready: 0, duplicate: 0 },
      }),
    );
    expect(
      screen.getByText("Vertragsbeginn für alle Zeilen"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Bitte eine Spalte oder einen Tag wählen."),
    ).toBeInTheDocument();
  });

  it("names missing contract conditions as the step that comes first", async () => {
    await choose(
      preview({
        counts: { ...preview().counts, ready: 0, duplicate: 0, invalid: 1 },
        rows: [
          row(2, {
            status: "invalid",
            problems: [{ field: "module", code: "conditions_missing" }],
            debtorNumber: "",
            debtorNumberStatus: "",
          }),
        ],
      }),
    );
    expect(
      screen.getByText("Zuerst die Vertragsbedingungen eintragen"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Zu den Vertragsbedingungen" }),
    ).toHaveAttribute("href", "/traeger/vertraege/bedingungen");
    // Blocked with a reason: nothing is ready.
    expect(
      screen.getByRole("button", { name: "0 Verträge übernehmen" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("warns about contracts without a parent's address and still takes them over", async () => {
    const base = preview();
    const withoutEmail = preview({
      mapping: {
        ...base.mapping,
        columns: { ...base.mapping.columns, party_email: "E-Mail" },
      },
      counts: { ...base.counts, ready: 4, duplicate: 1 },
      rows: [
        row(2),
        row(3, { childFirstName: "Ben", partyEmail: "" }),
        row(4, {
          childFirstName: "Lea",
          partyName: "Jan Beispiel",
          partyEmail: "",
        }),
        // No parent at all: its own hint, not counted as a family without mail.
        row(6, {
          childFirstName: "Ole",
          partyName: "",
          partyEmail: "",
          hints: ["no_party"],
        }),
        // Left out: no contract, so no family without mail.
        row(5, {
          status: "duplicate",
          childFirstName: "Tom",
          partyEmail: "",
          debtorNumberStatus: "",
        }),
      ],
    });
    await choose(withoutEmail);

    expect(
      screen.getByText("2 Verträge ohne Mail-Adresse"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Keine Mail von moto. Rechnungen gibt es nur auf Papier.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Kein Zugang zur Eltern-App.")).toBeInTheDocument();
    expect(
      screen.getByText("Geschwister bleiben getrennte Familien."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Haben Sie die Adressen? Dann tragen Sie sie in die Datei ein. Laden Sie die Datei danach noch einmal.",
      ),
    ).toBeInTheDocument();
    // A warning, not a block: every ready row is taken over.
    expect(
      screen.getByRole("button", { name: "4 Verträge übernehmen" }),
    ).not.toHaveAttribute("aria-disabled", "true");

    const onlyWithout = screen.getByRole("button", {
      name: "Ohne Mail 2",
    });
    fireEvent.click(onlyWithout);
    expect(onlyWithout).toHaveAttribute("aria-pressed", "true");
    // Anker: the filter shows a row without an address.
    expect(screen.getAllByText("Ben Beispiel").length).toBeGreaterThan(0);
    expect(screen.queryByText("Mia Beispiel")).not.toBeInTheDocument();
    expect(screen.queryByText("Tom Beispiel")).not.toBeInTheDocument();
    expect(screen.queryByText("Ole Beispiel")).not.toBeInTheDocument();

    api.applyContractImport.mockResolvedValueOnce({
      ...withoutEmail,
      applied: true,
      counts: { ...withoutEmail.counts, ready: 0, imported: 4 },
      rows: withoutEmail.rows.map((r) =>
        r.status === "ready" ? { ...r, status: "imported" as const } : r,
      ),
    });
    fireEvent.click(
      screen.getByRole("button", { name: "4 Verträge übernehmen" }),
    );
    await screen.findByText("4 Verträge übernommen");
    expect(
      screen.getByText(
        /2 Verträge ohne Mail-Adresse: Diesen Familien geben Sie die Rechnungen auf Papier\./,
      ),
    ).toBeInTheDocument();
  });

  it("points to the address column when no column is mapped to it", async () => {
    await choose(
      preview({
        counts: { ...preview().counts, ready: 1, duplicate: 0 },
        rows: [row(2, { partyEmail: "" })],
      }),
    );
    expect(screen.getByText("1 Vertrag ohne Mail-Adresse")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Hat Ihre Datei eine Spalte mit Mail-Adressen? Ordnen Sie sie oben bei „E-Mail der Eltern“ zu.",
      ),
    ).toBeInTheDocument();
  });

  it("reads the file again when the preview changed before the import", async () => {
    await choose();
    api.applyContractImport.mockRejectedValueOnce(
      new ApiError("Request failed (409)", 409, {
        code: "care_contract.import_changed",
      }),
    );
    api.previewContractImport.mockResolvedValueOnce(
      preview({ fingerprint: "preview-2" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "1 Vertrag übernehmen" }),
    );
    await waitFor(() =>
      expect(api.previewContractImport).toHaveBeenCalledTimes(2),
    );
    expect(
      screen.getByRole("heading", { name: "Prüfen und übernehmen" }),
    ).toBeInTheDocument();
  });
});
