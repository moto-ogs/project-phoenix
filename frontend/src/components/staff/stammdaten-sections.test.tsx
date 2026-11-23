import {
  fireEvent,
  render as renderUi,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "~/contexts/ToastContext";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { StammdatenTab } from "./stammdaten-tab";
import {
  staffPayrollNumberService,
  staffStammdatenService,
  type StaffStammdaten,
} from "~/lib/staff-api";

// The tab reports a failed reveal as a toast (#2511); the app mounts the
// provider globally.
function render(ui: ReactElement) {
  return renderUi(ui, { wrapper: ToastProvider });
}

// Section rendering + permission gating of the Stammdaten tab (#1423). The
// SWR mock switches on the cache key so the aggregate, payroll and financial
// requests can carry different fixtures.

const mutate = vi.hoisted(() => vi.fn());
const revealFinancial = vi.hoisted(() => vi.fn());
const swrData = vi.hoisted(() => ({
  current: new Map<string, unknown>(),
}));
const swrErrors = vi.hoisted(() => ({
  current: new Map<string, Error>(),
}));

// Reads whose reload fails: SWR's `mutate` still resolves (with the old
// data), only `revalidateOrThrow` rejects (ADR 0311, rule 6).
const failingReloads = vi.hoisted(() => ({
  current: new Map<string, Error>(),
}));

const { refreshMatching } = vi.hoisted(() => ({
  refreshMatching: vi.fn((_keys: readonly string[]) => Promise.resolve([])),
}));

vi.mock("~/lib/swr", () => ({
  useSWRAuth: (key: string | null) => ({
    data: [...swrData.current.entries()].find(([prefix]) =>
      key?.startsWith(prefix),
    )?.[1],
    error: [...swrErrors.current.entries()].find(([prefix]) =>
      key?.startsWith(prefix),
    )?.[1],
    isLoading: false,
    isValidating: false,
    mutate,
    key,
  }),
  useTenantMutateMatching:
    (keys: readonly string[]) => (): Promise<unknown[]> =>
      refreshMatching(keys),
  revalidateOrThrow: async (read: {
    mutate: () => Promise<unknown>;
    key: string | null;
  }) => {
    const answered = await read.mutate();
    const failure = [...failingReloads.current.entries()].find(([prefix]) =>
      read.key?.startsWith(prefix),
    )?.[1];
    if (failure) throw failure;
    return answered;
  },
}));

vi.mock("~/lib/staff-api", () => ({
  staffPayrollNumberService: { get: vi.fn(), update: vi.fn() },
  staffStammdatenService: {
    get: vi.fn(),
    getFinancial: vi.fn(),
    revealFinancial,
    updatePerson: vi.fn(),
    updateKontakt: vi.fn(),
    updateArbeitsvertrag: vi.fn(),
    updateQualifikationen: vi.fn(),
    updateFinancial: vi.fn(),
  },
}));

const stammdaten: StaffStammdaten = {
  staffId: "42",
  versions: {
    person: "v-person",
    kontakt: "v-kontakt",
    arbeitsvertrag: "v-vertrag",
    qualifikationen: "v-quali",
  },
  person: {
    firstName: "Mila",
    lastName: "Muster",
    birthday: "1990-04-12",
    gender: "female",
  },
  kontakt: {
    addressStreet: "Musterweg 1",
    addressPostalCode: "48143",
    addressCity: "Münster",
    phone: "+49 251 123456",
    email: "mila@example.com",
    emergencyContactName: "Erik Muster",
    emergencyContactPhone: "+49 170 1",
  },
  arbeitsvertrag: {
    entryDate: "2024-08-01",
    contractEndDate: null,
    probationEndDate: "2025-01-31",
    weeklyHours: 29.5,
    employmentType: "part_time",
  },
  qualifikationen: [
    {
      id: "1",
      typeId: null,
      name: "Erste-Hilfe-Kurs",
      acquiredOn: "2019-03-10",
      expiresOn: "2020-03-10",
    },
    {
      id: "2",
      typeId: null,
      name: "Schwimmschein",
      acquiredOn: null,
      expiresOn: null,
    },
  ],
};

function seedSWR({ financial = false, financialError = false } = {}) {
  failingReloads.current = new Map();
  swrData.current = new Map<string, unknown>([
    ["staff-stammdaten-financial-", financial ? maskedFinancial : undefined],
    ["staff-stammdaten-", stammdaten],
    [
      "staff-payroll-number-",
      { personnelNumber: "1023", keptByTraeger: false },
    ],
  ]);
  swrErrors.current = new Map(
    financialError
      ? [
          [
            "staff-stammdaten-financial-",
            new ApiError("boom", 503, {
              code: "general.unavailable",
              instance: "req-financial",
            }),
          ],
        ]
      : [],
  );
}

const maskedFinancial = {
  ibanMasked: "•••• 3000",
  taxIdMasked: "••••••••",
  socialSecurityNumberMasked: "••••••••",
  keptByTraeger: false,
};

describe("StammdatenTab Sektionen (#1423)", () => {
  it("zeigt Personalnummer und Bankdaten, die der Träger führt, nur zum Lesen (#4705)", () => {
    seedSWR();
    swrData.current.set("staff-payroll-number-", {
      personnelNumber: "70001",
      keptByTraeger: true,
    });
    swrData.current.set("staff-stammdaten-financial-", {
      ibanMasked: null,
      taxIdMasked: null,
      socialSecurityNumberMasked: null,
      keptByTraeger: true,
    });
    render(
      <StammdatenTab
        staffId="42"
        canManagePayroll
        canManagePayrollSettings={false}
        canViewSections
        canEditSections
        canViewFinancial
      />,
    );

    expect(screen.getByText("70001")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Diese Personalnummer führt der Träger in seiner Personalakte. Ändern kann sie die Personalverwaltung des Trägers.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Die Bank- und Steuerdaten führt der Träger in seiner Personalakte. Ändern kann sie die Personalverwaltung des Trägers.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Anzeigen/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    expect(screen.getByLabelText("Vorname")).toHaveValue("Mila");
    expect(screen.queryByLabelText("Personalnummer")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("IBAN")).not.toBeInTheDocument();
  });

  beforeEach(() => {
    mutate.mockReset();
    revealFinancial.mockReset();
    vi.mocked(staffStammdatenService.updatePerson).mockReset();
    swrErrors.current = new Map();
  });

  it("zeigt alle Sektionen mit Werten, aber ohne Bearbeiten-Buttons ohne staff:stammdaten", () => {
    seedSWR();
    render(
      <StammdatenTab
        staffId="42"
        canManagePayroll={false}
        canManagePayrollSettings={false}
        canViewSections
      />,
    );

    expect(screen.getByText("Person")).toBeInTheDocument();
    expect(screen.getByText("Mila")).toBeInTheDocument();
    expect(screen.getByText("12.04.1990")).toBeInTheDocument();
    expect(screen.getByText("Weiblich")).toBeInTheDocument();
    expect(screen.getByText("Musterweg 1, 48143 Münster")).toBeInTheDocument();
    expect(screen.getByText("Unbefristet")).toBeInTheDocument();
    expect(screen.getByText("29,5 Std.")).toBeInTheDocument();
    expect(screen.getByText("Teilzeit")).toBeInTheDocument();
    expect(screen.getByText("Erste-Hilfe-Kurs")).toBeInTheDocument();
    expect(screen.getByText("Abgelaufen")).toBeInTheDocument();

    expect(
      screen.queryByRole("button", { name: "Bearbeiten" }),
    ).not.toBeInTheDocument();
  });

  it("zeigt mit staff:stammdaten EIN Bearbeiten für den ganzen Reiter", () => {
    seedSWR();
    render(
      <StammdatenTab
        staffId="42"
        canManagePayroll={false}
        canManagePayrollSettings={false}
        canViewSections
        canEditSections
      />,
    );

    const editButtons = screen.getAllByRole("button", { name: "Bearbeiten" });
    expect(editButtons).toHaveLength(1);

    fireEvent.click(editButtons[0]!);
    // Alle Gruppen wechseln gemeinsam in den Bearbeiten-Zustand, mit genau
    // einem Speichern am Ende des Reiters.
    expect(screen.getByLabelText("Vorname")).toHaveValue("Mila");
    expect(screen.getByLabelText("Telefon")).toHaveValue("+49 251 123456");
    expect(screen.getAllByRole("button", { name: "Speichern" })).toHaveLength(
      1,
    );
  });

  it("überschreibt ein vorhandenes Geburtsdatum und sendet den ISO-Wert", async () => {
    seedSWR();
    render(
      <StammdatenTab
        staffId="42"
        canManagePayroll={false}
        canManagePayrollSettings={false}
        canViewSections
        canEditSections
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Bearbeiten" })[0]!);
    const birthdayInput = screen.getByLabelText("Geburtsdatum");
    expect(birthdayInput).toHaveValue("12.04.1990");

    fireEvent.change(birthdayInput, { target: { value: "17.04.1982" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(staffStammdatenService.updatePerson).toHaveBeenCalledWith(
        "42",
        expect.objectContaining({ birthday: "1982-04-17" }),
        "",
        "v-person",
      ),
    );
    // Name und Geschlecht stehen auch im Kopf und in der Personalliste.
    await waitFor(() =>
      expect(refreshMatching).toHaveBeenCalledWith(
        expect.arrayContaining(["staff-detail-42", "staff-record-42"]),
      ),
    );
  });

  it("meldet einen abgelehnten Abschnitt im Alert oben und markiert die Felder", async () => {
    seedSWR();
    vi.mocked(staffStammdatenService.updatePerson).mockRejectedValue(
      new ApiError("first_name: is required.", 400, {
        code: "general.input",
        errors: [{ field: "first_name", reason: "is required" }],
      }),
    );
    render(
      <StammdatenTab
        staffId="42"
        canManagePayroll={false}
        canManagePayrollSettings={false}
        canViewSections
        canEditSections
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Bearbeiten" })[0]!);
    fireEvent.change(screen.getByLabelText("Geburtsdatum"), {
      target: { value: "17.04.1982" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        "Die Änderung an „Person“ konnte nicht übernommen werden. Bitte prüfe deine Angaben.",
      ),
    ).toBeInTheDocument();
    const first = screen.getByLabelText("Vorname");
    await waitFor(() => expect(first).toHaveFocus());
    expect(first).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("alert", { name: /^Fehler:/ })).toBeNull();
  });

  // ADR 0311: Jeder Abschnitt sendet den Stand, den das Bearbeiten
  // vorfand; ist er inzwischen geändert, schließt der Entwurf, der
  // gespeicherte Stand wird neu gelesen und die Meldung erscheint ohne
  // Wiederholen.
  it("sendet den gelesenen Stand je Abschnitt und zeigt nach einer Ablehnung den gespeicherten Stand", async () => {
    seedSWR();
    mutate.mockResolvedValue(stammdaten);
    vi.mocked(staffStammdatenService.updatePerson).mockRejectedValue(
      new ApiError("changed since it was read", 409, {
        code: "general.changed_since_read",
      }),
    );
    render(
      <StammdatenTab
        staffId="42"
        canManagePayroll={false}
        canManagePayrollSettings={false}
        canViewSections
        canEditSections
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Bearbeiten" })[0]!);
    // Ein Neuladen während des Bearbeitens ändert den gesendeten Stand nicht.
    swrData.current.set("staff-stammdaten-", {
      ...stammdaten,
      versions: { ...stammdaten.versions, person: "v-person-newer" },
    });
    fireEvent.change(screen.getByLabelText("Geburtsdatum"), {
      target: { value: "17.04.1982" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        /Der Abschnitt „Person“ wurde inzwischen geändert/,
      ),
    ).toBeInTheDocument();
    expect(staffStammdatenService.updatePerson).toHaveBeenCalledWith(
      "42",
      expect.objectContaining({ birthday: "1982-04-17" }),
      "",
      "v-person",
    );
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(screen.queryByLabelText("Geburtsdatum")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Erneut versuchen" }),
    ).toBeNull();
  });

  // Regel 6: Scheitert das Neuladen nach einer Ablehnung, erscheint der
  // Ladefehler statt der Behauptung, der neue Stand sei zu sehen; auch für
  // die Bankdaten, deren SWR-Neuladen sonst still mit dem alten Stand endet.
  it("zeigt nach einer Ablehnung den Ladefehler, wenn die Bankdaten nicht neu laden", async () => {
    seedSWR({ financial: true });
    mutate.mockResolvedValue(stammdaten);
    failingReloads.current.set(
      "staff-stammdaten-financial-",
      new ApiError("boom", 503, { code: "general.unavailable" }),
    );
    vi.mocked(staffStammdatenService.updatePerson).mockRejectedValue(
      new ApiError("changed since it was read", 409, {
        code: "general.changed_since_read",
      }),
    );
    render(
      <StammdatenTab
        staffId="42"
        canManagePayroll={false}
        canManagePayrollSettings={false}
        canViewSections
        canEditSections
        canViewFinancial
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Bearbeiten" })[0]!);
    fireEvent.change(screen.getByLabelText("Geburtsdatum"), {
      target: { value: "17.04.1982" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(/Der neue Stand konnte nicht geladen werden\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/wurde inzwischen geändert/)).toBeNull();
  });

  // Regel 5: Nach einem Teilfehler ruht ein gespeicherter Abschnitt auf dem
  // Stand, den der Server für ihn geantwortet hat; ein zweites Speichern
  // desselben Abschnitts wird nicht fälschlich abgelehnt, auch wenn der
  // neu gelesene Stand (normalisiert) anders aussieht als der Entwurf.
  it("sendet nach einem Teilfehler beim zweiten Speichern den geantworteten Stand", async () => {
    seedSWR();
    mutate.mockResolvedValue(stammdaten);
    vi.mocked(staffStammdatenService.updatePerson)
      .mockReset()
      .mockResolvedValue("v-person-saved");
    vi.mocked(staffPayrollNumberService.update)
      .mockReset()
      .mockRejectedValue(
        new ApiError("personnel number taken", 409, {
          code: "workforce.personnel_number_taken",
        }),
      );
    render(
      <StammdatenTab
        staffId="42"
        canManagePayroll
        canManagePayrollSettings={false}
        canViewSections
        canEditSections
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Bearbeiten" })[0]!);
    fireEvent.change(screen.getByLabelText("Geburtsdatum"), {
      target: { value: "17.04.1982" },
    });
    fireEvent.change(screen.getByLabelText("Personalnummer"), {
      target: { value: "90002" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText(
        catalogText("workforce.personnel_number_taken", "die Personalnummer"),
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Geburtsdatum"), {
      target: { value: "18.04.1982" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(staffStammdatenService.updatePerson).toHaveBeenCalledTimes(2),
    );
    expect(staffStammdatenService.updatePerson).toHaveBeenNthCalledWith(
      1,
      "42",
      expect.objectContaining({ birthday: "1982-04-17" }),
      "",
      "v-person",
    );
    expect(staffStammdatenService.updatePerson).toHaveBeenNthCalledWith(
      2,
      "42",
      expect.objectContaining({ birthday: "1982-04-18" }),
      "",
      "v-person-saved",
    );
  });

  it("zeigt bei einem Serverfehler die Vorgangskennung zum Kopieren", async () => {
    seedSWR();
    vi.mocked(staffStammdatenService.updatePerson).mockRejectedValue(
      new ApiError("boom", 500, {
        code: "general.server",
        instance: "req-stamm-1",
      }),
    );
    render(
      <StammdatenTab
        staffId="42"
        canManagePayroll={false}
        canManagePayrollSettings={false}
        canViewSections
        canEditSections
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Bearbeiten" })[0]!);
    fireEvent.change(screen.getByLabelText("Geburtsdatum"), {
      target: { value: "17.04.1982" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByRole("button", { name: "Vorgangskennung kopieren" }),
    ).toHaveTextContent("Vorgangskennung: req-stamm-1");
    expect(
      screen.getByText(
        "Die Änderung an „Person“ konnte nicht bearbeitet werden. Bitte versuche es später erneut.",
      ),
    ).toBeInTheDocument();
  });

  it("nennt eine vergebene Personalnummer und schickt gespeicherte Abschnitte nicht erneut", async () => {
    seedSWR();
    vi.mocked(staffStammdatenService.updatePerson).mockResolvedValue("v-saved");
    vi.mocked(staffPayrollNumberService.update).mockReset();
    vi.mocked(staffPayrollNumberService.update)
      .mockRejectedValueOnce(
        new ApiError("personnel number taken", 409, {
          code: "workforce.personnel_number_taken",
        }),
      )
      .mockResolvedValueOnce({ personnelNumber: "90002", version: "v-90002" });
    render(
      <StammdatenTab
        staffId="42"
        canManagePayroll
        canManagePayrollSettings={false}
        canViewSections
        canEditSections
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Bearbeiten" })[0]!);
    fireEvent.change(screen.getByLabelText("Geburtsdatum"), {
      target: { value: "17.04.1982" },
    });
    fireEvent.change(screen.getByLabelText("Personalnummer"), {
      target: { value: "90002" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        catalogText("workforce.personnel_number_taken", "die Personalnummer"),
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(staffPayrollNumberService.update).toHaveBeenCalledTimes(2),
    );
    expect(staffStammdatenService.updatePerson).toHaveBeenCalledTimes(1);
  });

  it("hält beim ersten abgelehnten Abschnitt an", async () => {
    seedSWR();
    vi.mocked(staffStammdatenService.updatePerson).mockRejectedValue(
      new ApiError("boom", 503, { code: "general.unavailable" }),
    );
    vi.mocked(staffPayrollNumberService.update).mockReset();
    render(
      <StammdatenTab
        staffId="42"
        canManagePayroll
        canManagePayrollSettings={false}
        canViewSections
        canEditSections
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Bearbeiten" })[0]!);
    fireEvent.change(screen.getByLabelText("Geburtsdatum"), {
      target: { value: "17.04.1982" },
    });
    fireEvent.change(screen.getByLabelText("Personalnummer"), {
      target: { value: "90002" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        "Die Änderung an „Person“ ist gerade nicht erreichbar. Bitte versuche es erneut.",
      ),
    ).toBeInTheDocument();
    expect(staffPayrollNumberService.update).not.toHaveBeenCalled();
  });

  it("zeigt ohne staff:financial die Sperre statt der Bank-Sektion", () => {
    seedSWR();
    render(
      <StammdatenTab
        staffId="42"
        canManagePayroll={false}
        canManagePayrollSettings={false}
        canViewSections
      />,
    );

    expect(screen.getByText(/Nicht berechtigt/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Anzeigen" }),
    ).not.toBeInTheDocument();
  });

  it("zeigt maskierte Bankdaten und lädt Klartext über den Anzeigen-Toggle", async () => {
    seedSWR({ financial: true });
    revealFinancial.mockResolvedValue({
      iban: "DE89370400440532013000",
      taxId: "12345678911",
      socialSecurityNumber: "65170839J003",
    });

    render(
      <StammdatenTab
        staffId="42"
        canManagePayroll={false}
        canManagePayrollSettings={false}
        canViewSections
        canViewFinancial
      />,
    );

    expect(screen.getByText("•••• 3000")).toBeInTheDocument();
    expect(
      screen.queryByText("DE89370400440532013000"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Anzeigen" }));
    await waitFor(() =>
      expect(screen.getByText("DE89370400440532013000")).toBeInTheDocument(),
    );
    expect(revealFinancial).toHaveBeenCalledWith("42");

    fireEvent.click(screen.getByRole("button", { name: "Verbergen" }));
    expect(
      screen.queryByText("DE89370400440532013000"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("•••• 3000")).toBeInTheDocument();
  });

  it("meldet ein abgelehntes Anzeigen der Bankdaten als Toast", async () => {
    seedSWR({ financial: true });
    revealFinancial.mockRejectedValue(
      new ApiError("forbidden", 403, { code: "general.permission" }),
    );
    render(
      <StammdatenTab
        staffId="42"
        canManagePayroll={false}
        canManagePayrollSettings={false}
        canViewSections
        canViewFinancial
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Anzeigen" }));

    expect(
      await screen.findByRole("alert", {
        name: "Fehler: Für die Anzeige der Bank- und Steuerdaten fehlt dir die Berechtigung. Bitte frage die Schule.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("•••• 3000")).toBeInTheDocument();
  });

  it("zeigt einen Ladefehler der Bankdaten mit erneutem Laden statt Leerwerten", async () => {
    seedSWR({ financialError: true });
    render(
      <StammdatenTab
        staffId="42"
        canManagePayroll={false}
        canManagePayrollSettings={false}
        canViewSections
        canViewFinancial
      />,
    );

    expect(
      await screen.findByText(
        catalogText(
          "general.unavailable",
          "die Anzeige der Bank- und Steuerdaten",
        ),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Vorgangskennung kopieren" }),
    ).toHaveTextContent("req-financial");
    expect(screen.queryByText("•••• 3000")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Bearbeiten" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("klappt eine Sektion über den Toggle ein", () => {
    seedSWR();
    render(
      <StammdatenTab
        staffId="42"
        canManagePayroll={false}
        canManagePayrollSettings={false}
        canViewSections
      />,
    );

    expect(screen.getByText("Mila")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Person einklappen" }));
    expect(screen.queryByText("Mila")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Person ausklappen" }));
    expect(screen.getByText("Mila")).toBeInTheDocument();
  });
});
