import { SWRConfig } from "~/lib/swr/testing";
vi.unmock("swr");
import {
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { errorFromProblem } from "~/test/helpers/problem-response";
import type {
  InvoiceJournalFilter,
  InvoiceJournalPage,
  JournalDocument,
  JournalNumberGap,
} from "~/lib/traeger-invoice-journal-api";

const { mockFetchJournal, mockDownload, mockDownloadBlob } = vi.hoisted(() => ({
  mockFetchJournal: vi.fn(),
  mockDownload: vi.fn(),
  mockDownloadBlob: vi.fn(),
}));

vi.mock("~/lib/traeger-invoice-journal-api", () => ({
  fetchInvoiceJournal: (filter: InvoiceJournalFilter, page: number) =>
    mockFetchJournal(filter, page),
  downloadInvoiceJournal: (filter: InvoiceJournalFilter, format: string) =>
    mockDownload(filter, format),
}));
vi.mock("~/lib/file-download", () => ({
  downloadBlob: (blob: Blob, name: string) => mockDownloadBlob(blob, name),
}));
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/traeger/abrechnung/rechnungsausgangsbuch",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import TraegerInvoiceJournalPage from "./page-content";

const TRAEGER = { key: "", name: "" };
const STADT = { key: "DE98ZZZ09999999999", name: "Stadt Musterhausen" };

const INVOICE: JournalDocument = {
  key: "holiday-1",
  number: "FE-2026-0001",
  issuedOn: "2026-09-01",
  documentType: "invoice",
  recipientName: "Eva Muster",
  issuer: TRAEGER,
  service: "holiday",
  numberYear: 2026,
  run: {
    kind: "holiday",
    id: "4",
    name: "Herbstferien 2026",
    month: null,
    year: 0,
    issuedOn: null,
  },
  grossCents: 12000,
  taxCents: 0,
  netCents: 12000,
  reference: null,
};

const CANCELLATION: JournalDocument = {
  key: "care_cancellation-2",
  number: "MB-2026-0002",
  issuedOn: "2026-09-03",
  documentType: "cancellation",
  recipientName: "Paul Muster",
  issuer: TRAEGER,
  service: "care",
  numberYear: 2026,
  run: {
    kind: "care",
    id: "9",
    name: "",
    month: "2026-09-01",
    year: 0,
    issuedOn: null,
  },
  grossCents: -4500,
  taxCents: 0,
  netCents: -4500,
  reference: { kind: "cancels", number: "MB-2026-0001" },
};

const GAP: JournalNumberGap = {
  issuer: TRAEGER,
  service: "holiday",
  year: 2026,
  firstMissing: 2,
  missingCount: 2,
  firstMissingNumber: "FE-2026-0002",
  lastMissingNumber: "FE-2026-0003",
  afterNumber: "FE-2026-0001",
  beforeNumber: "FE-2026-0004",
};

function journal(
  overrides: Partial<InvoiceJournalPage> = {},
): InvoiceJournalPage {
  return {
    documents: [CANCELLATION, INVOICE],
    totalCount: 2,
    hasMore: false,
    totals: { grossCents: 7500, taxCents: 0, netCents: 7500 },
    gaps: [],
    numberRanges: [
      {
        issuer: TRAEGER,
        service: "holiday",
        year: 2026,
        documentCount: 1,
        firstNumber: "FE-2026-0001",
        lastNumber: "FE-2026-0001",
      },
      {
        issuer: TRAEGER,
        service: "care",
        year: 2026,
        documentCount: 1,
        firstNumber: "MB-2026-0002",
        lastNumber: "MB-2026-0002",
      },
    ],
    runs: [CANCELLATION.run, INVOICE.run],
    ...overrides,
  };
}

function renderPage() {
  return rtlRender(
    <SWRConfig value={{ provider: () => new Map() }}>
      <ToastProvider>
        <TraegerInvoiceJournalPage />
      </ToastProvider>
    </SWRConfig>,
  );
}

/** Opens one filter of the filter panel in the page head. */
async function openFilter(label: string) {
  if (!screen.queryByRole("region", { name: "Filter" })) {
    fireEvent.click(screen.getAllByRole("button", { name: /^Filter/ })[0]!);
  }
  const panel = within(await screen.findByRole("region", { name: "Filter" }));
  fireEvent.click(panel.getByRole("combobox", { name: label }));
}

describe("TraegerInvoiceJournalPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchJournal.mockResolvedValue(journal());
  });

  it("lists every issued document with its run, reference and amounts", async () => {
    renderPage();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("FE-2026-0001")).toBeInTheDocument();
    expect(within(table).getByText("01.09.2026")).toBeInTheDocument();
    expect(within(table).getByText("Eva Muster")).toBeInTheDocument();
    expect(within(table).getByText("Storno")).toBeInTheDocument();
    expect(
      within(table).getByRole("button", { name: "zu MB-2026-0001" }),
    ).toBeInTheDocument();
    expect(within(table).getAllByText("-45,00 €")).toHaveLength(2);
    // The run leads to its page, where its letters lie.
    expect(
      within(table).getByRole("link", { name: "Herbstferien 2026" }),
    ).toHaveAttribute("href", "/traeger/abrechnung/4");
    expect(
      within(table).getByRole("link", {
        name: "Monatsbeiträge September 2026",
      }),
    ).toHaveAttribute("href", "/traeger/abrechnung/monatsbeitraege/9");
    // One issuer: the column would say the same in every row.
    expect(
      within(table).queryByRole("columnheader", { name: "Rechnungssteller" }),
    ).not.toBeInTheDocument();
    expect(mockFetchJournal).toHaveBeenCalledWith(
      {
        from: "",
        to: "",
        issuerKey: null,
        range: null,
        documentType: "",
        run: null,
        search: "",
      },
      1,
    );
    // The sums are the server's, over every document of the filter.
    expect(screen.getAllByText("75,00 €")).toHaveLength(2);
    expect(
      screen.getByRole("heading", { name: "Summen für alle 2 Dokumente" }),
    ).toBeInTheDocument();
  });

  it("warns about a gap of a number range and shows that range on request", async () => {
    mockFetchJournal.mockResolvedValue(journal({ gaps: [GAP] }));
    renderPage();

    expect(
      await screen.findByText("Lücke im Nummernkreis Ferienbetreuung 2026"),
    ).toBeInTheDocument();
    // The notice names the missing numbers as documents would carry them.
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent(
      "Es fehlen die Nummern FE-2026-0002 und FE-2026-0003 (zwischen FE-2026-0001 und FE-2026-0004).",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Nur Nummernkreis Ferienbetreuung 2026 zeigen",
      }),
    );
    await waitFor(() =>
      expect(mockFetchJournal).toHaveBeenLastCalledWith(
        expect.objectContaining({
          range: {
            issuerKey: "",
            service: "holiday",
            year: 2026,
          },
        }),
        1,
      ),
    );
    // The range in view needs no button to itself.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", {
          name: /Nur diesen Nummernkreis zeigen/,
        }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText("Lücke im Nummernkreis Ferienbetreuung 2026"),
    ).toBeInTheDocument();
  });

  it("names the issuer when a body issues in place of the Träger", async () => {
    mockFetchJournal.mockResolvedValue(
      journal({
        documents: [{ ...INVOICE, issuer: STADT }],
        numberRanges: [
          {
            issuer: STADT,
            service: "holiday",
            year: 2026,
            documentCount: 1,
            firstNumber: "ST-2026-0001",
            lastNumber: "ST-2026-0001",
          },
        ],
      }),
    );
    renderPage();

    // The column follows the answer: the choices arrive with the rows.
    expect(
      await screen.findByRole("columnheader", { name: "Rechnungssteller" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("table")).getByText("Stadt Musterhausen"),
    ).toBeInTheDocument();
  });

  it("clears search and filters when a reference is followed", async () => {
    renderPage();
    const table = await screen.findByRole("table");
    await openFilter("Dokumentart");
    fireEvent.click(await screen.findByRole("option", { name: "Storno" }));
    await waitFor(() =>
      expect(mockFetchJournal).toHaveBeenLastCalledWith(
        expect.objectContaining({ documentType: "cancellation" }),
        1,
      ),
    );

    fireEvent.click(
      await within(await screen.findByRole("table")).findByRole("button", {
        name: "zu MB-2026-0001",
      }),
    );

    // The original would stay hidden behind the filter on Stornos.
    await waitFor(() =>
      expect(mockFetchJournal).toHaveBeenLastCalledWith(
        expect.objectContaining({
          documentType: "",
          search: "MB-2026-0001",
        }),
        1,
      ),
    );
    expect(table).toBeDefined();
  });

  it("collects several gaps in one card", async () => {
    mockFetchJournal.mockResolvedValue(
      journal({
        gaps: [
          GAP,
          {
            ...GAP,
            service: "care",
            firstMissing: 1,
            missingCount: 1,
            firstMissingNumber: "MB-2026-0001",
            lastMissingNumber: "MB-2026-0001",
            afterNumber: "",
            beforeNumber: "MB-2026-0002",
          },
        ],
      }),
    );
    renderPage();

    expect(
      await screen.findByRole("heading", {
        name: /Lücken in den Nummernkreisen/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 Nummern fehlen")).toBeInTheDocument();
    expect(screen.getByText(/fehlt die Nummer/)).toHaveTextContent(
      "Es fehlt die Nummer MB-2026-0001 (vor MB-2026-0002).",
    );
    expect(
      screen.getByText("Nummernkreis Ferienbetreuung 2026"),
    ).toBeInTheDocument();
    // The gap also stands at its place in the list.
    const table = screen.getByRole("table");
    expect(within(table).getByText("Lücke: 1 Nummer")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Nur Nummernkreis .* zeigen/ }),
    ).toHaveLength(2);
  });

  it("asks the server for the chosen document type", async () => {
    renderPage();
    await screen.findByRole("table");
    await openFilter("Dokumentart");
    fireEvent.click(await screen.findByRole("option", { name: "Gutschrift" }));

    await waitFor(() =>
      expect(mockFetchJournal).toHaveBeenLastCalledWith(
        expect.objectContaining({ documentType: "credit" }),
        1,
      ),
    );
  });

  it("offers the issuer once the Träger has several", async () => {
    mockFetchJournal.mockResolvedValue(
      journal({
        documents: [{ ...INVOICE, issuer: STADT }, CANCELLATION],
        numberRanges: [
          ...journal().numberRanges,
          {
            issuer: STADT,
            service: "holiday",
            year: 2026,
            documentCount: 1,
            firstNumber: "ST-2026-0001",
            lastNumber: "ST-2026-0001",
          },
        ],
      }),
    );
    renderPage();

    expect(
      await screen.findByRole("columnheader", { name: "Rechnungssteller" }),
    ).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Stadt Musterhausen")).toBeInTheDocument();
    await openFilter("Rechnungssteller");
    fireEvent.click(
      await screen.findByRole("option", { name: "Stadt Musterhausen" }),
    );
    await waitFor(() =>
      expect(mockFetchJournal).toHaveBeenLastCalledWith(
        expect.objectContaining({ issuerKey: STADT.key }),
        1,
      ),
    );
  });

  it("loads the next pages below the list and counts a document once", async () => {
    const third: JournalDocument = {
      ...INVOICE,
      key: "holiday-3",
      number: "FE-2026-0000",
    };
    mockFetchJournal
      .mockResolvedValueOnce(
        journal({ documents: [CANCELLATION], hasMore: true, totalCount: 3 }),
      )
      .mockResolvedValueOnce(
        journal({ documents: [INVOICE], hasMore: true, totalCount: 3 }),
      )
      // A release meanwhile moved the rows: the page repeats one of them.
      .mockResolvedValueOnce(
        journal({ documents: [INVOICE, third], hasMore: false, totalCount: 3 }),
      );
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Weitere Dokumente laden (1 von 3)",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Weitere Dokumente laden (2 von 3)",
      }),
    );

    const table = await screen.findByRole("table");
    expect(await within(table).findByText("FE-2026-0000")).toBeInTheDocument();
    expect(within(table).getAllByText("FE-2026-0001")).toHaveLength(1);
    expect(within(table).getAllByText("MB-2026-0002")).toHaveLength(1);
    expect(mockFetchJournal).toHaveBeenLastCalledWith(expect.anything(), 3);
    expect(
      screen.queryByRole("button", { name: /Weitere Dokumente laden/ }),
    ).not.toBeInTheDocument();
  });

  it("downloads the file of the filter", async () => {
    const blob = new Blob(["Nummer"]);
    mockDownload.mockResolvedValue({
      blob,
      filename: "rechnungsausgangsbuch.csv",
    });
    renderPage();
    await screen.findByRole("table");

    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Weitere Aktionen" })).at(
        -1,
      )!,
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: /CSV/ }));

    await waitFor(() =>
      expect(mockDownloadBlob).toHaveBeenCalledWith(
        blob,
        "rechnungsausgangsbuch.csv",
      ),
    );
    expect(mockDownload).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: "", search: "" }),
      "csv",
    );
  });

  it("says when no document is issued yet and offers nothing to filter", async () => {
    mockFetchJournal.mockResolvedValue(
      journal({
        documents: [],
        totalCount: 0,
        totals: { grossCents: 0, taxCents: 0, netCents: 0 },
        numberRanges: [],
        runs: [],
      }),
    );
    renderPage();

    expect(
      await screen.findByText("Noch kein Dokument ausgestellt."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/Summen für/)).not.toBeInTheDocument();
  });

  it("shows the load error instead of an empty list", async () => {
    mockFetchJournal.mockRejectedValue(
      await errorFromProblem("forbidden", 403, {
        code: "general.forbidden",
        details: null,
      }),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.queryByText("Noch kein Dokument ausgestellt."),
    ).not.toBeInTheDocument();
  });
});

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "A", scope: "org", orgId: "7" } },
    status: "authenticated",
  }),
}));
