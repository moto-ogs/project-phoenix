import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { ApiError } from "~/lib/api-error";
import type {
  FamilyImportResult,
  FamilyImportRow,
} from "~/lib/traeger-family-children-import-api";
import TraegerKinderzahlImportPage from "./page";

const api = vi.hoisted(() => ({
  previewFamilyChildrenImport: vi.fn(),
  applyFamilyChildrenImport: vi.fn(),
}));
vi.mock("~/lib/traeger-family-children-import-api", async (original) => ({
  ...(await original<object>()),
  ...api,
}));
vi.unmock("swr");
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));
vi.mock("~/components/ui/tenant-page", () => ({
  TenantPage: ({ children }: { children: ReactNode }) => children,
}));

function row(
  line: number,
  overrides: Partial<FamilyImportRow> = {},
): FamilyImportRow {
  return {
    line,
    status: "ready",
    childFirstName: "Mia",
    childLastName: "Beispiel",
    childBirthDate: null,
    schoolName: "Grundschule Birkenfeld",
    children: 2,
    contractId: "31",
    validFrom: "2026-08-01",
    confirmedChildren: null,
    problems: [],
    repeatsLine: null,
    ...overrides,
  };
}

function preview(
  overrides: Partial<FamilyImportResult> = {},
): FamilyImportResult {
  return {
    encoding: "windows-1252",
    delimiter: ";",
    headers: ["Vorname", "Nachname", "Anzahl Kinder"],
    mapping: {
      columns: {
        child_first_name: "Vorname",
        child_last_name: "Nachname",
        child_birth_date: "",
        school: "",
        children: "Anzahl Kinder",
        valid_from: "",
      },
      schoolId: "1",
      validFrom: "2026-08-01",
    },
    unmapped: [],
    schools: [
      { id: "1", name: "Grundschule Birkenfeld" },
      { id: "2", name: "Grundschule Ispringen" },
    ],
    fingerprint: "preview-1",
    applied: false,
    counts: {
      ready: 1,
      same: 0,
      differs: 1,
      conflict: 0,
      invalid: 1,
      imported: 0,
    },
    rows: [
      row(2),
      row(3, {
        status: "differs",
        childFirstName: "Noah",
        children: 3,
        confirmedChildren: 2,
      }),
      row(4, {
        status: "invalid",
        childFirstName: "Lea",
        contractId: null,
        validFrom: null,
        problems: [{ field: "child_last_name", code: "no_contract" }],
      }),
    ],
    ...overrides,
  };
}

async function choose(result = preview()) {
  api.previewFamilyChildrenImport.mockResolvedValueOnce(result);
  render(
    <TraegerResourceTestProvider>
      <TraegerKinderzahlImportPage />
    </TraegerResourceTestProvider>,
  );
  fireEvent.change(screen.getByLabelText("Datei wählen"), {
    target: {
      files: [
        new File(["Vorname;Nachname"], "kinderzahl.csv", { type: "text/csv" }),
      ],
    },
  });
  await screen.findByRole("heading", { name: "Spalten zuordnen" });
}

describe("Kinderzahl nachtragen", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows every row with what moto does and takes over the confirmed preview", async () => {
    await choose();
    expect(api.previewFamilyChildrenImport).toHaveBeenCalledWith(
      expect.objectContaining({ mapping: null }),
    );
    expect(screen.getAllByText("Mia Beispiel").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ab 01.08.2026").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Bestätigt sind 2 Kinder. moto ändert die Zahl nicht. Ändere sie in der Liste.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "moto findet an dieser Schule keinen Vertrag für das Kind. Prüfe Name und Schule.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/2 Zeilen bleiben draußen/)).toBeInTheDocument();

    api.applyFamilyChildrenImport.mockResolvedValueOnce(
      preview({
        applied: true,
        counts: { ...preview().counts, ready: 0, imported: 1 },
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "1 Kinderzahl übernehmen" }),
    );
    await screen.findByText("1 Kinderzahl übernommen");
    expect(api.applyFamilyChildrenImport).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: "preview-1",
        mapping: preview().mapping,
      }),
    );
    expect(
      screen.getByRole("link", { name: "Zur Kinderzahl" }),
    ).toHaveAttribute("href", "/traeger/abrechnung/kinderzahl");
  });

  it("asks for the school of a file without that column", async () => {
    await choose(
      preview({
        mapping: { ...preview().mapping, schoolId: "" },
        unmapped: ["school"],
        fingerprint: "",
        rows: [],
        counts: { ...preview().counts, ready: 0, differs: 0, invalid: 0 },
      }),
    );
    expect(
      screen.getByText("Bitte eine Spalte oder eine Schule wählen."),
    ).toBeInTheDocument();
    // Anker: the mapping is on screen, so the preview could show.
    expect(
      screen.queryByRole("heading", { name: "Prüfen und übernehmen" }),
    ).not.toBeInTheDocument();

    api.previewFamilyChildrenImport.mockResolvedValueOnce(preview());
    fireEvent.click(
      screen.getByRole("combobox", { name: /Schule für alle Zeilen/ }),
    );
    fireEvent.click(
      screen.getByRole("option", { name: "Grundschule Birkenfeld" }),
    );
    await screen.findByRole("heading", { name: "Prüfen und übernehmen" });
    expect(api.previewFamilyChildrenImport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mapping: expect.objectContaining({ schoolId: "1" }),
      }),
    );
  });

  it("distinguishes stored confirmations from conflicting file rows", async () => {
    await choose(
      preview({
        counts: {
          ready: 0,
          same: 0,
          differs: 0,
          conflict: 2,
          invalid: 0,
          imported: 0,
        },
        rows: [
          row(2, {
            status: "conflict",
            problems: [{ field: "children", code: "confirmations_differ" }],
          }),
          row(3, {
            status: "conflict",
            childFirstName: "Noah",
            problems: [{ field: "children", code: "rows_differ" }],
          }),
        ],
      }),
    );
    expect(screen.getAllByText("Verschiedene Angaben").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getAllByText("Widerspruch in der Datei").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Für diese Familie sind verschiedene Kinderzahlen bestätigt. Bestätige die Kinderzahl in der Familienliste.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "2 Zeilen bleiben draußen. Prüfe den Hinweis bei jeder offenen Zeile.",
      ),
    ).toBeInTheDocument();
  });

  it("reads the file again when the preview changed before the import", async () => {
    await choose();
    api.applyFamilyChildrenImport.mockRejectedValueOnce(
      new ApiError("Request failed (409)", 409, {
        code: "parent_billing.family_children_import_changed",
      }),
    );
    api.previewFamilyChildrenImport.mockResolvedValueOnce(
      preview({ fingerprint: "preview-2" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "1 Kinderzahl übernehmen" }),
    );
    await vi.waitFor(() =>
      expect(api.previewFamilyChildrenImport).toHaveBeenCalledTimes(2),
    );
    expect(api.previewFamilyChildrenImport).toHaveBeenLastCalledWith(
      expect.objectContaining({ mapping: preview().mapping }),
    );
  });
});
