/**
 * Client of the Rechnungsausgangsbuch in the Träger portal (#4819): every
 * issued document of the Elternabrechnung in one list, across runs, issuers
 * and number ranges. The backend filters, pages and sums; the browser only
 * asks and shows. Every page read stands in the trail of the runs it shows.
 * Money stays whole cent. Backend int64 IDs leave here as strings.
 */

import { bffFile, bffJson } from "~/lib/bff-fetch";
import { knownEnum } from "./contract/known-enum";
import {
  INVOICE_STATUS_VALUES,
  type BillingInvoiceStatus,
} from "./traeger-billing-families-api";
import {
  JOURNAL_DOCUMENT_TYPE_VALUES,
  JOURNAL_REFERENCE_KIND_VALUES,
  JOURNAL_RUN_KIND_VALUES,
  type JournalDocumentType,
  type JournalReferenceKind,
  type JournalRunKind,
} from "./contract/traeger-invoice-journal.generated";
import type * as journalContract from "./contract/traeger-invoice-journal.generated";
import {
  downloadTraegerList,
  type TraegerListFile,
  type TraegerListFormat,
} from "./traeger-list-export";

export type { JournalDocumentType };

/** The columns a page of the journal is ordered by (#8138). */
export type JournalSort = "number" | "issued" | "recipient" | "gross" | "open";

/** The services whose counters number documents. */
const JOURNAL_SERVICE_VALUES = ["holiday", "care"] as const;
export type JournalService = (typeof JOURNAL_SERVICE_VALUES)[number];

/** The issuer filter's value for the Träger, whose key is empty. */
const TRAEGER_ISSUER = "traeger";

/** Who issued a document: the Träger (empty key) or a body by its name. */
export interface JournalIssuer {
  readonly key: string;
  readonly name: string;
}

/** The run a document was issued in. */
export interface JournalRun {
  /** undefined: a kind of run this build does not know. */
  readonly kind: JournalRunKind | undefined;
  readonly id: string;
  /** The period of a holiday run; empty for the others. */
  readonly name: string;
  /** The month of a monthly run, "YYYY-MM-01"; null for the others. */
  readonly month: string | null;
  /** The year of a run of Jahresbescheide; 0 for the others. */
  readonly year: number;
  /**
   * The issue day of the run, "YYYY-MM-DD", on a run of the filter; null on
   * the run of a document.
   */
  readonly issuedOn: string | null;
}

export interface JournalReference {
  /** undefined: a kind this build does not know. */
  readonly kind: JournalReferenceKind | undefined;
  readonly number: string;
}

export interface JournalDocument {
  /** Unique across the three kinds of run. */
  readonly key: string;
  readonly number: string;
  /** Calendar date "YYYY-MM-DD". */
  readonly issuedOn: string;
  /** undefined: a type this build does not know. */
  readonly documentType: JournalDocumentType | undefined;
  readonly recipientName: string;
  readonly issuer: JournalIssuer;
  /** The service whose counter numbered it; with issuer and year its range. */
  readonly service: JournalService | undefined;
  readonly numberYear: number;
  readonly run: JournalRun;
  readonly grossCents: number;
  readonly taxCents: number;
  readonly netCents: number;
  readonly reference: JournalReference | null;
  /**
   * The state of an invoice (#8138); null on a document without one: a
   * Storno, a Gutschrift, a Jahresbescheid.
   */
  readonly status: BillingInvoiceStatus | null;
  /** What an invoice still asks for; 0 without a state. */
  readonly openCents: number;
  /** First names of the children the document bills. */
  readonly childNames: readonly string[];
  readonly debtorNumber: string;
  /** Opens the family of the document; null on a Jahresbescheid. */
  readonly familyId: string | null;
}

interface JournalTotals {
  readonly grossCents: number;
  readonly taxCents: number;
  readonly netCents: number;
  /** What the invoices of the filter still ask for. */
  readonly openCents: number;
}

/** A number range that numbered at least one document. */
export interface JournalNumberRange {
  readonly issuer: JournalIssuer;
  /** undefined: a service this build does not know. */
  readonly service: JournalService | undefined;
  /** 0 for a range that counts through the years. */
  readonly year: number;
  readonly documentCount: number;
  readonly firstNumber: string;
  readonly lastNumber: string;
}

/** Numbers of a range that no document carries. */
export interface JournalNumberGap {
  readonly issuer: JournalIssuer;
  readonly service: JournalService | undefined;
  readonly year: number;
  /** The running number of the first missing number. */
  readonly firstMissing: number;
  readonly missingCount: number;
  /**
   * The first and the last missing number as a document would carry them;
   * empty when the range does not let them be written.
   */
  readonly firstMissingNumber: string;
  readonly lastMissingNumber: string;
  /** The document before the gap; empty when the range starts with it. */
  readonly afterNumber: string;
  /** The document after the gap; empty when nothing follows it yet. */
  readonly beforeNumber: string;
}

export interface InvoiceJournalPage {
  readonly documents: readonly JournalDocument[];
  /** Every document that passes the filter, over all pages. */
  readonly totalCount: number;
  readonly hasMore: boolean;
  readonly totals: JournalTotals;
  readonly gaps: readonly JournalNumberGap[];
  readonly numberRanges: readonly JournalNumberRange[];
  readonly runs: readonly JournalRun[];
}

/** A number range as the filter names it. */
export interface JournalRangeFilter {
  readonly issuerKey: string;
  readonly service: JournalService;
  readonly year: number;
}

/** A run as the filter names it. */
export interface JournalRunFilter {
  readonly kind: JournalRunKind;
  readonly id: string;
}

/** The filter of the journal. Days are "YYYY-MM-DD", both included. */
export interface InvoiceJournalFilter {
  /** Empty for no bound. */
  readonly from: string;
  readonly to: string;
  /** null: every issuer. The Träger has the empty key. */
  readonly issuerKey: string | null;
  readonly range: JournalRangeFilter | null;
  /** Empty for every type. */
  readonly documentType: JournalDocumentType | "";
  readonly run: JournalRunFilter | null;
  /** Empty for every state. */
  readonly status: BillingInvoiceStatus | "";
  readonly search: string;
}

/** The order of a page; null keeps the order of the journal. */
export interface JournalOrder {
  readonly sort: JournalSort;
  readonly order: "asc" | "desc";
}

/** The query of a filter, as the backend reads it. */
function journalQuery(filter: InvoiceJournalFilter) {
  // A number range belongs to one issuer: it names the issuer too.
  const issuerKey = filter.range ? filter.range.issuerKey : filter.issuerKey;
  return {
    from: filter.from || undefined,
    to: filter.to || undefined,
    issuer: issuerKey === null ? undefined : issuerKey || TRAEGER_ISSUER,
    service: filter.range?.service,
    year: filter.range?.year,
    document_type: filter.documentType || undefined,
    run_kind: filter.run?.kind,
    run_id: filter.run?.id,
    status: filter.status || undefined,
    search: filter.search.trim() || undefined,
  };
}

function toIssuer(
  issuer: journalContract.JournalDocument["issuer"],
): JournalIssuer {
  return { key: issuer.key, name: issuer.name };
}

function toRun(run: journalContract.JournalRun): JournalRun {
  return {
    kind: knownEnum(JOURNAL_RUN_KIND_VALUES, run.kind),
    id: run.id,
    name: run.name,
    month: run.month,
    year: run.year,
    issuedOn: run.issued_on,
  };
}

function toDocument(
  document: journalContract.JournalDocument,
): JournalDocument {
  return {
    key: document.key,
    number: document.number,
    issuedOn: document.issued_on ?? "",
    documentType: knownEnum(
      JOURNAL_DOCUMENT_TYPE_VALUES,
      document.document_type,
    ),
    recipientName:
      `${document.recipient_first_name} ${document.recipient_last_name}`.trim(),
    issuer: toIssuer(document.issuer),
    service: knownEnum(JOURNAL_SERVICE_VALUES, document.service),
    numberYear: document.number_year,
    run: toRun(document.run),
    grossCents: document.gross_cents,
    taxCents: document.tax_cents,
    netCents: document.net_cents,
    reference: document.reference
      ? {
          kind: knownEnum(
            JOURNAL_REFERENCE_KIND_VALUES,
            document.reference.kind,
          ),
          number: document.reference.number,
        }
      : null,
    status: knownEnum(INVOICE_STATUS_VALUES, document.status) ?? null,
    openCents: document.open_cents,
    childNames: document.child_names ?? [],
    debtorNumber: document.debtor_number,
    familyId: document.family_id ?? null,
  };
}

/**
 * One page of the journal, the newest document first unless an order names
 * a column. Pages start at 1.
 */
export async function fetchInvoiceJournal(
  filter: InvoiceJournalFilter,
  page: number,
  order: JournalOrder | null = null,
): Promise<InvoiceJournalPage> {
  const { data, pagination } = await bffJson(
    "org",
    "GET /traeger/invoice-journal/",
    {
      query: {
        ...journalQuery(filter),
        page,
        sort: order?.sort,
        order: order?.order,
      },
    },
  );
  return {
    documents: (data.documents ?? []).map(toDocument),
    totalCount: pagination.total_records,
    hasMore: pagination.current_page < pagination.total_pages,
    totals: {
      grossCents: data.totals.gross_cents,
      taxCents: data.totals.tax_cents,
      netCents: data.totals.net_cents,
      openCents: data.totals.open_cents,
    },
    gaps: (data.gaps ?? []).map((gap) => ({
      issuer: toIssuer(gap.issuer),
      service: knownEnum(JOURNAL_SERVICE_VALUES, gap.service),
      year: gap.year,
      firstMissing: gap.first_missing,
      missingCount: gap.missing_count,
      firstMissingNumber: gap.first_missing_number,
      lastMissingNumber: gap.last_missing_number,
      afterNumber: gap.after_number,
      beforeNumber: gap.before_number,
    })),
    numberRanges: (data.number_ranges ?? []).map((range) => ({
      issuer: toIssuer(range.issuer),
      service: knownEnum(JOURNAL_SERVICE_VALUES, range.service),
      year: range.year,
      documentCount: range.document_count,
      firstNumber: range.first_number,
      lastNumber: range.last_number,
    })),
    runs: (data.runs ?? []).map(toRun),
  };
}

/** The file of a filter: every document by number, then the sums. */
export function downloadInvoiceJournal(
  filter: InvoiceJournalFilter,
  format: TraegerListFormat,
): Promise<TraegerListFile> {
  return downloadTraegerList(
    bffFile("org", "GET /traeger/invoice-journal/export", {
      query: { ...journalQuery(filter), format },
    }),
  );
}
