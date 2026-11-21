/**
 * Client of the finance exports (#4693): the field mapping of the
 * Sollstellung, the file numbers of the Träger, the released runs with
 * their last export, the export protocol, the download of a Sollstellung or
 * a DATEV booking batch (#4694) and the history of one invoice. Backend int64 IDs leave here as strings;
 * calendar dates stay "YYYY-MM-DD", instants ISO strings.
 */

import { knownEnum } from "./contract/known-enum";
import { requiredDay } from "./contract/required-day";
import type {
  BookingAccounts as WireBookingAccounts,
  CostCenterRequest,
  DatevRunOverviews as WireDatevRuns,
  ExportProtocolEntry as WireEntry,
  ExportProtocolPage as WireProtocolPage,
  ExportRunPage as WireRunPage,
  ExportSettings as WireSettings,
  FileNumberStartRequest,
  InvoiceHistory as WireHistory,
  RevenueAccountRequest,
  SollstellungMapping as WireMapping,
  SollstellungMappingRequest,
} from "./contract/traeger-finance-exports.generated";
import { traegerRequest } from "./traeger-api";
import { type BillingFile, billingFile } from "./traeger-billing-api";

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const RUN_KIND_VALUES = ["care", "holiday", "notice"] as const;
const FORMAT_VALUES = ["sollstellung", "pain008", "datev"] as const;
const HANDOVER_STATE_VALUES = [
  "transferred",
  "failed",
  "in_progress",
  "unknown",
] as const;
const SOLL_FIELD_VALUES = [
  "invoice_number",
  "invoice_date",
  "due_on",
  "amount",
  "credit_amount",
  "debtor_number",
  "recipient_name",
  "recipient_street",
  "recipient_postal_code",
  "recipient_city",
  "child_name",
  "school_name",
  "service_from",
  "service_until",
  "payment_method",
  "mandate_reference",
  "document_kind",
  "file_number",
  "revenue_account",
  "cost_center",
  "cost_center_2",
  "booking_text",
  "constant",
] as const;
const DELIMITER_VALUES = [";", ",", "\t", "|"] as const;
const DECIMAL_VALUES = [",", "."] as const;
const DATE_FORMAT_VALUES = ["dd.mm.yyyy", "yyyy-mm-dd"] as const;
const ENCODING_VALUES = ["utf-8-bom", "utf-8", "windows-1252"] as const;
const FALLBACK_REASON_VALUES = [
  "no_host_school",
  "no_school_cost_center",
] as const;
const STEP_KIND_VALUES = [
  "issued",
  "mail_requested",
  "sent",
  "exported",
  "submitted",
  "cancelled",
] as const;
const REVENUE_SCOPE_VALUES = [
  "care",
  "meals",
  "holiday",
  "holiday_meals",
  "offering",
] as const;
const COST_CENTER_SCOPE_VALUES = [
  "school",
  "school_holiday",
  "holiday",
  "offering",
] as const;

/** The kind of run, as the path names it. */
export type ExportRunPathKind = "care-runs" | "holiday-runs" | "notice-months";
type ExportRunKind = (typeof RUN_KIND_VALUES)[number];
export type ExportFormat = (typeof FORMAT_VALUES)[number];

/** The outcome of a handover, as the journal and the protocol name it. */
export type HandoverState = (typeof HANDOVER_STATE_VALUES)[number];

export type SollField = (typeof SOLL_FIELD_VALUES)[number];

/** Placeholders a booking text fills per row (#7008), as the backend reads them. */
export const SOLL_BOOKING_TEXT_PLACEHOLDERS = [
  "{Monat}",
  "{Kind}",
  "{Empfänger}",
  "{Rechnungsnummer}",
] as const;

/** Whether a column of the field carries a value: a constant or a pattern. */
function sollColumnKeepsValue(field: SollField): boolean {
  return field === "constant" || field === "booking_text";
}

/** Fields that write one row per revenue account and cost centers (#4821). */
export const SOLL_BOOKING_FIELDS: readonly SollField[] = [
  "revenue_account",
  "cost_center",
  "cost_center_2",
];

export type SollDelimiter = (typeof DELIMITER_VALUES)[number];
export type SollDecimal = (typeof DECIMAL_VALUES)[number];
export type SollDateFormat = (typeof DATE_FORMAT_VALUES)[number];
export type SollEncoding = (typeof ENCODING_VALUES)[number];

export interface SollColumn {
  readonly field: SollField;
  readonly header: string;
  /** The fixed value of a constant or the pattern of a booking text. */
  readonly value: string;
}

export interface SollMapping {
  readonly columns: readonly SollColumn[];
  readonly delimiter: SollDelimiter;
  readonly decimalSeparator: SollDecimal;
  readonly dateFormat: SollDateFormat;
  readonly encoding: SollEncoding;
  readonly headerRow: boolean;
  readonly fileNamePattern: string;
}

/** Whether the DATEV values of the Träger make a valid file (#4694). */
export interface DatevReadiness {
  readonly ready: boolean;
  /** Keys of the settings that are empty. */
  readonly missingSettings: readonly string[];
  /** Keys of the settings whose value DATEV would refuse. */
  readonly invalidSettings: readonly string[];
}

/** An invoice DATEV would refuse, named by a refused download. */
export interface DatevBookingProblem {
  readonly documentNumber: string;
  readonly field:
    | "debtor_number"
    | "document_date"
    | "document_number"
    | "amount"
    | "revenue_account"
    | "cost_center"
    | "cost_center_2";
  readonly reason: "missing" | "invalid" | "out_of_period";
}

export interface ExportSettings {
  /** null: the stored mapping holds a value this build does not know. */
  readonly mapping: SollMapping | null;
  /** Whether the Träger set a mapping of its own. */
  readonly custom: boolean;
  readonly updatedAt: string | null;
  /** The number the next file gets. */
  readonly nextFileNumber: number;
  /** A start value was set or a file was made: the start is fixed. */
  readonly fileNumbersStarted: boolean;
  readonly datev: DatevReadiness;
}

export interface ExportProtocolEntry {
  readonly id: string;
  readonly fileNumber: number;
  /** undefined: a format this build does not know. */
  readonly format: ExportFormat | undefined;
  readonly runKind: ExportRunKind;
  readonly runId: string;
  readonly runLabel: string;
  readonly fileName: string;
  readonly invoiceCount: number;
  readonly totalCents: number;
  /** Message ID of a PAIN.008 file. */
  readonly reference: string;
  /** Number of the earliest file of the run with the same content, else null. */
  readonly repeatOf: number | null;
  /** A DATEV file of "all bookings again" (#6433). */
  readonly datevAll: boolean;
  /**
   * Positions without values of their release: the file booked them on the
   * accounts of the day of the export (#4821).
   */
  readonly resolvedPositions: number;
  /**
   * Holiday weeks of a document the file booked on the cost center of the
   * holiday care instead of the school that hosts the week (#6624).
   */
  readonly costCenterFallbacks: readonly CostCenterFallback[];
  readonly exportedByYou: boolean;
  readonly exportedByAccount: boolean;
  /** Name of the exporting account; empty without one (#4693). */
  readonly exportedByName: string;
  readonly exportedAt: string;
  readonly submittedAt: string | null;
  /** The handover to the recipient of the Träger (ADR 0218), null for a download. */
  readonly handover?: ProtocolHandover | null;
}

/** Where a file of the protocol went and whether it arrived. */
export interface ProtocolHandover {
  /** "unknown" also stands for a state this build does not know. */
  readonly state: HandoverState;
  readonly reason: string;
  /** The recipient at the handover (ADR 0222); empty for an older one. */
  readonly recipientName: string;
  readonly targetHost: string;
  readonly targetDirectory: string;
}

/** Why a holiday position booked on the cost center of the holiday care. */
type CostCenterFallbackReason = (typeof FALLBACK_REASON_VALUES)[number];

export interface CostCenterFallback {
  readonly number: string;
  /** "YYYY-MM-DD", null for a line without a week. */
  readonly weekStartsOn: string | null;
  readonly weekEndsOn: string | null;
  readonly reason: CostCenterFallbackReason | undefined;
  /** The cost center the file booked on, empty for none. */
  readonly costCenter: string;
}

export interface ExportRun {
  readonly runKind: ExportRunKind;
  readonly pathKind: ExportRunPathKind;
  readonly runId: string;
  readonly label: string;
  /** "YYYY-MM-DD". */
  readonly issuedOn: string;
  readonly invoiceCount: number;
  readonly totalCents: number;
  readonly lastSollstellung: ExportProtocolEntry | null;
  readonly lastDatev: ExportProtocolEntry | null;
  readonly exports: number;
}

export type InvoiceHistoryKind = "care-invoices" | "holiday-documents";
type InvoiceStepKind = (typeof STEP_KIND_VALUES)[number];

export interface InvoiceStep {
  /** undefined: a step this build does not know. */
  readonly kind: InvoiceStepKind | undefined;
  readonly at: string;
  readonly byYou: boolean;
  readonly byAccount: boolean;
  /** Name of the account of the step; empty without one (#4693). */
  readonly accountName: string;
  readonly positions: number;
  readonly note: string;
  readonly file: ExportProtocolEntry | null;
}

export interface InvoiceHistory {
  readonly number: string;
  readonly steps: readonly InvoiceStep[];
}

const BASE = "/api/traeger/finance-exports";

const PATH_KINDS: Record<ExportRunKind, ExportRunPathKind> = {
  care: "care-runs",
  holiday: "holiday-runs",
  notice: "notice-months",
};

/**
 * The mapping, or null when it holds a value this build does not know: the
 * editor can neither show nor save it then, and a reload brings the newer
 * build.
 */
function mappingFromBackend(mapping: WireMapping): SollMapping | null {
  const delimiter = knownEnum(DELIMITER_VALUES, mapping.delimiter);
  const decimalSeparator = knownEnum(DECIMAL_VALUES, mapping.decimal_separator);
  const dateFormat = knownEnum(DATE_FORMAT_VALUES, mapping.date_format);
  const encoding = knownEnum(ENCODING_VALUES, mapping.encoding);
  const columns: SollColumn[] = [];
  for (const column of mapping.columns ?? []) {
    const field = knownEnum(SOLL_FIELD_VALUES, column.field);
    if (!field) return null;
    columns.push({ field, header: column.header, value: column.value ?? "" });
  }
  if (!delimiter || !decimalSeparator || !dateFormat || !encoding) return null;
  return {
    columns,
    delimiter,
    decimalSeparator,
    dateFormat,
    encoding,
    headerRow: mapping.header_row,
    fileNamePattern: mapping.file_name_pattern,
  };
}

function mappingToBackend(mapping: SollMapping): SollstellungMappingRequest {
  return {
    columns: mapping.columns.map((column) => ({
      field: column.field,
      header: column.header,
      ...(sollColumnKeepsValue(column.field) ? { value: column.value } : {}),
    })),
    delimiter: mapping.delimiter,
    decimal_separator: mapping.decimalSeparator,
    date_format: mapping.dateFormat,
    encoding: mapping.encoding,
    header_row: mapping.headerRow,
    file_name_pattern: mapping.fileNamePattern,
  };
}

function settingsFromBackend(settings: WireSettings): ExportSettings {
  return {
    mapping: mappingFromBackend(settings.sollstellung.mapping),
    custom: settings.sollstellung.custom,
    updatedAt: settings.sollstellung.updated_at,
    nextFileNumber: settings.file_numbers.next,
    fileNumbersStarted: settings.file_numbers.started,
    datev: {
      ready: settings.datev.ready,
      missingSettings: settings.datev.missing_settings ?? [],
      invalidSettings: settings.datev.invalid_settings ?? [],
    },
  };
}

/**
 * A protocol entry; null for a run kind this build does not know, which has
 * no page to link to.
 */
function entryFromBackend(entry: WireEntry): ExportProtocolEntry | null {
  const runKind = knownEnum(RUN_KIND_VALUES, entry.run_kind);
  if (!runKind) return null;
  return {
    id: entry.id,
    fileNumber: entry.file_number,
    format: knownEnum(FORMAT_VALUES, entry.format),
    runKind,
    runId: entry.run_id,
    runLabel: entry.run_label,
    fileName: entry.file_name,
    invoiceCount: entry.invoice_count,
    totalCents: entry.total_cents,
    reference: entry.reference ?? "",
    repeatOf: entry.repeat_of ?? null,
    datevAll: entry.datev_all ?? false,
    resolvedPositions: entry.resolved_positions ?? 0,
    costCenterFallbacks: (entry.cost_center_fallbacks ?? []).map(
      (fallback) => ({
        number: fallback.number,
        weekStartsOn: fallback.week_starts_on,
        weekEndsOn: fallback.week_ends_on,
        reason: knownEnum(FALLBACK_REASON_VALUES, fallback.reason),
        costCenter: fallback.cost_center,
      }),
    ),
    exportedByYou: entry.exported_by_you,
    exportedByAccount: entry.exported_by_account_id !== null,
    exportedByName: entry.exported_by_name,
    exportedAt: entry.exported_at,
    submittedAt: entry.submitted_at,
    handover: entry.handover
      ? {
          // The backend names a state it cannot read "unknown" itself.
          state:
            knownEnum(HANDOVER_STATE_VALUES, entry.handover.state) ?? "unknown",
          reason: entry.handover.reason ?? "",
          recipientName: entry.handover.recipient_name,
          targetHost: entry.handover.target_host,
          targetDirectory: entry.handover.target_directory,
        }
      : null,
  };
}

/** The mapping of the Sollstellung and the file numbers of the Träger. */
export async function fetchExportSettings(): Promise<ExportSettings> {
  return settingsFromBackend(
    await traegerRequest<WireSettings>(`${BASE}/settings`),
  );
}

/** Stores the mapping; the backend names each wrong field. */
export async function saveSollMapping(
  mapping: SollMapping,
): Promise<ExportSettings> {
  return settingsFromBackend(
    await traegerRequest<WireSettings>(`${BASE}/settings/sollstellung`, {
      method: "PUT",
      body: mappingToBackend(mapping),
    }),
  );
}

/** Returns the Träger to the default mapping. */
export async function resetSollMapping(): Promise<ExportSettings> {
  await traegerRequest(`${BASE}/settings/sollstellung`, { method: "DELETE" });
  return fetchExportSettings();
}

/** Sets the number of the first file, once. */
export async function setFileNumberStart(
  start: number,
): Promise<ExportSettings> {
  return settingsFromBackend(
    await traegerRequest<WireSettings>(`${BASE}/settings/file-number-start`, {
      method: "PUT",
      body: { start } satisfies FileNumberStartRequest,
    }),
  );
}

/** One page of a list of the export page, newest first. */
export interface FinanceExportPage<T> {
  readonly items: readonly T[];
  /** Entries of the whole list, not only of this page. */
  readonly total: number;
  /** Offset of the next page, null on the last. */
  readonly nextOffset: number | null;
}

/** A page of runs also counts the runs without a Sollstellung. */
export interface FinanceExportRunPage extends FinanceExportPage<ExportRun> {
  readonly notExported: number;
}

function pagePath(path: string, offset: number): string {
  return offset > 0 ? `${path}?offset=${offset}` : path;
}

/** A page of the released runs, newest first, with their last Sollstellung. */
export async function fetchExportRuns(
  offset = 0,
): Promise<FinanceExportRunPage> {
  const body = await traegerRequest<WireRunPage>(
    pagePath(`${BASE}/runs`, offset),
  );
  return {
    // A run of a kind this build does not know has no page; it is left out.
    items: (body.runs ?? []).flatMap((run) => {
      const runKind = knownEnum(RUN_KIND_VALUES, run.run_kind);
      if (!runKind) return [];
      return [
        {
          runKind,
          pathKind: PATH_KINDS[runKind],
          runId: run.run_id,
          label: run.label,
          issuedOn: requiredDay(run.issued_on, "export_run.issued_on"),
          invoiceCount: run.invoice_count,
          totalCents: run.total_cents,
          lastSollstellung: run.last_sollstellung
            ? entryFromBackend(run.last_sollstellung)
            : null,
          lastDatev: run.last_datev ? entryFromBackend(run.last_datev) : null,
          exports: run.exports,
        },
      ];
    }),
    total: body.total,
    notExported: body.not_exported,
    nextOffset: body.next_offset ?? null,
  };
}

/** A page of the export protocol, newest first. */
export async function fetchExportProtocol(
  offset = 0,
): Promise<FinanceExportPage<ExportProtocolEntry>> {
  const body = await traegerRequest<WireProtocolPage>(
    pagePath(`${BASE}/files`, offset),
  );
  return {
    items: (body.files ?? []).flatMap((file) => {
      const entry = entryFromBackend(file);
      return entry ? [entry] : [];
    }),
    total: body.total,
    nextOffset: body.next_offset ?? null,
  };
}

/** Downloads the Sollstellung of a run with the next file number. */
export async function downloadSollstellung(
  kind: ExportRunPathKind,
  runId: string,
): Promise<BillingFile> {
  return billingFile(
    `${BASE}/runs/${kind}/${encodeURIComponent(runId)}/sollstellung`,
    {},
    "sollstellung.csv",
  );
}

/** What a DATEV download holds (#6433). */
export interface DatevDownloadOptions {
  /** Every booking of the run again, also those an earlier file held. */
  readonly all?: boolean;
  /** "YYYY-MM-DD", the first day of the fiscal year; the earliest if unset. */
  readonly fiscalYear?: string;
}

/**
 * Downloads the DATEV booking batch of a run with the next file number:
 * the bookings no DATEV file held yet, or with `all` every booking again.
 * A refusal keeps its code: `parent_billing.datev_not_ready` while values
 * are missing, `parent_billing.datev_bookings_invalid` with the invoices
 * DATEV would refuse, `parent_billing.datev_no_new_bookings` when every
 * booking is in a file, `parent_billing.datev_bookings_taken` when another
 * download took them a moment earlier.
 */
export async function downloadDatevBatch(
  kind: ExportRunPathKind,
  runId: string,
  options: DatevDownloadOptions = {},
): Promise<BillingFile> {
  const query = new URLSearchParams();
  if (options.all) query.set("mode", "all");
  if (options.fiscalYear) query.set("fiscal_year", options.fiscalYear);
  const search = query.size > 0 ? `?${query.toString()}` : "";
  return billingFile(
    `${BASE}/runs/${kind}/${encodeURIComponent(runId)}/datev${search}`,
    {},
    "EXTF_Buchungsstapel.csv",
  );
}

/** The DATEV bookings of a run on the export page (#6433). */
export interface DatevRunState {
  /** Bookings the next standard files hold, across fiscal years. */
  readonly newBookings: number;
  /** First days ("YYYY-MM-DD") of the fiscal years of its bookings. */
  readonly fiscalYears: readonly string[];
}

/** The DATEV states of the runs of a page, by `runFileKey`-like key. */
export interface DatevRunStates {
  /** False while the DATEV values make no valid file; then no state. */
  readonly ready: boolean;
  readonly runs: ReadonlyMap<string, DatevRunState>;
}

/** The key of a run in `DatevRunStates.runs`. */
export function datevRunKey(run: Pick<ExportRun, "runKind" | "runId">) {
  return `${run.runKind}/${run.runId}`;
}

/** Runs one request asks for: the size of a page of the run list. */
const DATEV_RUNS_PER_REQUEST = 50;

async function fetchDatevRunPage(
  runs: readonly ExportRun[],
): Promise<WireDatevRuns> {
  const query = new URLSearchParams();
  for (const kind of ["care", "holiday"] as const) {
    const ids = runs
      .filter((run) => run.runKind === kind)
      .map((run) => run.runId);
    if (ids.length > 0) query.set(kind, ids.join(","));
  }
  if (query.size === 0) return { ready: true, runs: [] };
  return traegerRequest<WireDatevRuns>(
    `${BASE}/datev-runs?${query.toString()}`,
  );
}

/**
 * Reads the new DATEV bookings of the monthly and holiday runs given, one
 * request per page of runs.
 */
export async function fetchDatevRunStates(
  runs: readonly ExportRun[],
): Promise<DatevRunStates> {
  const pages: ExportRun[][] = [];
  for (let i = 0; i < runs.length; i += DATEV_RUNS_PER_REQUEST) {
    pages.push(runs.slice(i, i + DATEV_RUNS_PER_REQUEST));
  }
  const bodies = await Promise.all(pages.map(fetchDatevRunPage));
  return {
    ready: bodies.length > 0 && bodies.every((body) => body.ready),
    runs: new Map(
      bodies.flatMap((body) =>
        (body.runs ?? []).flatMap((run) => {
          const runKind = knownEnum(RUN_KIND_VALUES, run.run_kind);
          if (!runKind) return [];
          return [
            [
              datevRunKey({ runKind, runId: run.run_id }),
              {
                newBookings: run.new_bookings,
                fiscalYears: (run.fiscal_years ?? []).flatMap((year) =>
                  year ? [year] : [],
                ),
              },
            ] as const,
          ];
        }),
      ),
    ),
  };
}

const DATEV_PROBLEM_FIELDS = new Set<string>([
  "debtor_number",
  "document_date",
  "document_number",
  "amount",
  "revenue_account",
  "cost_center",
  "cost_center_2",
]);
const DATEV_PROBLEM_REASONS = new Set<string>([
  "missing",
  "invalid",
  "out_of_period",
]);

/**
 * The invoices a refused DATEV download names in its details; an entry of
 * another shape is left out, never guessed.
 */
export function datevBookingProblems(
  details: Record<string, unknown> | undefined,
): DatevBookingProblem[] {
  const documents = details?.documents;
  if (!Array.isArray(documents)) return [];
  return documents.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { document_number, field, reason } = entry as Record<string, unknown>;
    if (
      typeof document_number !== "string" ||
      typeof field !== "string" ||
      typeof reason !== "string" ||
      !DATEV_PROBLEM_FIELDS.has(field) ||
      !DATEV_PROBLEM_REASONS.has(reason)
    ) {
      return [];
    }
    return [
      {
        documentNumber: document_number,
        field: field as DatevBookingProblem["field"],
        reason: reason as DatevBookingProblem["reason"],
      },
    ];
  });
}

/** The history of an invoice, oldest step first. */
export async function fetchInvoiceHistory(
  kind: InvoiceHistoryKind,
  invoiceId: string,
): Promise<InvoiceHistory> {
  const body = await traegerRequest<WireHistory>(
    `${BASE}/invoice-history/${kind}/${encodeURIComponent(invoiceId)}`,
  );
  return {
    number: body.number,
    steps: (body.entries ?? []).map((entry) => ({
      kind: knownEnum(STEP_KIND_VALUES, entry.kind),
      at: entry.at,
      byYou: entry.by_you,
      byAccount: entry.account_id !== null,
      accountName: entry.account_name,
      positions: entry.positions ?? 0,
      note: entry.note ?? "",
      file: entry.file ? entryFromBackend(entry.file) : null,
    })),
  };
}

/** Where a Leistung or an Angebot books (#4821). */
export type RevenueScope = (typeof REVENUE_SCOPE_VALUES)[number];
/**
 * Whose cost center: a school (KOST1), the holiday care a school hosts
 * (KOST1, #7357), the holiday care of the Träger (KOST1), an Angebot (KOST2).
 */
export type CostCenterScope = (typeof COST_CENTER_SCOPE_VALUES)[number];

interface RevenueAccount {
  readonly scope: RevenueScope;
  /** The Angebot; "0" for a Leistung. */
  readonly scopeId: string;
  readonly account: string;
}

export interface CostCenter {
  readonly id: string;
  readonly scope: CostCenterScope;
  /** The school or Angebot; "0" for the holiday care. */
  readonly scopeId: string;
  /** "YYYY-MM-DD", the first day it holds. */
  readonly validFrom: string;
  /** Empty: the cost center ends on this day. */
  readonly code: string;
}

interface BookingOffering {
  readonly schoolId: string;
  readonly offeringId: string;
  readonly moduleNames: readonly string[];
}

export interface BookingAccounts {
  /** The standard revenue account of the DATEV values, "" while unset. */
  readonly standardAccount: string;
  /** Every booking needs a KOST1 (DATEV values). */
  readonly costCenterRequired: boolean;
  readonly schools: readonly { readonly id: string; readonly name: string }[];
  readonly offerings: readonly BookingOffering[];
  readonly revenueAccounts: readonly RevenueAccount[];
  readonly costCenters: readonly CostCenter[];
}

// Accounts and cost centers of a scope this build does not know have no row
// to show; they are left out.
function bookingAccountsFromBackend(
  body: WireBookingAccounts,
): BookingAccounts {
  return {
    standardAccount: body.standard_account,
    costCenterRequired: body.cost_center_required,
    schools: (body.schools ?? []).map((school) => ({
      id: school.id,
      name: school.name,
    })),
    offerings: (body.offerings ?? []).map((offering) => ({
      schoolId: offering.school_id,
      offeringId: offering.care_offering_id,
      moduleNames: offering.module_names ?? [],
    })),
    revenueAccounts: (body.revenue_accounts ?? []).flatMap((account) => {
      const scope = knownEnum(REVENUE_SCOPE_VALUES, account.scope);
      return scope
        ? [{ scope, scopeId: account.scope_id, account: account.account }]
        : [];
    }),
    costCenters: (body.cost_centers ?? []).flatMap((center) => {
      const scope = knownEnum(COST_CENTER_SCOPE_VALUES, center.scope);
      if (!scope) return [];
      return [
        {
          id: center.id,
          scope,
          scopeId: center.scope_id,
          validFrom: requiredDay(center.valid_from, "cost_center.valid_from"),
          code: center.code,
        },
      ];
    }),
  };
}

/** The revenue accounts and cost centers of the Träger (#4821). */
export async function fetchBookingAccounts(): Promise<BookingAccounts> {
  return bookingAccountsFromBackend(
    await traegerRequest<WireBookingAccounts>(`${BASE}/booking-accounts`),
  );
}

/** Sets the revenue account of a scope; "" removes it. */
export async function saveRevenueAccount(
  scope: RevenueScope,
  scopeId: string,
  account: string,
): Promise<BookingAccounts> {
  return bookingAccountsFromBackend(
    await traegerRequest<WireBookingAccounts>(
      `${BASE}/booking-accounts/revenue-accounts`,
      {
        method: "PUT",
        body: {
          scope,
          scope_id: scopeId,
          account,
        } satisfies RevenueAccountRequest,
      },
    ),
  );
}

/** Adds a cost center from its first day; "" ends the scope's cost center. */
export async function addCostCenter(center: {
  scope: CostCenterScope;
  scopeId: string;
  validFrom: string;
  code: string;
}): Promise<BookingAccounts> {
  return bookingAccountsFromBackend(
    await traegerRequest<WireBookingAccounts>(
      `${BASE}/booking-accounts/cost-centers`,
      {
        method: "POST",
        body: {
          scope: center.scope,
          scope_id: center.scopeId,
          valid_from: center.validFrom,
          code: center.code,
        } satisfies CostCenterRequest,
      },
    ),
  );
}

/** Deletes a cost center; issued invoices keep it. */
export async function deleteCostCenter(id: string): Promise<BookingAccounts> {
  await traegerRequest<void>(
    `${BASE}/booking-accounts/cost-centers/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  return fetchBookingAccounts();
}
