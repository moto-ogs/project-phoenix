import { testClockDay } from "~/test/clock";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setTestClock } from "~/test/clock";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { ApiError } from "~/lib/api-error";
import { SAVED_BUT_STALE_SUFFIX } from "~/lib/hooks/use-refresh-after-write";
import { catalogText } from "~/test/error-catalog-text";
import { PaperSignatureModal } from "~/components/traeger/care-contract-paper-modal";
import type { CareContractDetail } from "~/lib/traeger-care-contracts-api";

const { api, mockPush, mockReplace } = vi.hoisted(() => ({
  api: {
    fetchCareContract: vi.fn(),
    downloadCareContract: vi.fn(),
    sendCareContracts: vi.fn(),
    resendCareContract: vi.fn(),
    discardCareContract: vi.fn(),
    recordPaperSignature: vi.fn(),
    handOverCareContractOnPaper: vi.fn(),
    downloadCareContractVersion: vi.fn(),
  },
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
}));

const links = vi.hoisted(() => ({
  previewContractChildLink: vi.fn(),
  linkContractChild: vi.fn(),
  unlinkContractChild: vi.fn(),
}));

vi.unmock("swr");
// The booked moto modules of the Träger of the session (#6052).
const mockBookedModules = vi.hoisted(() => ({
  current: [
    "traeger_uebersicht",
    "ferienbetreuung",
    "vertraege",
    "elternbeitraege",
  ] as string[],
}));
vi.mock("~/lib/traeger-booked-modules", () => ({
  useTraegerModuleBooked: (module: string) =>
    mockBookedModules.current.includes(module),
}));
vi.mock("~/lib/traeger-care-contracts-api", () => api);
vi.mock("~/lib/traeger-contract-child-links-api", () => links);
const enrollments = vi.hoisted(() => ({ unbindContractEnrollment: vi.fn() }));
vi.mock("~/lib/traeger-contract-enrollments-api", () => enrollments);
// The SEPA mandate card of the family (#4695) answers 403 without the right
// „Abrechnung“; these tests cover the contract and keep it empty.
vi.mock("~/lib/traeger-sepa-api", () => ({
  fetchSepaMandates: vi.fn().mockResolvedValue([]),
  fetchSepaMandateHistory: vi.fn().mockResolvedValue([]),
  createSepaMandate: vi.fn(),
  revokeSepaMandate: vi.fn(),
}));
// The card „Empfänger und Zahlung“ of the family (#7770) has its own tests
// (family-billing-status-card.test.tsx); here the family has no deviation.
vi.mock("~/lib/traeger-billing-terms-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/traeger-billing-terms-api")>()),
  fetchContractFamilyBilling: (contractId: string) =>
    Promise.resolve({
      contractId,
      familyEmail: "",
      partyName: "",
      partyLastName: "",
      family: null,
    }),
}));
// The change requests of the parents (#5979) and the termination (#4682)
// have their own tests; here no change waits and nobody gave notice.
vi.mock("~/lib/care-contract-changes-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/care-contract-changes-api")>()),
  fetchContractChanges: () =>
    Promise.resolve({
      decidable: true,
      pending: mockPendingChanges,
      lastDecision: null,
      reasonRequired: false,
      rosterImpact: null,
    }),
}));
vi.mock("~/lib/care-contract-notices-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/care-contract-notices-api")>()),
  fetchContractNoticeOptions: (contractId: string) =>
    Promise.resolve({
      contractId,
      traegerName: "Träger",
      status: "aktiv",
      childName: "Lina Muster",
      modules: "Frühbetreuung und Offene Ganztagsschule",
      schoolName: "OGS Am Lindenhof",
      terms: "mit 1 Monat Frist zum Monatsende",
      ordinaryEndsOn: "2026-10-31",
      specialEndsOn: null,
      withdrawalUntil: null,
      earlyStart: false,
      reinterpretedEndsOn: null,
      notice: null,
    }),
}));
vi.mock("~/components/ui/pdf-preview", () => ({
  PdfPreview: ({ url, title }: { url: string | null; title: string }) => (
    <div data-testid="pdf-preview" data-loaded={url !== null}>
      {title}
    </div>
  ),
}));
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useParams: () => ({ id: "7" }),
  usePathname: () => "/vertraege/7",
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

// The address of the page; `tab=…` opens a tab (#7408).
let mockSearch = "";
// Changes the parents asked for that wait for a decision.
let mockPendingChanges: unknown[] = [];

/** Opens a tab of the contract page, as a click does. */
function showTab(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }));
}

import TraegerVertragPage from "./page";
import {
  expectPageReloadedAfterRefusal,
  resetPageReloads,
} from "~/test/helpers/refused-refresh";

const DRAFT: CareContractDetail = {
  changeAwaitsSignature: false,
  versionSignatures: [],
  id: "7",
  status: "entwurf",
  schoolId: "3",
  schoolName: "OGS Am Lindenhof",
  childFirstName: "Lina",
  childLastName: "Muster",
  moduleNames: ["Frühbetreuung", "Offene Ganztagsschule"],
  modulesText: "Frühbetreuung und Offene Ganztagsschule",
  partyName: "Erika Muster",
  partyEmail: "erika@example.org",
  effectiveFrom: "2027-08-01",
  createdAt: "2026-09-01T08:00:00Z",
  sentAt: null,
  concluded: null,
  endsOn: null,
  studentId: null,
  imported: false,
  followsBookings: false,
  requestChildId: null,
  version: {
    number: 1,
    effectiveFrom: "2027-08-01",
    endsOn: null,
    childBirthDate: "2019-03-04",
    schoolName: "OGS Am Lindenhof",
    phaseName: "2027/28",
    services: [
      {
        weekday: "mon",
        careOfferingId: "6",
        moduleName: "Frühbetreuung",
        endsAt: "08:00",
        lastDay: null,
      },
      {
        weekday: "mon",
        careOfferingId: "5",
        moduleName: "Offene Ganztagsschule",
        endsAt: "14:00",
        lastDay: null,
      },
      {
        weekday: "tue",
        careOfferingId: "5",
        moduleName: "Offene Ganztagsschule",
        endsAt: "16:30",
        lastDay: null,
      },
    ],
    priceCents: 9500,
    terms: {
      termKind: "school_year",
      termMonths: null,
      noticeMonths: 1,
      noticeTo: "month_end",
      specialTermination: true,
      specialTerminationNote: "Bei Umzug",
      statuteRequired: true,
      statuteTitle: "Satzung über die Elternbeiträge",
      statuteUrl: "https://example.org/satzung",
      contractPartner: "",
    },
    createdAt: "2026-09-01T08:00:00Z",
  },
  parties: [
    {
      firstName: "Erika",
      lastName: "Muster",
      email: "erika@example.org",
      hasAccount: true,
    },
  ],
  mailings: [],
  documentFrozen: false,
  termText: "bis zum Ende des Schuljahres",
  noticeText: "mit 1 Monat Frist zum Monatsende",
  feeText: "95,00 €",
  signature: null,
  reminders: [],
  versions: [],
  corrections: [],
};

function renderPage() {
  render(
    <TraegerResourceTestProvider>
      <TraegerVertragPage />
    </TraegerResourceTestProvider>,
  );
}

describe("TraegerVertragPage", () => {
  it("reads the audited contract and PDF again on a quick reopening", async () => {
    mockSearch = "tab=versionen";
    const page = (open: boolean) => (
      <TraegerResourceTestProvider>
        {open && <TraegerVertragPage />}
      </TraegerResourceTestProvider>
    );
    const view = render(page(true));
    await waitFor(() =>
      expect(screen.getByTestId("pdf-preview")).toHaveAttribute(
        "data-loaded",
        "true",
      ),
    );
    expect(api.fetchCareContract).toHaveBeenCalledTimes(1);
    expect(api.downloadCareContract).toHaveBeenCalledTimes(1);

    view.rerender(page(false));
    view.rerender(page(true));

    await waitFor(() => expect(api.fetchCareContract).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(api.downloadCareContract).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(screen.getByTestId("pdf-preview")).toHaveAttribute(
        "data-loaded",
        "true",
      ),
    );
  });

  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    mockPush.mockReset();
    mockReplace.mockReset();
    mockSearch = "";
    mockPendingChanges = [];
    api.fetchCareContract.mockResolvedValue(DRAFT);
    api.downloadCareContract.mockResolvedValue({
      blob: new Blob(["%PDF"], { type: "application/pdf" }),
      filename: "betreuungsvertrag-7.pdf",
    });
  });

  it("does not ask for signatures on an acceptance-concluded contract", async () => {
    api.fetchCareContract.mockResolvedValue({
      ...DRAFT,
      status: "aktiv",
      documentFrozen: true,
      concluded: { method: "mit_anmeldung", at: "2026-09-01T08:00:00Z" },
    });
    mockSearch = "tab=versand";
    renderPage();
    expect(
      await screen.findByText(
        "Der Vertrag ist bereits mit der Annahme der Anmeldung abgeschlossen.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Eine weitere Unterschrift ist nicht nötig."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Papiervertrag erfassen" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Dann erfasst du den/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Nach dem Senden können die Eltern online unterschreiben.",
      ),
    ).not.toBeInTheDocument();
  });

  it.each([true, false])(
    "shows checksum integrity with the shared notice (intact=%s)",
    async (intact) => {
      api.fetchCareContract.mockResolvedValue({
        ...DRAFT,
        status: "aktiv",
        documentFrozen: true,
        signature: {
          method: "drawn",
          channel: "mail_link",
          signerName: "Erika Muster",
          signedAt: "2026-09-01T08:00:00Z",
          signedOn: "2026-09-01",
          documentSha256: "a".repeat(64),
          earlyStartRequested: false,
          withdrawalEndsOn: "2026-09-15",
          imagePng: "",
          paperFilename: "",
          intact,
        },
      });
      mockSearch = "tab=versand";
      renderPage();
      const checksum = await screen.findByText(
        intact ? "Prüfsumme stimmt" : "Prüfsumme stimmt nicht",
      );
      expect(
        checksum.closest(intact ? '[role="status"]' : '[role="alert"]'),
      ).not.toBeNull();
      expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
    },
  );

  it("does not allow paper signing dates before 2000", async () => {
    setTestClock("2000-01-02T12:00:00+01:00");
    render(
      <TraegerResourceTestProvider>
        <PaperSignatureModal
          contract={DRAFT}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </TraegerResourceTestProvider>,
    );
    fireEvent.click(screen.getByLabelText("Unterschrieben am"));
    const previousMonth = await screen.findByRole("button", {
      name: "Vorheriger Monat",
    });
    fireEvent.click(previousMonth);
    expect(
      await screen.findByRole("button", { name: /31. Dezember 1999/ }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Nächster Monat" }));
    expect(
      await screen.findByRole("button", { name: "Samstag, 1. Januar 2000" }),
    ).toBeEnabled();
  });

  it("marks and focuses a refused paper signing date", async () => {
    api.recordPaperSignature.mockRejectedValue(
      new ApiError("invalid date", 400, {
        code: "care_contract.field_invalid",
        errors: [{ field: "signed_on", reason: "invalid" }],
      }),
    );
    render(
      <TraegerResourceTestProvider>
        <PaperSignatureModal
          contract={DRAFT}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </TraegerResourceTestProvider>,
    );
    fireEvent.change(screen.getByLabelText("PDF wählen"), {
      target: {
        files: [new File(["%PDF"], "vertrag.pdf", { type: "application/pdf" })],
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Vertrag abschließen" }),
    );
    await waitFor(() => expect(api.recordPaperSignature).toHaveBeenCalled());
    const field = screen.getByLabelText("Unterschrieben am");
    await waitFor(() =>
      expect(field).toHaveAttribute("data-form-invalid", "true"),
    );
    const errorId = field.getAttribute("aria-describedby");
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId ?? "")).toHaveTextContent(/.+/);
    await waitFor(() => expect(field).toHaveFocus());
  });

  it("shows what the draft holds", async () => {
    renderPage();

    expect(
      await screen.findByText("Frühbetreuung bis 08:00 Uhr"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Offene Ganztagsschule bis 14:00 Uhr"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Offene Ganztagsschule bis 16:30 Uhr"),
    ).toBeInTheDocument();
    // Wednesday to Friday carry no care.
    expect(screen.getAllByText("Keine Betreuung")).toHaveLength(3);
    expect(
      screen.getByText("bis zum Ende des Schuljahres"),
    ).toBeInTheDocument();
    expect(screen.getByText("95,00 €")).toBeInTheDocument();
    expect(
      screen.getByText(/Die Eltern sehen den Vertrag erst/),
    ).toBeInTheDocument();
    // A discarded draft would take the family's choice with it (#7770),
    // and its mandate too (#7862).
    expect(screen.queryByText("Empfänger und Zahlung")).not.toBeInTheDocument();
    expect(
      screen.queryByText("SEPA-Lastschriftmandat"),
    ).not.toBeInTheDocument();

    showTab("Kündigung");
    expect(
      screen.getByText("mit 1 Monat Frist zum Monatsende"),
    ).toBeInTheDocument();
    // A special termination always ends at the half year (#6349); the
    // note of the terms only names the cases.
    expect(
      screen.getByText("Zum Halbjahr: 31. Januar oder 31. Juli"),
    ).toBeInTheDocument();
    expect(screen.getByText("Bei Umzug")).toBeInTheDocument();
    // The notice above the tabs stays on every tab.
    expect(
      screen.getByText(/Die Eltern sehen den Vertrag erst/),
    ).toBeInTheDocument();

    showTab("Versionen");
    await waitFor(() =>
      expect(screen.getByTestId("pdf-preview")).toHaveAttribute(
        "data-loaded",
        "true",
      ),
    );
  });

  it("names the last day of a module that ends before the contract", async () => {
    api.fetchCareContract.mockResolvedValue({
      ...DRAFT,
      version: {
        ...DRAFT.version,
        services: [
          {
            weekday: "mon",
            careOfferingId: "5",
            moduleName: "Kurzbetreuung",
            endsAt: "14:00",
            lastDay: "2027-07-31",
          },
        ],
      },
    });
    renderPage();

    expect(
      await screen.findByText(
        "Kurzbetreuung bis 14:00 Uhr, gebucht bis 31.07.2027",
      ),
    ).toBeInTheDocument();
  });

  it("sends the draft", async () => {
    api.sendCareContracts.mockResolvedValue({ sent: ["7"], skipped: [] });
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /Vertrag senden/ }),
    );
    // Sending mails the parents and cannot be taken back: it asks first.
    expect(api.sendCareContracts).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", {
      name: "Vertrag senden?",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Vertrag senden" }),
    );

    await waitFor(() =>
      expect(api.sendCareContracts).toHaveBeenCalledWith(["7"]),
    );
    expect(
      await screen.findByText(/Der Vertrag ist unterwegs/),
    ).toBeInTheDocument();
  });

  it("hands a draft over on paper and downloads the frozen PDF", async () => {
    // The paper signature binds what the office printed (#8030): the draft
    // offers the handover, not yet the paper signature.
    mockSearch = "tab=versand";
    api.handOverCareContractOnPaper.mockResolvedValue(undefined);
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Auf Papier übergeben" }),
    );
    expect(
      screen.queryByRole("button", { name: "Papiervertrag erfassen" }),
    ).not.toBeInTheDocument();
    const dialog = await screen.findByRole("dialog", {
      name: "Vertrag auf Papier übergeben?",
    });
    expect(
      within(dialog).getByText(/Die Eltern bekommen keine Mail/),
    ).toBeInTheDocument();
    expect(api.handOverCareContractOnPaper).not.toHaveBeenCalled();
    const previews = api.downloadCareContract.mock.calls.length;
    api.fetchCareContract.mockResolvedValue({
      ...DRAFT,
      status: "versendet",
      sentAt: "2026-09-02T08:00:00Z",
      documentFrozen: true,
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Übergeben und PDF laden" }),
    );

    await waitFor(() =>
      expect(api.handOverCareContractOnPaper).toHaveBeenCalledWith("7"),
    );
    await waitFor(() =>
      expect(api.downloadCareContract.mock.calls.length).toBeGreaterThan(
        previews,
      ),
    );
    expect(api.downloadCareContract).toHaveBeenLastCalledWith("7");
    expect(
      await screen.findByText(/Der Vertrag ist übergeben/),
    ).toBeInTheDocument();
    // Reloaded, the contract waits for the paper signature, without mails.
    expect(
      await screen.findByRole("button", { name: "Papiervertrag erfassen" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Auf Papier übergeben" }),
    ).not.toBeInTheDocument();
  });

  it("names a refused handover and downloads nothing", async () => {
    mockSearch = "tab=versand";
    api.handOverCareContractOnPaper.mockRejectedValue(
      new ApiError("failed", 409, { code: "care_contract.letterhead_missing" }),
    );
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Auf Papier übergeben" }),
    );
    const previews = api.downloadCareContract.mock.calls.length;
    fireEvent.click(
      within(
        await screen.findByRole("dialog", {
          name: "Vertrag auf Papier übergeben?",
        }),
      ).getByRole("button", { name: "Übergeben und PDF laden" }),
    );

    expect(
      await screen.findByText(
        catalogText("care_contract.letterhead_missing", "der Vertrag"),
      ),
    ).toBeInTheDocument();
    expect(api.downloadCareContract).toHaveBeenCalledTimes(previews);
    expect(
      screen.getByRole("button", { name: "Auf Papier übergeben" }),
    ).toBeInTheDocument();
  });

  it("reports a handover whose PDF did not arrive once, with the way to it", async () => {
    // The handover succeeded, the download failed (#8030): no success toast
    // before the file is there, one error that says the contract is handed
    // over and where its PDF is.
    mockSearch = "tab=versand";
    api.handOverCareContractOnPaper.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Auf Papier übergeben" }),
    );
    await waitFor(() => expect(api.downloadCareContract).toHaveBeenCalled());
    const previews = api.downloadCareContract.mock.calls.length;
    api.downloadCareContract.mockRejectedValueOnce(
      new ApiError("Request failed (500)", 500, {}),
    );
    api.fetchCareContract.mockResolvedValue({
      ...DRAFT,
      status: "versendet",
      sentAt: "2026-09-02T08:00:00Z",
      documentFrozen: true,
    });
    fireEvent.click(
      within(
        await screen.findByRole("dialog", {
          name: "Vertrag auf Papier übergeben?",
        }),
      ).getByRole("button", { name: "Übergeben und PDF laden" }),
    );

    expect(
      await screen.findByText(/Der Vertrag ist trotzdem übergeben/),
    ).toBeInTheDocument();
    expect(api.downloadCareContract.mock.calls.length).toBeGreaterThan(
      previews,
    );
    expect(
      screen.queryByText(/Der Vertrag ist übergeben\./),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Vertrag auf Papier übergeben?" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole("button", { name: "Papiervertrag erfassen" }),
    ).toBeInTheDocument();
  });

  it("offers a draft's PDF as a preview, a handed-over one as the PDF", async () => {
    // Only the frozen PDF is for signing (#8030): the draft's menu names
    // its download a preview.
    renderPage();
    await screen.findByRole("button", { name: "Vertrag senden" });
    const [menu] = screen.getAllByRole("button", { name: "Weitere Aktionen" });
    fireEvent.click(menu!);
    expect(
      screen.getByRole("menuitem", { name: /Vorschau herunterladen/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /PDF herunterladen/ }),
    ).not.toBeInTheDocument();
  });

  it("waits for the paper signature of a contract handed over on paper", async () => {
    api.fetchCareContract.mockResolvedValue({
      ...DRAFT,
      status: "versendet",
      sentAt: "2026-09-02T08:00:00Z",
      documentFrozen: true,
    });
    renderPage();

    // No mail went out yet: mailing it is a first send, not a second.
    expect(
      await screen.findByRole("button", { name: "Vertrag senden" }),
    ).toBeInTheDocument();
    showTab("Unterschrift und Versand");
    expect(
      screen.getByText("Die Eltern unterschreiben den Vertrag auf Papier."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Erinnerungen per Mail gibt es dafür nicht/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Auf Papier übergeben, nicht per Mail."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Papiervertrag erfassen" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Auf Papier übergeben" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["stopped", /Die Schule hat die Mails an diese Person gestoppt/],
    ["address", /bei einer deiner Schulen gesperrt/],
    ["provider", /moto-Support/],
    ["provider_unknown", /später noch einmal/],
    ["delayed", /nicht noch einmal/],
  ] as const)(
    "names the reason of a %s block and offers no second mail",
    async (sendBlock, text) => {
      api.fetchCareContract.mockResolvedValue({
        ...DRAFT,
        status: "versendet",
        documentFrozen: true,
        mailings: [
          {
            recipient: "erika@example.org",
            sentAt: "2026-09-02T08:00:00Z",
            state: sendBlock === "delayed" ? "sent" : "failed",
            outcome: sendBlock === "delayed" ? "delayed" : "provider_blocked",
            sendBlock,
          },
        ],
      });
      renderPage();

      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(screen.queryByText(/Prüfe die Adresse/)).toBeNull();
      const resend = screen.getByRole("button", { name: "Erneut senden" });
      expect(resend).toHaveAttribute("aria-disabled", "true");
      expect(resend).toHaveAccessibleDescription(expect.stringMatching(/\S/));
      fireEvent.click(resend);
      expect(api.sendCareContracts).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["unsubscribed", "Abgemeldet", /abgemeldet/],
    [
      "complained",
      "Als unerwünscht gemeldet",
      /hat eine Mail als unerwünscht gemeldet/,
    ],
  ] as const)(
    "does not read a %s mail as sent",
    async (outcome, label, text) => {
      api.fetchCareContract.mockResolvedValue({
        ...DRAFT,
        status: "versendet",
        documentFrozen: true,
        mailings: [
          {
            recipient: "erika@example.org",
            sentAt: "2026-09-02T08:00:00Z",
            state: "failed",
            outcome,
          },
        ],
      });
      renderPage();

      expect(await screen.findByText(text)).toBeInTheDocument();
      // The notice names „Versand“ for another address and leads there,
      // also from another tab (#7408).
      fireEvent.click(screen.getByRole("button", { name: "Zum Versand" }));
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: "Versand" })).toHaveFocus(),
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByText("Gesendet")).toBeNull();
    },
  );

  it("offers a new mail once the block is gone", async () => {
    api.fetchCareContract.mockResolvedValue({
      ...DRAFT,
      status: "versendet",
      documentFrozen: true,
      mailings: [
        {
          recipient: "erika@example.org",
          sentAt: "2026-09-02T08:00:00Z",
          state: "failed",
          outcome: "provider_blocked",
        },
      ],
    });
    renderPage();

    expect(await screen.findByText(/besteht nicht mehr/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erneut senden" })).toBeEnabled();
  });

  it("refreshes a queued delivery and enables retry when it fails", async () => {
    const pending: CareContractDetail = {
      ...DRAFT,
      status: "versendet",
      sentAt: "2026-09-02T08:00:00Z",
      documentFrozen: true,
      mailings: [
        {
          recipient: "erika@example.org",
          sentAt: "2026-09-02T08:00:00Z",
          state: "queued",
        },
      ],
    };
    api.fetchCareContract.mockResolvedValueOnce(pending).mockResolvedValue({
      ...pending,
      mailings: [{ ...pending.mailings[0]!, state: "failed" }],
    });
    renderPage();
    expect(
      await screen.findByRole("button", { name: "Erneut senden" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText(/Die Mail wartet auf den Versand/),
    ).toBeInTheDocument();
    // The notice leads to the card it names (#7054), in its tab (#7408).
    fireEvent.click(screen.getByRole("button", { name: "Zum Versand" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Versand" })).toHaveFocus(),
    );
    expect(
      screen.getByRole("tab", { name: "Unterschrift und Versand" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(mockReplace).toHaveBeenCalledWith("/vertraege/7?tab=versand", {
      scroll: false,
    });
    // Checking the delivery sits with the mail history in „Versand“.
    fireEvent.click(
      screen.getByRole("button", { name: "Versand aktualisieren" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Erneut senden" }),
      ).toBeEnabled(),
    );
    expect(screen.getByText(/kam nicht an/)).toBeInTheDocument();
  });

  it.each(["versendet", "aktiv"] as const)(
    "retries a failed %s contract at the entered address without changing it",
    async (status) => {
      api.fetchCareContract.mockResolvedValue({
        ...DRAFT,
        status,
        documentFrozen: true,
        mailings: [
          {
            recipient: "alt@example.org",
            sentAt: "2026-09-02T08:00:00Z",
            state: "failed",
          },
        ],
      });
      api.resendCareContract.mockResolvedValue({ sent: ["7"], skipped: [] });
      mockSearch = "tab=versand";
      renderPage();
      fireEvent.change(await screen.findByLabelText("Neue Versandadresse"), {
        target: { value: "neu@example.org" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "An diese Adresse senden" }),
      );
      await waitFor(() =>
        expect(api.resendCareContract).toHaveBeenCalledWith(
          "7",
          "neu@example.org",
        ),
      );
      expect(
        await screen.findByText(
          "Der Vertrag ist an die neue Adresse unterwegs.",
        ),
      ).toBeInTheDocument();
      expect(api.sendCareContracts).not.toHaveBeenCalled();
    },
  );

  it("shows an unknown delivery result without claiming success", async () => {
    api.fetchCareContract.mockResolvedValue({
      ...DRAFT,
      status: "versendet",
      sentAt: "2026-09-02T08:00:00Z",
      documentFrozen: true,
      mailings: [
        {
          recipient: "erika@example.org",
          sentAt: "2026-09-02T08:00:00Z",
          state: "unknown",
        },
      ],
    });
    renderPage();
    expect(
      await screen.findByText(/Das Ergebnis des Mail-Versands ist unbekannt/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Die Eltern haben den Vertrag/),
    ).not.toBeInTheDocument();
  });

  it("offers to send a sent contract again and no discard", async () => {
    api.fetchCareContract.mockResolvedValue({
      ...DRAFT,
      status: "versendet",
      sentAt: "2026-09-02T08:00:00Z",
      documentFrozen: true,
      mailings: [
        {
          recipient: "erika@example.org",
          sentAt: "2026-09-02T08:00:00Z",
          state: "sent",
        },
      ],
    });
    renderPage();

    expect(
      await screen.findByRole("button", { name: /Erneut senden/ }),
    ).toBeEnabled();
    expect(
      screen.getByText(/Die Mail ging an erika@example.org/),
    ).toBeInTheDocument();
    // A sent contract cannot be discarded: its family sets how it pays
    // and gives its mandate.
    expect(
      await screen.findByText("Empfänger und Zahlung"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("SEPA-Lastschriftmandat"),
    ).toBeInTheDocument();
    showTab("Unterschrift und Versand");
    expect(screen.getByText("Gesendet")).toBeInTheDocument();
    showTab("Versionen");
    expect(screen.getByText("PDF für die Eltern")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Vertrag senden/ }),
    ).not.toBeInTheDocument();
  });

  it("offers neither payment nor mandate without the module Elternbeiträge und Abrechnung (#6052)", async () => {
    // Both cards read routes of that module; a Träger with Verträge alone
    // keeps its contracts without them.
    mockBookedModules.current = ["vertraege"];
    try {
      api.fetchCareContract.mockResolvedValue({
        ...DRAFT,
        status: "versendet",
        documentFrozen: true,
      });
      renderPage();

      expect(
        await screen.findByText("E-Mail bei Vertragserstellung"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Empfänger und Zahlung"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("SEPA-Lastschriftmandat"),
      ).not.toBeInTheDocument();
    } finally {
      mockBookedModules.current = [
        "traeger_uebersicht",
        "ferienbetreuung",
        "vertraege",
        "elternbeitraege",
      ];
    }
  });

  it("offers no payment card on a contract that is over", async () => {
    // What is saved goes with the contract it was saved through, and a
    // contract that is over is deleted first (#7770).
    api.fetchCareContract.mockResolvedValue({
      ...DRAFT,
      status: "beendet",
      documentFrozen: true,
    });
    renderPage();

    expect(
      await screen.findByText("E-Mail bei Vertragserstellung"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Empfänger und Zahlung")).not.toBeInTheDocument();
  });

  it("offers no payment card after the last day of a terminated contract", async () => {
    api.fetchCareContract.mockResolvedValue({
      ...DRAFT,
      status: "gekuendigt",
      endsOn: testClockDay(-1),
      documentFrozen: true,
    });
    renderPage();

    expect(
      await screen.findByText("E-Mail bei Vertragserstellung"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Empfänger und Zahlung")).not.toBeInTheDocument();
  });

  it("keeps a concluded contract unchanged and allows resending", async () => {
    api.fetchCareContract.mockResolvedValue({
      ...DRAFT,
      status: "aktiv",
      sentAt: "2026-09-03T08:00:00Z",
      concluded: { method: "mit_anmeldung", at: "2026-09-03T08:00:00Z" },
      mailings: [
        {
          recipient: "erika@example.org",
          sentAt: "2026-09-03T08:00:00Z",
          state: "sent",
        },
      ],
      documentFrozen: true,
    });
    renderPage();

    expect(
      await screen.findByText(
        /Der Vertrag gilt seit der Annahme der Anmeldung am 03\.09\.2026/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Am 03.09.2026 um 10:00 Uhr, bei der Annahme der Anmeldung",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("So steht es im abgeschlossenen Vertrag."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Aktiv")[0]).toBeInTheDocument();
    // An active contract shows its download in the head; resending sits
    // with the mail history in „Versand“. A concluded contract offers no
    // discarding.
    expect(
      screen.getByRole("button", { name: "PDF herunterladen" }),
    ).toBeInTheDocument();
    showTab("Unterschrift und Versand");
    expect(
      screen.getByRole("button", { name: /Erneut senden/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /Entwurf verwerfen/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Entwurf verwerfen/ }),
    ).not.toBeInTheDocument();
    // Resending asks first and names the recipient.
    fireEvent.click(screen.getByRole("button", { name: /Erneut senden/ }));
    const dialog = await screen.findByRole("dialog", {
      name: "Vertrag noch einmal senden?",
    });
    expect(within(dialog).getByText(/erika@example\.org/)).toBeInTheDocument();
    expect(api.resendCareContract).not.toHaveBeenCalled();
  });

  it("shows a completed imported contract without inventing its day", async () => {
    api.fetchCareContract.mockResolvedValue({
      ...DRAFT,
      status: "aktiv",
      concluded: {
        method: "papier",
        // A stand-in instant: the office does not know the day.
        at: "2026-08-01T00:00:00Z",
        takenOver: true,
        dateUnknown: true,
      },
      parties: [
        {
          firstName: "Erika",
          lastName: "Muster",
          email: "erika@example.org",
          hasAccount: true,
        },
        { firstName: "Jan", lastName: "Muster", email: "", hasAccount: false },
      ],
      documentFrozen: true,
      corrections: [
        {
          correctedAt: "2026-09-08T10:00:00Z",
          file: "vertraege-nachgepflegt.csv",
          evidence: "Vertrag-Muster.pdf",
          changes: ["parties", "concluded_on"],
          before: {
            parties: ["Erika Muster"],
            method: "papier",
            concludedOn: "2026-03-12",
            dateUnknown: false,
          },
          after: {
            parties: ["Erika Muster", "Jan Muster"],
            method: "papier",
            concludedOn: null,
            dateUnknown: true,
          },
        },
      ],
    });
    renderPage();

    expect(
      await screen.findByText("Abschlussdatum unbekannt, auf Papier"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/01\.08\.2026/)).not.toBeInTheDocument();
    // Every party of the contract, not only the first.
    const parents = screen
      .getByRole("heading", { name: "Eltern" })
      .closest("section");
    if (!parents) throw new Error("card missing");
    expect(within(parents).getByText("Erika Muster")).toBeInTheDocument();
    expect(within(parents).getByText("Jan Muster")).toBeInTheDocument();
    expect(
      within(parents).getByText("Keine E-Mail-Adresse"),
    ).toBeInTheDocument();

    const card = screen
      .getByRole("heading", { name: "Nachgepflegte Angaben" })
      .closest("section");
    if (!card) throw new Error("card missing");
    const corrections = within(card);
    expect(
      corrections.getByText("Nachgepflegt am 08.09.2026"),
    ).toBeInTheDocument();
    expect(corrections.getByText("Vertrag-Muster.pdf")).toBeInTheDocument();
    expect(corrections.getByText("12.03.2026").tagName).toBe("DEL");
    expect(corrections.getByText("Unbekannt").tagName).toBe("INS");
    expect(corrections.getByText("Jan Muster").tagName).toBe("INS");
  });

  it("follows the address after a tab click and browser navigation", async () => {
    const view = render(
      <TraegerResourceTestProvider>
        <TraegerVertragPage />
      </TraegerResourceTestProvider>,
    );
    fireEvent.click(await screen.findByRole("tab", { name: "Versionen" }));
    expect(screen.getByRole("tab", { name: "Versionen" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(mockReplace).toHaveBeenCalledWith("/vertraege/7?tab=versionen", {
      scroll: false,
    });

    // The router catches up. This also clears the optimistic click state.
    mockSearch = "tab=versionen";
    view.rerender(
      <TraegerResourceTestProvider>
        <TraegerVertragPage />
      </TraegerResourceTestProvider>,
    );
    expect(screen.getByRole("tab", { name: "Versionen" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Browser back must now use the address instead of the stale click.
    mockSearch = "";
    view.rerender(
      <TraegerResourceTestProvider>
        <TraegerVertragPage />
      </TraegerResourceTestProvider>,
    );
    expect(screen.getByRole("tab", { name: "Vertrag" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // A link to another tab of the same contract wins too.
    mockSearch = "tab=kuendigung";
    view.rerender(
      <TraegerResourceTestProvider>
        <TraegerVertragPage />
      </TraegerResourceTestProvider>,
    );
    expect(screen.getByRole("tab", { name: "Kündigung" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("counts a waiting change of the parents on its tab", async () => {
    mockPendingChanges = [
      {
        id: "41",
        version: "v-41",
        submittedAt: "2026-09-01T08:15:00Z",
        effectiveFrom: "2026-10-05",
        parentNote: "",
        endsAllCare: false,
        lines: [
          {
            careOfferingId: "5",
            moduleName: "Offene Ganztagsschule",
            state: "changed",
            beforeDays: ["mon", "tue"],
            afterDays: ["mon", "wed"],
          },
        ],
      },
    ];
    api.fetchCareContract.mockResolvedValue({
      ...DRAFT,
      status: "aktiv",
      documentFrozen: true,
      concluded: { method: "mit_anmeldung", at: "2026-09-01T08:00:00Z" },
    });
    renderPage();

    const tab = await screen.findByRole("tab", {
      name: /Unterschrift und Versand/,
    });
    await waitFor(() => expect(within(tab).getByText("1")).toBeInTheDocument());
    fireEvent.click(tab);
    expect(
      await screen.findByText("Wartet auf Entscheidung"),
    ).toBeInTheDocument();
  });

  it("shows the versions of an active contract and from when a change applies", async () => {
    // Die Änderung ab 01.03.2027 muss noch bevorstehen.
    setTestClock("2026-09-09T12:00:00+02:00");
    const first = DRAFT.version.services;
    api.fetchCareContract.mockResolvedValue({
      ...DRAFT,
      status: "aktiv",
      sentAt: "2026-07-20T08:00:00Z",
      concluded: { method: "mit_anmeldung", at: "2026-07-20T08:00:00Z" },
      documentFrozen: true,
      version: { ...DRAFT.version, effectiveFrom: "2026-08-01" },
      versions: [
        {
          number: 1,
          status: "abgeloest",
          source: "abschluss",
          effectiveFrom: "2026-08-01",
          endsOn: "2027-02-28",
          validUntil: "2027-02-28",
          services: first,
          createdAt: "2026-07-20T08:00:00Z",
        },
        {
          number: 2,
          status: "wirksam",
          source: "buchungsaenderung",
          effectiveFrom: "2027-03-01",
          endsOn: null,
          validUntil: null,
          services: [
            ...first.slice(0, 2),
            {
              weekday: "wed",
              careOfferingId: "5",
              moduleName: "Offene Ganztagsschule",
              endsAt: "16:30",
              lastDay: null,
            },
          ],
          createdAt: "2026-09-01T08:00:00Z",
        },
      ],
    } satisfies CareContractDetail);
    api.downloadCareContractVersion.mockResolvedValue({
      blob: new Blob(["%PDF"], { type: "application/pdf" }),
      filename: "betreuungsvertrag-7-version-2.pdf",
    });
    renderPage();

    expect(
      await screen.findByText(
        "Ab 01.03.2027 gilt Version 2. Eine Änderung der Betreuung ist freigegeben. Was sich ändert, steht unter „Versionen“.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zu den Versionen" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Versionen" })).toHaveFocus(),
    );
    expect(screen.getByText("Gilt jetzt")).toBeInTheDocument();
    expect(screen.getByText("Gilt ab 01.03.2027")).toBeInTheDocument();
    expect(
      screen.getByText("01.08.2026 bis 28.02.2027 · Vertragsabschluss"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "ab 01.03.2027 · Änderung der Betreuung · 2 Tage geändert",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Geändert")).toHaveLength(2);

    fireEvent.click(
      screen.getByRole("button", { name: "PDF von Version 2 herunterladen" }),
    );
    await waitFor(() =>
      expect(api.downloadCareContractVersion).toHaveBeenCalledWith("7", 2),
    );
  });

  it("announces no change for a contract that only starts later", async () => {
    // Der Vertrag ab 01.08.2027 muss noch bevorstehen.
    setTestClock("2026-09-09T12:00:00+02:00");
    api.fetchCareContract.mockResolvedValue({
      ...DRAFT,
      status: "aktiv",
      sentAt: "2026-07-20T08:00:00Z",
      concluded: { method: "mit_anmeldung", at: "2026-07-20T08:00:00Z" },
      documentFrozen: true,
      versions: [
        {
          number: 1,
          status: "wirksam",
          source: "abschluss",
          effectiveFrom: "2027-08-01",
          endsOn: null,
          validUntil: null,
          services: DRAFT.version.services,
          createdAt: "2026-07-20T08:00:00Z",
        },
      ],
    } satisfies CareContractDetail);
    mockSearch = "tab=versionen";
    renderPage();

    expect(await screen.findByText("Gilt ab 01.08.2027")).toBeInTheDocument();
    expect(screen.queryByText(/gilt Version 1/)).not.toBeInTheDocument();
  });

  it("lists a change that goes in front of a planned version by its date", async () => {
    // Beide Änderungen ab Februar und März 2027 müssen noch bevorstehen.
    setTestClock("2026-09-09T12:00:00+02:00");
    const monday = DRAFT.version.services.slice(0, 2);
    const late = { ...monday[1]!, endsAt: "16:30" };
    const version = (
      number: number,
      status: "wirksam" | "abgeloest",
      effectiveFrom: string,
      validUntil: string | null,
      services: CareContractDetail["version"]["services"],
    ) => ({
      number,
      status,
      source:
        number === 1 ? ("abschluss" as const) : ("buchungsaenderung" as const),
      effectiveFrom,
      endsOn: null,
      validUntil,
      services,
      createdAt: "2026-09-01T08:00:00Z",
    });
    api.fetchCareContract.mockResolvedValue({
      ...DRAFT,
      status: "aktiv",
      sentAt: "2026-07-20T08:00:00Z",
      concluded: { method: "mit_anmeldung", at: "2026-07-20T08:00:00Z" },
      documentFrozen: true,
      versions: [
        version(1, "abgeloest", "2026-08-01", "2027-01-31", monday),
        version(2, "wirksam", "2027-03-01", null, [
          ...monday,
          { ...monday[1]!, weekday: "wed" },
        ]),
        {
          ...version(3, "abgeloest", "2027-02-01", "2027-02-28", [
            monday[0]!,
            late,
          ]),
          endsOn: "2027-07-31",
        },
      ],
    } satisfies CareContractDetail);
    mockSearch = "tab=versionen";
    renderPage();

    const headings = await screen.findAllByRole("heading", { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Version 2",
      "Version 3",
      "Version 1",
    ]);
    expect(
      screen.getByText(
        "Ab 01.02.2027 gilt Version 3. Eine Änderung der Betreuung ist freigegeben. Was sich ändert, steht unter „Versionen“.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "01.02.2027 bis 28.02.2027 · Änderung der Betreuung · 1 Tag geändert",
      ),
    ).toBeInTheDocument();
  });
  it.each([403, 404, 503])(
    "handles a %s contract reload after sending",
    async (status) => {
      api.fetchCareContract
        .mockResolvedValueOnce(DRAFT)
        .mockRejectedValueOnce(new ApiError("failed", status));
      api.sendCareContracts.mockResolvedValue({ sent: 1, skipped: [] });
      renderPage();
      const send = await screen.findByRole("button", {
        name: "Vertrag senden",
      });
      resetPageReloads();
      fireEvent.click(send);
      // Sending asks first: confirm in the dialog.
      fireEvent.click(
        within(
          await screen.findByRole("dialog", { name: "Vertrag senden?" }),
        ).getByRole("button", { name: "Vertrag senden" }),
      );
      if (status === 404) {
        expect(
          await screen.findByText(catalogText("general.input", "der Vertrag")),
        ).toBeVisible();
        expect(screen.queryByText("Vertragsangaben")).not.toBeInTheDocument();
        expect(screen.queryByTestId("pdf-preview")).not.toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: "Erneut senden" }),
        ).not.toBeInTheDocument();
        expect(api.sendCareContracts).toHaveBeenCalledTimes(1);
        return;
      }
      if (status === 403) {
        // #6801: the page loads anew; its first load shows the refusal.
        await expectPageReloadedAfterRefusal();
        expect(api.sendCareContracts).toHaveBeenCalledTimes(1);
        return;
      }
      // Anker: der Nachladefehler bestätigt den bereits erfolgten Versand.
      expect(
        await screen.findByText(
          `${catalogText("general.unavailable", "die Anzeige des Vertrags")} ${SAVED_BUT_STALE_SUFFIX}`,
        ),
      ).toBeVisible();
      expect(screen.getByText("Vertragsangaben")).toBeVisible();
      showTab("Versionen");
      expect(screen.getByTestId("pdf-preview")).toBeVisible();
      expect(api.sendCareContracts).toHaveBeenCalledTimes(1);
    },
  );

  // #6652: after a confirmed send a failed reload is a load error above the
  // contract, not a failed send or a page error that replaces the contract.
  describe("reload after a write (#6652)", () => {
    const reloadText = `${catalogText(
      "general.unavailable",
      "die Anzeige des Vertrags",
    )} ${SAVED_BUT_STALE_SUFFIX}`;
    const down = () =>
      new ApiError("down", 503, { code: "general.unavailable" });
    const FAILED_MAIL: CareContractDetail = {
      ...DRAFT,
      status: "versendet",
      documentFrozen: true,
      mailings: [
        {
          recipient: "alt@example.org",
          sentAt: "2026-09-02T08:00:00Z",
          state: "failed",
        },
      ],
    };

    it("keeps a sent contract sent when the reload fails", async () => {
      api.sendCareContracts.mockResolvedValue({ sent: ["7"], skipped: [] });
      renderPage();
      const sendButton = await screen.findByRole("button", {
        name: /Vertrag senden/,
      });
      api.fetchCareContract.mockClear();
      // Sent by mail, the contract holds its mailing; without one it was
      // handed over on paper (#8030).
      api.fetchCareContract.mockRejectedValueOnce(down()).mockResolvedValue({
        ...DRAFT,
        status: "versendet",
        documentFrozen: true,
        mailings: [
          {
            recipient: "erika@example.org",
            sentAt: "2026-09-02T08:00:00Z",
            state: "sent",
          },
        ],
      });

      fireEvent.click(sendButton);
      // Sending asks first: confirm in the dialog.
      fireEvent.click(
        within(
          await screen.findByRole("dialog", { name: "Vertrag senden?" }),
        ).getByRole("button", { name: "Vertrag senden" }),
      );

      expect(await screen.findByText(reloadText)).toBeInTheDocument();
      expect(api.sendCareContracts).toHaveBeenCalledTimes(1);
      // Anker: the contract stays shown.
      expect(screen.getByText("Vertragsangaben")).toBeInTheDocument();
      expect(
        screen.queryByText(catalogText("general.unavailable", "der Vertrag")),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
      expect(
        await screen.findByRole("button", { name: "Erneut senden" }),
      ).toBeInTheDocument();
      expect(screen.queryByText(reloadText)).not.toBeInTheDocument();
      expect(api.fetchCareContract).toHaveBeenCalledTimes(2);
      expect(api.sendCareContracts).toHaveBeenCalledTimes(1);
    });

    it("keeps a contract resent to a new address when the reload fails", async () => {
      api.fetchCareContract.mockResolvedValue(FAILED_MAIL);
      api.resendCareContract.mockResolvedValue({ sent: ["7"], skipped: [] });
      mockSearch = "tab=versand";
      renderPage();
      fireEvent.change(await screen.findByLabelText("Neue Versandadresse"), {
        target: { value: "neu@example.org" },
      });
      api.fetchCareContract.mockClear();
      api.fetchCareContract.mockRejectedValueOnce(down()).mockResolvedValue({
        ...FAILED_MAIL,
        mailings: [
          {
            recipient: "neu@example.org",
            sentAt: "2026-09-09T10:00:00Z",
            state: "queued",
          },
          ...FAILED_MAIL.mailings,
        ],
      });

      fireEvent.click(
        screen.getByRole("button", { name: "An diese Adresse senden" }),
      );

      expect(await screen.findByText(reloadText)).toBeInTheDocument();
      expect(api.resendCareContract).toHaveBeenCalledTimes(1);
      // Anker: the contract stays shown.
      expect(
        screen.getByRole("heading", { name: "Versand" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          catalogText("general.unavailable", "die Versandadresse"),
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(catalogText("general.unavailable", "der Vertrag")),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
      expect(
        await screen.findByText(/Die Mail wartet auf den Versand/),
      ).toBeInTheDocument();
      expect(screen.queryByText(reloadText)).not.toBeInTheDocument();
      expect(api.fetchCareContract).toHaveBeenCalledTimes(2);
      expect(api.resendCareContract).toHaveBeenCalledTimes(1);
    });
  });

  describe("Kinderakte eines importierten Vertrags (#7760)", () => {
    const IMPORTED: CareContractDetail = {
      ...DRAFT,
      status: "aktiv",
      imported: true,
      concluded: { method: "papier", at: "2026-09-01T08:00:00Z" },
    };

    it("names the contract number and what an unlinked import misses", async () => {
      api.fetchCareContract.mockResolvedValue(IMPORTED);
      renderPage();
      expect(await screen.findByText("Nicht verknüpft")).toBeInTheDocument();
      expect(screen.getByText("Vertrag Nr.")).toBeInTheDocument();
      expect(
        screen.getByText(/fehlen der Soll-Ist-Vergleich/),
      ).toBeInTheDocument();
      links.previewContractChildLink.mockResolvedValueOnce({
        line: 1,
        status: "ready",
        contractId: "7",
        studentId: "12",
        schoolName: "OGS Am Lindenhof",
        contract: { firstName: "Lina", lastName: "Muster", birthDate: null },
        student: { firstName: "Lina", lastName: "Muster", birthDate: null },
        problems: [],
        repeatsLine: null,
        otherContractId: null,
        fingerprint: "fp-12",
      });
      links.linkContractChild.mockResolvedValueOnce({});
      api.fetchCareContract.mockResolvedValue({ ...IMPORTED, studentId: "12" });
      fireEvent.click(
        screen.getByRole("button", { name: "Mit Kinderakte verknüpfen" }),
      );
      fireEvent.change(await screen.findByLabelText(/Nummer der Kinderakte/), {
        target: { value: "12" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Prüfen" }));
      fireEvent.click(
        await screen.findByRole("button", { name: "Verknüpfen" }),
      );
      expect(
        await screen.findByText(
          "Der Vertrag ist jetzt mit der Kinderakte verknüpft.",
        ),
      ).toBeInTheDocument();
      expect(await screen.findByText("Nr. 12")).toBeInTheDocument();
      expect(links.linkContractChild).toHaveBeenCalledWith(
        "7",
        "12",
        false,
        "fp-12",
      );
    });

    it("unlinks after a confirmation that says what stays", async () => {
      api.fetchCareContract.mockResolvedValue({ ...IMPORTED, studentId: "12" });
      renderPage();
      expect(await screen.findByText("Nr. 12")).toBeInTheDocument();
      const [menu] = screen.getAllByRole("button", {
        name: "Weitere Aktionen",
      });
      fireEvent.click(menu!);
      fireEvent.click(
        screen.getByRole("menuitem", { name: /Verknüpfung lösen/ }),
      );
      expect(
        await screen.findByText(/Schon ausgestellte Rechnungen bleiben/),
      ).toBeInTheDocument();
      links.unlinkContractChild.mockResolvedValueOnce(undefined);
      api.fetchCareContract.mockResolvedValue(IMPORTED);
      fireEvent.click(
        screen.getByRole("button", { name: "Verknüpfung lösen" }),
      );
      expect(
        await screen.findByText(
          "Die Verknüpfung mit der Kinderakte ist gelöst.",
        ),
      ).toBeInTheDocument();
      expect(links.unlinkContractChild).toHaveBeenCalledWith("7", "12");
      expect(await screen.findByText("Nicht verknüpft")).toBeInTheDocument();
    });

    it("shows the contract again when another child record was linked since", async () => {
      api.fetchCareContract.mockResolvedValue({ ...IMPORTED, studentId: "12" });
      renderPage();
      expect(await screen.findByText("Nr. 12")).toBeInTheDocument();
      const [menu] = screen.getAllByRole("button", {
        name: "Weitere Aktionen",
      });
      fireEvent.click(menu!);
      fireEvent.click(
        screen.getByRole("menuitem", { name: /Verknüpfung lösen/ }),
      );
      await screen.findByText(/Schon ausgestellte Rechnungen bleiben/);
      links.unlinkContractChild.mockRejectedValueOnce(
        new ApiError("Request failed (409)", 409, {
          code: "care_contract.child_link_changed",
        }),
      );
      api.fetchCareContract.mockResolvedValue({ ...IMPORTED, studentId: "13" });
      fireEvent.click(
        screen.getByRole("button", { name: "Verknüpfung lösen" }),
      );
      expect(
        await screen.findByText(
          catalogText("care_contract.child_link_changed", "die Verknüpfung"),
        ),
      ).toBeInTheDocument();
      expect(links.unlinkContractChild).toHaveBeenCalledWith("7", "12");
      expect(await screen.findByText("Nr. 13")).toBeInTheDocument();
      expect(
        screen.queryByText(/Schon ausgestellte Rechnungen bleiben/),
      ).not.toBeInTheDocument();
    });

    it("keeps the link of a contract a colleague bound meanwhile, without an error log", async () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      api.fetchCareContract.mockResolvedValue({ ...IMPORTED, studentId: "12" });
      renderPage();
      expect(await screen.findByText("Nr. 12")).toBeInTheDocument();
      const [menu] = screen.getAllByRole("button", {
        name: "Weitere Aktionen",
      });
      fireEvent.click(menu!);
      fireEvent.click(
        screen.getByRole("menuitem", { name: /Verknüpfung lösen/ }),
      );
      await screen.findByText(/Schon ausgestellte Rechnungen bleiben/);
      links.unlinkContractChild.mockRejectedValueOnce(
        new ApiError("Request failed (409)", 409, {
          code: "care_contract.child_link_bound",
        }),
      );
      api.fetchCareContract.mockResolvedValue({
        ...IMPORTED,
        studentId: "12",
        followsBookings: true,
        requestChildId: "128",
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Verknüpfung lösen" }),
      );
      expect(
        await screen.findByText(
          catalogText("care_contract.child_link_bound", "die Verknüpfung"),
        ),
      ).toBeInTheDocument();
      expect(
        await screen.findByText("Anmeldung nachgetragen"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Schon ausgestellte Rechnungen bleiben/),
      ).not.toBeInTheDocument();
      expect(errors).not.toHaveBeenCalledWith(
        expect.stringContaining("traeger_care_contract_unlink_child_failed"),
        expect.anything(),
      );
      errors.mockRestore();
    });

    describe("Bindung an die Anmeldung (ADR 0309)", () => {
      const BOUND: CareContractDetail = {
        ...IMPORTED,
        studentId: "12",
        followsBookings: true,
        requestChildId: "128",
      };

      async function openUnbind() {
        renderPage();
        expect(
          await screen.findByText("Anmeldung nachgetragen"),
        ).toBeInTheDocument();
        const [menu] = screen.getAllByRole("button", {
          name: "Weitere Aktionen",
        });
        fireEvent.click(menu!);
        // A bound contract keeps its child record: only the binding comes off.
        expect(
          screen.queryByRole("menuitem", { name: /^Verknüpfung lösen/ }),
        ).not.toBeInTheDocument();
        fireEvent.click(
          screen.getByRole("menuitem", {
            name: /Bindung an die Anmeldung lösen/,
          }),
        );
        await screen.findByRole("dialog", {
          name: "Bindung an die Anmeldung lösen?",
        });
      }

      it("marks the contract and says it follows the bookings", async () => {
        api.fetchCareContract.mockResolvedValue(BOUND);
        renderPage();
        expect(
          await screen.findByText("Anmeldung nachgetragen"),
        ).toBeInTheDocument();
        expect(
          screen.getByText(
            /Der Vertrag folgt jetzt den Buchungen der Anmeldung an der Schule/,
          ),
        ).toBeInTheDocument();
      });

      it("unbinds the enrollment the office saw, after saying what stays", async () => {
        api.fetchCareContract.mockResolvedValue(BOUND);
        await openUnbind();
        expect(
          screen.getByText(
            /Die Anmeldung und ihre Buchungen bleiben an der Schule/,
          ),
        ).toBeInTheDocument();
        expect(
          screen.getByText(/die Verknüpfung mit der Kinderakte lösen/),
        ).toBeInTheDocument();
        enrollments.unbindContractEnrollment.mockResolvedValueOnce(undefined);
        api.fetchCareContract.mockResolvedValue({
          ...BOUND,
          followsBookings: false,
          requestChildId: null,
        });
        fireEvent.click(screen.getByRole("button", { name: "Bindung lösen" }));
        expect(
          await screen.findByText("Die Bindung an die Anmeldung ist gelöst."),
        ).toBeInTheDocument();
        expect(enrollments.unbindContractEnrollment).toHaveBeenCalledWith(
          "7",
          "128",
        );
        await waitFor(() =>
          expect(
            screen.queryByText("Anmeldung nachgetragen"),
          ).not.toBeInTheDocument(),
        );
      });

      it("closes the dialog and shows the contract as it is when the binding changed", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        api.fetchCareContract.mockResolvedValue(BOUND);
        await openUnbind();
        enrollments.unbindContractEnrollment.mockRejectedValueOnce(
          new ApiError("Request failed (409)", 409, {
            code: "care_contract.enrollment_binding_changed",
          }),
        );
        api.fetchCareContract.mockResolvedValue({
          ...BOUND,
          followsBookings: false,
          requestChildId: null,
        });
        fireEvent.click(screen.getByRole("button", { name: "Bindung lösen" }));
        expect(
          await screen.findByText(
            catalogText(
              "care_contract.enrollment_binding_changed",
              "die Bindung",
            ),
          ),
        ).toBeInTheDocument();
        await waitFor(() =>
          expect(
            screen.queryByRole("dialog", {
              name: "Bindung an die Anmeldung lösen?",
            }),
          ).not.toBeInTheDocument(),
        );
        await waitFor(() =>
          expect(
            screen.queryByText("Anmeldung nachgetragen"),
          ).not.toBeInTheDocument(),
        );
        // An expected refusal is no error of the page.
        expect(errors).not.toHaveBeenCalledWith(
          expect.stringContaining("traeger_care_contract_unbind_failed"),
          expect.anything(),
        );
        errors.mockRestore();
      });
    });

    it("offers nothing for a contract from an application", async () => {
      api.fetchCareContract.mockResolvedValue({ ...DRAFT, studentId: "3" });
      renderPage();
      // Anker: the contract data are on screen.
      expect(await screen.findByText("Vertrag Nr.")).toBeInTheDocument();
      expect(screen.queryByText("Kinderakte")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Mit Kinderakte verknüpfen" }),
      ).not.toBeInTheDocument();
    });
  });
});
