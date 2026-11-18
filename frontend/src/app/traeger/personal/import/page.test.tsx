import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { ApiError } from "~/lib/api-error";
import type {
  StaffImportResult,
  StaffImportRow,
} from "~/lib/traeger-staff-import-api";
import TraegerStaffImportPage from "./page";

vi.unmock("swr");

const api = vi.hoisted(() => ({
  previewStaffImport: vi.fn(),
  applyStaffImport: vi.fn(),
  fetchStaffImportLog: vi.fn(),
}));
vi.mock("~/lib/traeger-staff-import-api", async (original) => ({
  ...(await original<object>()),
  ...api,
}));
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));
vi.mock("~/components/ui/tenant-page", () => ({
  TenantPage: ({
    children,
    actions,
  }: {
    children: ReactNode;
    actions?: ReactNode;
  }) => (
    <>
      {actions}
      {children}
    </>
  ),
}));

function row(overrides: Partial<StaffImportRow>): StaffImportRow {
  return {
    line: 2,
    status: "new",
    personnelNumber: "70031",
    firstName: "Mira",
    lastName: "Sommer",
    birthday: "",
    ibanMasked: "",
    taxIdMasked: "",
    socialSecurityNumberMasked: "",
    recordId: null,
    completes: [],
    problems: [],
    ...overrides,
  };
}

const preview: StaffImportResult = {
  encoding: "utf-8",
  delimiter: ";",
  headers: ["Pers.-Nr.", "Vorname", "Nachname", "IBAN"],
  mapping: {
    columns: {
      personnel_number: "Pers.-Nr.",
      first_name: "Vorname",
      last_name: "Nachname",
      birthday: "",
      iban: "IBAN",
      tax_id: "",
      social_security_number: "",
    },
  },
  unmapped: [],
  fingerprint: "preview-1",
  applied: false,
  counts: {
    new: 1,
    complete: 1,
    duplicate: 0,
    conflict: 1,
    invalid: 0,
    imported: 0,
  },
  rows: [
    row({ ibanMasked: "•••• 3000" }),
    row({
      line: 3,
      status: "complete",
      personnelNumber: "70014",
      firstName: "Elif",
      lastName: "Arslan",
      completes: ["iban"],
      recordId: "7",
    }),
    row({
      line: 4,
      status: "conflict",
      personnelNumber: "70005",
      firstName: "Svenja",
      lastName: "Fischer-Lang",
      problems: [{ field: "last_name", code: "differs" }],
    }),
  ],
};

async function choose() {
  api.previewStaffImport.mockResolvedValueOnce(preview);
  render(
    <TraegerResourceTestProvider>
      <TraegerStaffImportPage />
    </TraegerResourceTestProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Datei wählen" })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText("Datei wählen"), {
    target: {
      files: [
        new File(["Pers.-Nr.;Vorname;Nachname"], "personal.csv", {
          type: "text/csv",
        }),
      ],
    },
  });
  await screen.findByRole("heading", { name: "Prüfen und übernehmen" });
}

describe("TraegerStaffImportPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchStaffImportLog.mockResolvedValue([]);
  });

  it("names what moto does with each row and why a row stays out", async () => {
    await choose();

    expect(screen.getByText("Trägt IBAN in die Akte ein.")).toBeInTheDocument();
    expect(
      screen.getByText("Nachname weicht von der Akte ab."),
    ).toBeInTheDocument();
    expect(screen.getByText("•••• 3000")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "2 Zeilen übernehmen" }),
    ).toBeEnabled();
  });

  it("imports exactly the confirmed preview and names what it created", async () => {
    await choose();
    api.applyStaffImport.mockResolvedValueOnce({
      ...preview,
      applied: true,
      counts: { ...preview.counts, new: 0, complete: 0, imported: 2 },
      rows: preview.rows.map((entry) =>
        entry.status === "conflict" ? entry : { ...entry, status: "imported" },
      ),
    });

    fireEvent.click(
      screen.getByRole("button", { name: "2 Zeilen übernehmen" }),
    );

    await screen.findByText("Übernommen: 1 neue Akte, 1 ergänzt");
    expect(api.applyStaffImport).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: "preview-1",
        mapping: preview.mapping,
      }),
    );
    expect(
      screen.getByRole("link", { name: "Zu den Personalakten" }),
    ).toHaveAttribute("href", "/traeger/personal");
  });

  it("reads the file again when the records changed since the preview", async () => {
    await choose();
    api.previewStaffImport.mockResolvedValueOnce(preview);
    api.applyStaffImport.mockRejectedValueOnce(
      new ApiError("changed", 409, {
        code: "workforce.traeger_staff_import_changed",
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "2 Zeilen übernehmen" }),
    );

    await waitFor(() =>
      expect(api.previewStaffImport).toHaveBeenCalledTimes(2),
    );
    expect(screen.queryByText(/^Übernommen:/)).not.toBeInTheDocument();
  });

  it("names who imported without reading the Träger-Büro", async () => {
    api.fetchStaffImportLog.mockResolvedValueOnce([
      {
        file: "lohn-november.csv",
        accountId: "8",
        byYou: false,
        accountName: "Ines Lindner",
        importedAt: "2026-11-15T09:30:00Z",
        created: 3,
        completed: 1,
      },
      {
        file: "lohn-oktober.csv",
        accountId: "7",
        byYou: true,
        accountName: "",
        importedAt: "2026-10-15T09:30:00Z",
        created: 5,
        completed: 0,
      },
    ]);
    render(
      <TraegerResourceTestProvider>
        <TraegerStaffImportPage />
      </TraegerResourceTestProvider>,
    );

    expect(await screen.findByText("Ines Lindner")).toBeInTheDocument();
    expect(screen.getByText("dir")).toBeInTheDocument();
  });

  it("explains the missing release instead of offering an import", async () => {
    api.fetchStaffImportLog.mockRejectedValueOnce(
      new ApiError("locked", 409, {
        code: "workforce.traeger_staff_not_released",
      }),
    );
    render(
      <TraegerResourceTestProvider>
        <TraegerStaffImportPage />
      </TraegerResourceTestProvider>,
    );

    await screen.findByText(
      "Personal beim Träger ist noch nicht freigeschaltet.",
    );
    expect(
      screen.queryByRole("button", { name: "Beispieldatei" }),
    ).not.toBeInTheDocument();
  });
});
