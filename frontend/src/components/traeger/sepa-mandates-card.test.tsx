import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { ApiError } from "~/lib/api-error";
import type { SepaMandate } from "~/lib/traeger-sepa-api";
import { deferred } from "~/test/helpers/form-modal-pending";
import { testClockDay } from "~/test/clock";
import {
  SepaMandateStatusCard,
  SepaMandateStatusView,
  useSepaMandateStatus,
} from "./sepa-mandate-status-card";
import TraegerSepaMandatePage from "~/app/traeger/abrechnung/lastschrift/[contractId]/page";
import { SepaMandatesCard } from "./sepa-mandates-card";

vi.unmock("swr");

const api = vi.hoisted(() => ({
  fetchSepaMandates: vi.fn(),
  fetchSepaMandateCollections: vi.fn(),
  fetchSepaMandateHistory: vi.fn(),
  createSepaMandate: vi.fn(),
  revokeSepaMandate: vi.fn(),
}));
vi.mock("~/lib/traeger-sepa-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));
vi.mock("~/lib/traeger-api", () => ({
  fetchTraegerBuero: () => Promise.resolve({ members: [] }),
}));
const bffJson = vi.hoisted(() => vi.fn());
vi.mock("~/lib/bff-fetch", () => ({ bffJson }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ contractId: "42" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/traeger/abrechnung/lastschrift/42",
  useSearchParams: () => new URLSearchParams(),
}));

const MANDATE: SepaMandate = {
  id: "9",
  contractId: "42",
  familyEmail: "eva@example.org",
  partyFirstName: "Eva",
  partyLastName: "Beispiel",
  reference: "SJR-2026-0001",
  signedOn: "2026-09-01",
  kind: "recurring",
  sequence: "recurring",
  creditorId: "DE98ZZZ09999999999",
  creditorCurrent: true,
  accountHolder: "Eva Beispiel",
  ibanMasked: "DE•• •••• •••• •••• ••30 00",
  bic: "",
  source: "office",
  revokedOn: null,
  lastCollectedOn: null,
  expiresOn: "2029-09-01",
  createdAt: "2026-09-01T10:00:00+02:00",
};

function renderCard() {
  render(
    <TraegerResourceTestProvider>
      <SepaMandatesCard contractId="42" holder="Eva Beispiel" />
    </TraegerResourceTestProvider>,
  );
}

describe("SepaMandatesCard (#4695)", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.fetchSepaMandateCollections.mockResolvedValue([]);
  });

  it.each(["list", "status", "detail"] as const)(
    "reads the audited %s on every opening",
    async (surface) => {
      api.fetchSepaMandates.mockResolvedValueOnce([MANDATE]);
      const next = deferred<SepaMandate[]>();
      api.fetchSepaMandates.mockReturnValueOnce(next.promise);
      const content =
        surface === "list" ? (
          <SepaMandatesCard contractId="42" holder="Eva Beispiel" />
        ) : surface === "status" ? (
          <SepaMandateStatusCard contractId="42" />
        ) : (
          <TraegerSepaMandatePage />
        );
      const view = render(
        <TraegerResourceTestProvider>{content}</TraegerResourceTestProvider>,
      );
      expect(
        (await screen.findAllByText(new RegExp(MANDATE.reference)))[0],
      ).toBeVisible();
      view.rerender(
        <TraegerResourceTestProvider>{null}</TraegerResourceTestProvider>,
      );
      view.rerender(
        <TraegerResourceTestProvider>{content}</TraegerResourceTestProvider>,
      );
      await waitFor(() =>
        expect(api.fetchSepaMandates).toHaveBeenCalledTimes(2),
      );
      expect(
        screen.queryByText(new RegExp(MANDATE.reference)),
      ).not.toBeInTheDocument();
      await act(async () => {
        next.resolve([MANDATE]);
      });
      expect(
        (await screen.findAllByText(new RegExp(MANDATE.reference)))[0],
      ).toBeVisible();
    },
  );

  it.each([
    ["an expired mandate", { expiresOn: testClockDay() }],
    [
      "a one-off mandate already collected",
      { kind: "one_off", lastCollectedOn: testClockDay(-30) },
    ],
  ] as const)(
    "does not call %s valid: the billing refuses it (#7770)",
    async (_name, spent) => {
      api.fetchSepaMandates.mockResolvedValue([{ ...MANDATE, ...spent }]);
      render(
        <TraegerResourceTestProvider>
          <SepaMandateStatusCard contractId="42" />
        </TraegerResourceTestProvider>,
      );
      expect(
        await screen.findByText(
          /Mit diesem Mandat kann nicht mehr abgebucht werden.*Widerrufe es/,
        ),
      ).toBeVisible();
      expect(screen.getByText("Neues Mandat nötig")).toBeVisible();
      expect(screen.queryByText("Gültig")).not.toBeInTheDocument();
    },
  );

  it("names a used one-off mandate on the mandate page and how to replace it", async () => {
    api.fetchSepaMandates.mockResolvedValue([
      { ...MANDATE, kind: "one_off", lastCollectedOn: testClockDay(-30) },
    ]);
    renderCard();
    expect(await screen.findByText("Verbraucht")).toBeVisible();
    expect(
      screen.getByText(/Das Mandat galt für eine Abbuchung/),
    ).toBeVisible();
    // No next debit for a mandate that authorizes none.
    expect(screen.queryByText("Einmalige Lastschrift")).not.toBeInTheDocument();
    expect(screen.queryByText("Gültig")).not.toBeInTheDocument();
  });

  it("promises no transfer invoice where staff choose the payment method", async () => {
    api.fetchSepaMandates.mockResolvedValue([]);
    function Card() {
      return (
        <SepaMandateStatusView
          contractId="42"
          read={useSepaMandateStatus("42")}
          plainFallback
        />
      );
    }
    render(
      <TraegerResourceTestProvider>
        <Card />
      </TraegerResourceTestProvider>,
    );
    expect(
      await screen.findByText("Ohne gültiges Mandat wird nicht abgebucht."),
    ).toBeVisible();
    expect(
      screen.queryByText(/Rechnung zum Überweisen/),
    ).not.toBeInTheDocument();
  });

  it("calls a mandate valid until the day before it expires", async () => {
    api.fetchSepaMandates.mockResolvedValue([
      { ...MANDATE, expiresOn: testClockDay(1) },
    ]);
    render(
      <TraegerResourceTestProvider>
        <SepaMandateStatusCard contractId="42" />
      </TraegerResourceTestProvider>,
    );
    expect(await screen.findByText("Gültig")).toBeVisible();
  });

  it("reads the mandate history on every reopening", async () => {
    api.fetchSepaMandates.mockResolvedValue([MANDATE]);
    api.fetchSepaMandateHistory.mockResolvedValueOnce([]);
    renderCard();
    async function openHistory() {
      fireEvent.click(
        await screen.findByRole("button", {
          name: `Aktionen für das Mandat ${MANDATE.reference}`,
        }),
      );
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Verlauf ansehen" }),
      );
    }
    await openHistory();
    expect(await screen.findByText("Noch keine Einträge.")).toBeVisible();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Modal schließen" }),
    );
    await waitForElementToBeRemoved(dialog);
    const next = deferred<[]>();
    api.fetchSepaMandateHistory.mockReturnValueOnce(next.promise);
    await openHistory();
    await waitFor(() =>
      expect(api.fetchSepaMandateHistory).toHaveBeenCalledTimes(2),
    );
    expect(
      within(screen.getByRole("dialog")).getByText("Wird geladen …"),
    ).toBeVisible();
    await act(async () => {
      next.resolve([]);
    });
    expect(await screen.findByText("Noch keine Einträge.")).toBeVisible();
  });

  it("offers a new mandate while none is in force and sends the compacted IBAN", async () => {
    api.fetchSepaMandates.mockResolvedValue([]);
    api.createSepaMandate.mockResolvedValue(MANDATE);
    renderCard();
    expect(await screen.findByText("Kein gültiges Mandat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mandat erfassen" }));
    fireEvent.change(screen.getByLabelText(/IBAN/), {
      target: { value: "de89 3704 0044 0532 0130 01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText(/Diese IBAN stimmt nicht/),
    ).toBeInTheDocument();
    expect(api.createSepaMandate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/IBAN/), {
      target: { value: "de89 3704 0044 0532 0130 00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText(/Datum der Unterschrift wählen/),
    ).toBeInTheDocument();
  });

  it("shows the mask only and no way to a second mandate while one is in force", async () => {
    api.fetchSepaMandates.mockResolvedValue([MANDATE]);
    renderCard();
    expect(
      (await screen.findAllByText("DE•• •••• •••• •••• ••30 00")).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Gültig").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Folgelastschrift").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Mandat erfassen" }),
    ).not.toBeInTheDocument();
  });

  it("asks for a new mandate once the creditor identifier changed", async () => {
    api.fetchSepaMandates.mockResolvedValue([
      { ...MANDATE, creditorCurrent: false },
    ]);
    renderCard();
    expect(
      (await screen.findAllByText("Neues Mandat nötig")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Gilt nicht mehr/)).toBeInTheDocument();
    expect(screen.queryByText("Gültig")).not.toBeInTheDocument();
  });

  it("maps and shows the imported file and line in the mandate history", async () => {
    const original = await vi.importActual<
      typeof import("~/lib/traeger-sepa-api")
    >("~/lib/traeger-sepa-api");
    api.fetchSepaMandates.mockResolvedValue([{ ...MANDATE, source: "import" }]);
    api.fetchSepaMandateHistory.mockImplementation(
      original.fetchSepaMandateHistory,
    );
    bffJson.mockResolvedValue([
      {
        id: 1,
        action: "create",
        source: "import",
        fields: [],
        account_id: 5,
        occurred_at: "2026-09-01T10:00:00+02:00",
        import_file: "ogs-connect.csv",
        import_line: 4,
      },
      {
        id: 2,
        action: "read",
        source: "office",
        fields: [],
        account_id: null,
        occurred_at: "2026-09-01T11:00:00+02:00",
      },
    ]);
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", {
        name: `Aktionen für das Mandat ${MANDATE.reference}`,
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Verlauf ansehen" }));
    expect(
      await screen.findByText("Datei: ogs-connect.csv · Zeile 4"),
    ).toBeInTheDocument();
    expect(bffJson).toHaveBeenCalledWith(
      "org",
      "GET /traeger/sepa-mandates/{id}/history",
      { params: { id: "9" } },
    );
    expect(screen.getAllByText(/^Datei:/)).toHaveLength(1);
  });

  it("stays away for a role without the right „Abrechnung“", async () => {
    let refuse: (error: unknown) => void = () => undefined;
    api.fetchSepaMandates.mockReturnValue(
      new Promise((_, reject) => {
        refuse = reject;
      }),
    );
    renderCard();
    // Anker: while it loads, the card shows its title.
    expect(
      await screen.findByText("SEPA-Lastschriftmandat"),
    ).toBeInTheDocument();
    refuse(new ApiError("forbidden", 403));
    await waitFor(() =>
      expect(
        screen.queryByText("SEPA-Lastschriftmandat"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
