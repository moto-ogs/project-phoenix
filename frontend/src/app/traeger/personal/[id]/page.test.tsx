import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import { setTestClock } from "~/test/clock";
import { catalogText } from "~/test/error-catalog-text";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import type { StaffRecordDetail } from "~/lib/traeger-staff-api";

vi.unmock("swr");

const { api, mockPush, mockReplace } = vi.hoisted(() => ({
  api: {
    fetchStaffRecord: vi.fn(),
    updateStaffPersonnelNumber: vi.fn(),
    updateStaffPerson: vi.fn(),
    revealStaffFinancial: vi.fn(),
    updateStaffFinancial: vi.fn(),
    dissolveStaffRecord: vi.fn(),
    createStaffContract: vi.fn(),
    updateStaffContract: vi.fn(),
  },
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
}));

vi.mock("~/lib/traeger-staff-api", async (original) => ({
  ...(await original<typeof import("~/lib/traeger-staff-api")>()),
  ...api,
}));
// Die Kontingente (#4710) haben ihren eigenen Test.
vi.mock("~/lib/traeger-absence-api", () => ({
  fetchTraegerAbsenceAccounts: vi.fn().mockResolvedValue([]),
  setTraegerAbsenceAllowance: vi.fn(),
}));
// Das Stundenkonto (#4711) hat seinen eigenen Test: ein leerer Monat.
vi.mock("~/lib/traeger-time-account-api", async (original) => ({
  ...(await original<typeof import("~/lib/traeger-time-account-api")>()),
  fetchTraegerTimeAccount: (_recordId: string, year: number, month: number) =>
    Promise.resolve({
      year,
      month,
      state: "school",
      ended: true,
      schools: [],
      targetMinutes: 0,
      actualMinutes: 0,
      creditedMinutes: 0,
      adjustmentMinutes: 0,
      balanceMinutes: 0,
      carryInMinutes: 0,
      closingBalanceMinutes: 0,
    }),
}));
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));
const address = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useParams: () => ({ id: "5" }),
  usePathname: () => "/personal/5",
  useSearchParams: () => new URLSearchParams(address.search),
}));

import TraegerStaffRecordPage from "./page";

const RECORD: StaffRecordDetail = {
  id: "5",
  firstName: "Mira",
  lastName: "Sommer-Berg",
  birthday: "1990-04-02",
  personnelNumber: "70001",
  hasFinancial: true,
  employments: [
    {
      schoolId: "1",
      schoolName: "OGS Nord",
      staffId: "11",
      active: true,
      viaPool: false,
    },
    {
      schoolId: "2",
      schoolName: "OGS Süd",
      staffId: "22",
      active: false,
      viaPool: false,
    },
  ],
  personVersion: "person-v1",
  financial: {
    iban: "•••• 3000",
    taxId: null,
    socialSecurityNumber: null,
    version: "financial-v1",
  },
  changes: [
    {
      kind: "not_chosen",
      field: "last_name",
      value: "Sommer",
      schoolName: "OGS Nord",
      occurredAt: "2026-11-14T10:00:00Z",
    },
  ],
  proofs: [
    {
      typeId: "7",
      typeName: "Erweitertes Führungszeugnis",
      mandatory: true,
      policeCertificate: true,
      held: true,
      status: "expiring_soon",
      presentedOn: "2021-11-20",
      issuedOn: "2021-11-02",
      noRelevantEntry: true,
      expiresOn: "2026-11-02",
    },
    {
      typeId: "8",
      typeName: "Masernschutz",
      mandatory: true,
      policeCertificate: false,
      held: false,
      status: "missing",
      presentedOn: "",
      issuedOn: "",
      noRelevantEntry: false,
      expiresOn: "",
    },
  ],
  contracts: [],
  unsyncedSchools: [],
};

const CONTRACT = {
  id: "9",
  version: "contract-v1",
  kind: "part_time" as const,
  startsOn: "2026-08-01",
  endsOn: null,
  sites: [
    {
      schoolId: "1",
      schoolName: "OGS Nord",
      staffId: "11",
      changeableFrom: "2026-09-01",
      soll: [
        { validFrom: "2026-10-01", weekdayMinutes: [360, 360, 360, 0, 0] },
        { validFrom: "2026-08-01", weekdayMinutes: [300, 300, 300, 300, 0] },
      ],
    },
  ],
  holidayWeeks: [
    {
      schoolId: "1",
      schoolName: "OGS Nord",
      staffId: "11",
      weekStart: "2026-10-12",
      weekdayMinutes: [420, 420, 420, 420, 300],
    },
  ],
};

function renderPage() {
  return render(
    <TraegerResourceTestProvider>
      <TraegerStaffRecordPage />
    </TraegerResourceTestProvider>,
  );
}

describe("TraegerStaffRecordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    address.search = "";
    api.fetchStaffRecord.mockResolvedValue(RECORD);
  });

  // #7377: Zurück führt auf den Reiter der Personalakten, von dem man kam.
  it("leads back to the tab of the Personalakten it came from", async () => {
    address.search = "from=akten";
    renderPage();
    expect(
      await screen.findByRole("link", { name: /Zurück zu den Personalakten/ }),
    ).toHaveAttribute(
      "href",
      // Der Rückweg läuft über den Pfad-Kontext von TenantPage; die
      // Testumgebung setzt davor ihr Tenant-Präfix.
      expect.stringMatching(/\/personal\?tab=akten$/),
    );
  });

  // #7414: Die Akte ist in fünf Reiter geteilt; der Reiter steht in der Adresse.
  it("shows the Einsatzorte, the masked bank values and the trail in their tabs", async () => {
    renderPage();
    expect(await screen.findByText("Einsatzorte")).toBeInTheDocument();
    expect(screen.getByText("Beendet")).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Stammdaten",
      "Verträge und Zeit",
      "Nachweise",
      "Bank und Steuer",
      "Verlauf",
    ]);
    // Die Statuszeile wiederholt die Personalnummer der Karte nicht mehr.
    expect(screen.getAllByText("70001")).toHaveLength(1);
    expect(screen.queryByText("•••• 3000")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Bank und Steuer" }));
    expect(await screen.findByText("•••• 3000")).toBeInTheDocument();
    expect(screen.queryByText("Einsatzorte")).not.toBeInTheDocument();
    expect(mockReplace).toHaveBeenLastCalledWith(
      "/personal/5?tab=bank-und-steuer",
      { scroll: false },
    );

    fireEvent.click(screen.getByRole("tab", { name: "Verlauf" }));
    expect(
      await screen.findByText(
        "Nachname „Sommer“ von OGS Nord nicht übernommen",
      ),
    ).toBeInTheDocument();
  });

  it("opens the tab from the address and keeps the way back when switching", async () => {
    address.search = "from=akten&tab=verlauf";
    renderPage();
    expect(
      await screen.findByText(
        "Nachname „Sommer“ von OGS Nord nicht übernommen",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Verlauf" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Stammdaten" }));
    expect(await screen.findByText("Einsatzorte")).toBeInTheDocument();
    expect(mockReplace).toHaveBeenLastCalledWith("/personal/5?from=akten", {
      scroll: false,
    });
  });

  it("opens the Stammdaten for an unknown tab in the address", async () => {
    address.search = "tab=unbekannt";
    renderPage();
    expect(await screen.findByText("Einsatzorte")).toBeInTheDocument();
  });

  it("marks the Einsatzorte of the Vertretungspool and says when they end", async () => {
    api.fetchStaffRecord.mockResolvedValue({
      ...RECORD,
      employments: [
        { ...RECORD.employments[0]!, viaPool: true },
        {
          schoolId: "3",
          schoolName: "OGS West",
          staffId: "33",
          active: false,
          viaPool: true,
        },
      ],
      changes: [
        {
          kind: "resumed",
          field: "school",
          value: "",
          schoolName: "OGS Nord",
          occurredAt: "2026-11-15T08:00:00Z",
        },
        {
          kind: "ended",
          field: "school",
          value: "",
          schoolName: "OGS West",
          occurredAt: "2026-11-15T01:00:00Z",
        },
      ],
    });
    renderPage();
    expect(
      await screen.findByText("Endet nach der letzten Blockung der Schule."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Die nächste Blockung beschäftigt die Person hier wieder.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Vertretungspool")).toHaveLength(2);
    fireEvent.click(screen.getByRole("tab", { name: "Verlauf" }));
    expect(
      await screen.findByText(
        "Beschäftigung an der Schule OGS West nach der letzten Blockung beendet",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Beschäftigung an der Schule OGS Nord mit einer neuen Blockung wieder aufgenommen",
      ),
    ).toBeInTheDocument();
  });

  it("shows each proof with its status and only the result of the certificate", async () => {
    address.search = "tab=nachweise";
    renderPage();
    const card = (
      await screen.findByText("Nachweise", { selector: "h2" })
    ).closest("section");
    expect(card).not.toBeNull();
    expect(within(card!).getByText("2 offen")).toBeInTheDocument();
    expect(within(card!).getByText("Läuft bald ab")).toBeInTheDocument();
    expect(within(card!).getByText("Fehlt")).toBeInTheDocument();
    expect(
      within(card!).getByText(
        "Eingesehen am 20.11.2021 · ausgestellt am 02.11.2021 · keine einschlägige Eintragung · gültig bis 02.11.2026",
      ),
    ).toBeInTheDocument();
    expect(
      within(card!).getByRole("button", { name: "Masernschutz eintragen" }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(card!).getByRole("button", {
        name: "Erweitertes Führungszeugnis erneuern",
      }),
    );
    expect(
      await screen.findByText(
        "Das Führungszeugnis hat keine einschlägige Eintragung.",
      ),
    ).toBeInTheDocument();
  });

  it("saves the Träger's personnel number and refuses letters", async () => {
    api.updateStaffPersonnelNumber.mockResolvedValue({
      ...RECORD,
      personnelNumber: "70005",
    });
    renderPage();
    const card = (
      await screen.findByText("Personalnummer", {
        selector: "h2",
      })
    ).closest("section");
    expect(card).not.toBeNull();
    fireEvent.click(within(card!).getByRole("button", { name: /Bearbeiten/ }));
    const input = within(card!).getByLabelText("Personalnummer");
    fireEvent.change(input, { target: { value: "70A" } });
    fireEvent.click(within(card!).getByRole("button", { name: "Speichern" }));
    expect(
      await within(card!).findByText("Die Personalnummer hat 1 bis 9 Ziffern."),
    ).toBeInTheDocument();
    expect(api.updateStaffPersonnelNumber).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "70005" } });
    fireEvent.click(within(card!).getByRole("button", { name: "Speichern" }));
    await vi.waitFor(() =>
      expect(api.updateStaffPersonnelNumber).toHaveBeenCalledWith("5", "70005"),
    );
    expect(await within(card!).findByText("70005")).toBeInTheDocument();
  });

  // #7379: Name und Geburtstag korrigiert die Personalverwaltung in der Akte.
  it("corrects name and birthday and refuses an empty name", async () => {
    let answer: () => void = () => undefined;
    api.updateStaffPerson.mockReturnValue(
      new Promise<void>((resolve) => {
        answer = resolve;
      }),
    );
    const saved: StaffRecordDetail = {
      ...RECORD,
      firstName: "Myra",
      birthday: "1990-04-12",
      changes: [
        {
          kind: "changed",
          field: "birthday",
          value: "1990-04-02",
          schoolName: "",
          occurredAt: "2026-11-18T10:00:00Z",
        },
        ...RECORD.changes,
      ],
    };
    renderPage();
    const card = (
      await screen.findByText("Person", { selector: "h2" })
    ).closest("section");
    expect(card).not.toBeNull();
    expect(within(card!).getByText("02.04.1990")).toBeInTheDocument();
    fireEvent.click(within(card!).getByRole("button", { name: /Bearbeiten/ }));

    const firstName = within(card!).getByLabelText(/Vorname/);
    fireEvent.change(firstName, { target: { value: "  " } });
    fireEvent.click(within(card!).getByRole("button", { name: "Speichern" }));
    expect(
      await within(card!).findByText("Bitte trage den Vornamen ein."),
    ).toBeInTheDocument();
    expect(api.updateStaffPerson).not.toHaveBeenCalled();

    // Leaving the untouched birthday is no change: the refusal stays.
    fireEvent.blur(within(card!).getByRole("textbox", { name: /Geburtstag/ }));
    expect(
      within(card!).getByText("Bitte trage den Vornamen ein."),
    ).toBeInTheDocument();

    fireEvent.change(firstName, { target: { value: " Myra " } });
    expect(
      within(card!).queryByText("Bitte trage den Vornamen ein."),
    ).not.toBeInTheDocument();
    expect(firstName).not.toHaveAttribute("aria-invalid", "true");
    fireEvent.change(
      within(card!).getByRole("textbox", { name: /Geburtstag/ }),
      {
        target: { value: "12041990" },
      },
    );
    fireEvent.click(within(card!).getByRole("button", { name: "Speichern" }));
    await vi.waitFor(() =>
      expect(api.updateStaffPerson).toHaveBeenCalledWith(
        "5",
        { firstName: "Myra", lastName: "Sommer-Berg", birthday: "1990-04-12" },
        "person-v1",
      ),
    );
    // While saving, nothing typed can get lost.
    expect(firstName).toBeDisabled();
    // The correction answers no record: the page loads it again.
    api.fetchStaffRecord.mockResolvedValue(saved);
    answer();
    expect(await within(card!).findByText("12.04.1990")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Myra Sommer-Berg" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Verlauf" }));
    expect(
      await screen.findByText("Geburtstag ersetzt, vorher „02.04.1990“"),
    ).toBeInTheDocument();
  });

  it("closes the person without a request when nothing changed", async () => {
    renderPage();
    const card = (
      await screen.findByText("Person", { selector: "h2" })
    ).closest("section");
    fireEvent.click(within(card!).getByRole("button", { name: /Bearbeiten/ }));
    fireEvent.click(within(card!).getByRole("button", { name: "Speichern" }));
    expect(
      await within(card!).findByRole("button", { name: /Bearbeiten/ }),
    ).toBeInTheDocument();
    expect(api.updateStaffPerson).not.toHaveBeenCalled();
  });

  it("reveals the bank values on request", async () => {
    api.revealStaffFinancial.mockResolvedValue({
      iban: "DE89370400440532013000",
      taxId: null,
      socialSecurityNumber: null,
    });
    address.search = "tab=bank-und-steuer";
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Anzeigen/ }));
    expect(
      await screen.findByText("DE89370400440532013000"),
    ).toBeInTheDocument();
    expect(api.revealStaffFinancial).toHaveBeenCalledWith("5");
  });

  it("shows a contract with today's Soll, its history and the holiday weeks", async () => {
    // Vertrag, Soll-Stufen und Ferienwochen liegen fest um den 09.09.2026.
    setTestClock("2026-09-09T12:00:00+02:00");
    api.fetchStaffRecord.mockResolvedValue({
      ...RECORD,
      contracts: [CONTRACT],
    });
    address.search = "tab=vertraege";
    renderPage();
    expect(await screen.findByText("Teilzeit")).toBeInTheDocument();
    expect(screen.getByText("Läuft")).toBeInTheDocument();
    // Am Testtag (09.09.2026) gilt das Soll vom 01.08.: 20 Std. pro Woche.
    expect(screen.getAllByText("20 Std.").length).toBeGreaterThan(0);
    expect(screen.getByText("Geplant")).toBeInTheDocument();
    expect(screen.getByText("12.10.2026 bis 16.10.2026")).toBeInTheDocument();
    expect(
      screen.getByText(/frühestens ab dem 01\.09\.2026/),
    ).toBeInTheDocument();
  });

  it("creates a contract with the Soll of each live school", async () => {
    api.createStaffContract.mockResolvedValue({
      ...RECORD,
      contracts: [CONTRACT],
    });
    address.search = "tab=vertraege";
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: /Vertrag anlegen/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Arbeitsvertrag anlegen",
    });
    // Ohne ersten Tag und ohne Stunden geht nichts weg.
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Vertrag anlegen" }),
    );
    expect(
      await within(dialog).findByText("Bitte den ersten Tag wählen."),
    ).toBeInTheDocument();
    expect(api.createStaffContract).not.toHaveBeenCalled();
    // Nur die laufende Beschäftigung bekommt Felder.
    expect(within(dialog).getByText("OGS Nord")).toBeInTheDocument();
    expect(within(dialog).queryByText("OGS Süd")).not.toBeInTheDocument();
    fireEvent.change(
      within(dialog).getByLabelText(/am Montag an der Schule OGS Nord/),
      {
        target: { value: "5,5" },
      },
    );
    expect(within(dialog).getByText("5,5 Std. pro Woche")).toBeInTheDocument();
  });

  // ADR 0311: a save rests on the state the edit opened on. A colleague's
  // change since is refused; the edit stays open on the stored state.
  const changed = () =>
    new ApiError("changed", 409, { code: "general.changed_since_read" });

  it("keeps the person open on the stored record after a refusal", async () => {
    api.updateStaffPerson
      .mockRejectedValueOnce(changed())
      .mockResolvedValue(undefined);
    renderPage();
    const card = (
      await screen.findByText("Person", { selector: "h2" })
    ).closest("section");
    fireEvent.click(within(card!).getByRole("button", { name: /Bearbeiten/ }));
    fireEvent.change(within(card!).getByLabelText(/Vorname/), {
      target: { value: "Myra" },
    });
    api.fetchStaffRecord.mockResolvedValue({
      ...RECORD,
      lastName: "Sommer",
      personVersion: "person-v2",
    });
    fireEvent.click(within(card!).getByRole("button", { name: "Speichern" }));

    expect(
      await within(card!).findByText(
        catalogText("general.changed_since_read", "die Person"),
      ),
    ).toBeInTheDocument();
    expect(api.updateStaffPerson.mock.calls.at(-1)?.[2]).toBe("person-v1");
    await vi.waitFor(() =>
      expect(within(card!).getByLabelText(/Nachname/)).toHaveValue("Sommer"),
    );
    expect(within(card!).getByLabelText(/Vorname/)).toHaveValue("Mira");

    fireEvent.change(within(card!).getByLabelText(/Vorname/), {
      target: { value: "Myra" },
    });
    fireEvent.click(within(card!).getByRole("button", { name: "Speichern" }));
    await vi.waitFor(() =>
      expect(api.updateStaffPerson.mock.calls.at(-1)?.[2]).toBe("person-v2"),
    );
  });

  it("shows the stored bank values after a refusal and saves over their version", async () => {
    api.revealStaffFinancial
      .mockResolvedValueOnce({
        iban: "DE89370400440532013000",
        taxId: null,
        socialSecurityNumber: null,
        version: "financial-v1",
      })
      .mockResolvedValue({
        iban: "DE02120300000000202051",
        taxId: "12345678911",
        socialSecurityNumber: null,
        version: "financial-v2",
      });
    api.updateStaffFinancial
      .mockRejectedValueOnce(changed())
      .mockResolvedValue(undefined);
    address.search = "tab=bank-und-steuer";
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Bearbeiten/ }));
    const iban = await screen.findByLabelText("IBAN");
    expect(iban).toHaveValue("DE89370400440532013000");
    fireEvent.change(iban, { target: { value: "DE75512108001245126199" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "die Bank- und Steuerdaten"),
      ),
    ).toBeInTheDocument();
    expect(api.updateStaffFinancial.mock.calls.at(-1)?.[2]).toBe(
      "financial-v1",
    );
    await vi.waitFor(() =>
      expect(screen.getByLabelText("IBAN")).toHaveValue(
        "DE02120300000000202051",
      ),
    );
    expect(screen.getByLabelText("Steuer-ID")).toHaveValue("12345678911");

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await vi.waitFor(() =>
      expect(api.updateStaffFinancial.mock.calls.at(-1)?.[2]).toBe(
        "financial-v2",
      ),
    );
  });

  it("keeps the contract dialog open on the stored contract after a refusal", async () => {
    setTestClock("2026-09-09T12:00:00+02:00");
    const contract = { ...CONTRACT, version: "contract-v1" };
    api.fetchStaffRecord.mockResolvedValue({ ...RECORD, contracts: [contract] });
    api.updateStaffContract.mockRejectedValueOnce(changed());
    address.search = "tab=vertraege";
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: /^Aktionen für den Vertrag/ }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Vertrag ändern/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Vertrag ändern",
    });
    fireEvent.click(within(dialog).getByRole("switch"));
    api.fetchStaffRecord.mockResolvedValue({
      ...RECORD,
      contracts: [{ ...contract, kind: "minijob", version: "contract-v2" }],
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    expect(
      await within(dialog).findByText(
        catalogText("general.changed_since_read", "den Arbeitsvertrag"),
      ),
    ).toBeInTheDocument();
    expect(api.updateStaffContract.mock.calls.at(-1)?.[3]).toBe("contract-v1");
    await vi.waitFor(() =>
      expect(within(dialog).getByRole("switch")).not.toBeChecked(),
    );
    expect(within(dialog).getByRole("radio", { name: /Minijob/ })).toBeChecked();

    api.updateStaffContract.mockResolvedValue({
      ...RECORD,
      contracts: [{ ...contract, kind: "minijob", version: "contract-v3" }],
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await vi.waitFor(() =>
      expect(api.updateStaffContract.mock.calls.at(-1)?.[3]).toBe(
        "contract-v2",
      ),
    );
  });
});
