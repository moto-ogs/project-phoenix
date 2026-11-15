/**
 * Lohnexport und Zeitexport des Trägers über alle Schulen (#4712, ADR 0249).
 *
 * Die Prüfung und die Datei kommen aus derselben Rechnung: Jede Schule rechnet
 * den Monat ihrer Beschäftigungen, der Träger bucht jede Art des
 * Arbeitsvertrags mit ihren eigenen Lohnarten. Jedes Laden steht im
 * Zugriffsprotokoll jeder Schule; nichts wird zwischengespeichert.
 */
import { apiErrorFromBody, transportFetch } from "./api-error";
import { filenameFromDisposition } from "./file-download";
import { readJson, traegerRequest } from "./traeger-api";

const BASE = "/api/traeger/staff-exports";

export type PayrollFormat = "datev_lodas" | "datev_lug";

/** Die sieben Kategorien der Lohndatei in Dateireihenfolge. */
export const PAYROLL_CATEGORIES = [
  "regelarbeit",
  "plus_stunden",
  "auszahlung",
  "freizeitausgleich",
  "krank",
  "urlaub",
  "fortbildung",
] as const;
export type PayrollCategory = (typeof PAYROLL_CATEGORIES)[number];

/** Diese Kategorien kann DATEV in Tagen erwarten. */
export const PAYROLL_DAY_CATEGORIES: readonly PayrollCategory[] = [
  "krank",
  "urlaub",
  "fortbildung",
];

export const PAYROLL_CATEGORY_LABELS: Record<PayrollCategory, string> = {
  regelarbeit: "Regelarbeit",
  plus_stunden: "Plus-Stunden",
  auszahlung: "Auszahlung",
  freizeitausgleich: "Freizeitausgleich",
  krank: "Krank",
  urlaub: "Urlaub",
  fortbildung: "Fortbildung",
};

interface ExportPerson {
  readonly recordId: string;
  readonly firstName: string;
  readonly lastName: string;
}

export interface PayrollKindCount {
  readonly kind: string;
  readonly contracts: number;
  readonly lines: number;
}

export interface PayrollGap {
  readonly category: PayrollCategory;
  readonly kind: string;
}

export interface PayrollReport {
  readonly year: number;
  readonly month: number;
  readonly format: PayrollFormat;
  readonly contracts: number;
  readonly people: number;
  readonly schools: number;
  readonly lineCount: number;
  readonly kinds: readonly PayrollKindCount[];
  /** Personen ohne Personalnummer: Die Datei wartet auf sie. */
  readonly withoutNumber: readonly ExportPerson[];
  /** Werte ohne Lohnart oder Einheit: Sie fehlen in der Datei. */
  readonly unconfigured: readonly PayrollGap[];
  readonly missingClient: boolean;
  readonly noWageType: boolean;
  /** Schulen, deren Monat noch nicht für alle abgeschlossen ist. */
  readonly openSchools: readonly string[];
  /** Vertragswechsel im Monat: Der neuere Vertrag bucht den ganzen Monat. */
  readonly contractChanges: readonly ExportPerson[];
  readonly ready: boolean;
}

export interface TimeReport {
  readonly year: number;
  readonly month: number;
  readonly people: number;
  readonly schools: number;
  readonly rows: number;
  readonly withoutNumber: readonly ExportPerson[];
}

interface BackendPerson {
  record_id: string | number;
  first_name: string;
  last_name: string;
}

interface BackendPayrollReport {
  year: number;
  month: number;
  format: PayrollFormat;
  contracts: number;
  people: number;
  schools: number;
  line_count: number;
  kinds: PayrollKindCount[] | null;
  without_number: BackendPerson[] | null;
  unconfigured: PayrollGap[] | null;
  missing_client: boolean;
  no_wage_type: boolean;
  open_schools: string[] | null;
  contract_changes: BackendPerson[] | null;
  ready: boolean;
}

interface BackendTimeReport {
  year: number;
  month: number;
  people: number;
  schools: number;
  rows: number;
  without_number: BackendPerson[] | null;
}

const mapPerson = (person: BackendPerson): ExportPerson => ({
  recordId: String(person.record_id),
  firstName: person.first_name,
  lastName: person.last_name,
});

function mapPayrollReport(data: BackendPayrollReport): PayrollReport {
  return {
    year: data.year,
    month: data.month,
    format: data.format,
    contracts: data.contracts,
    people: data.people,
    schools: data.schools,
    lineCount: data.line_count,
    kinds: data.kinds ?? [],
    withoutNumber: (data.without_number ?? []).map(mapPerson),
    unconfigured: data.unconfigured ?? [],
    missingClient: data.missing_client,
    noWageType: data.no_wage_type,
    openSchools: data.open_schools ?? [],
    contractChanges: (data.contract_changes ?? []).map(mapPerson),
    ready: data.ready,
  };
}

function mapTimeReport(data: BackendTimeReport): TimeReport {
  return {
    year: data.year,
    month: data.month,
    people: data.people,
    schools: data.schools,
    rows: data.rows,
    withoutNumber: (data.without_number ?? []).map(mapPerson),
  };
}

const monthQuery = (year: number, month: number) =>
  `year=${year}&month=${month}`;

export async function fetchPayrollReport(
  year: number,
  month: number,
  format: PayrollFormat,
): Promise<PayrollReport> {
  return mapPayrollReport(
    await traegerRequest<BackendPayrollReport>(
      `${BASE}/payroll?${monthQuery(year, month)}&format=${format}`,
    ),
  );
}

export async function fetchTimeReport(
  year: number,
  month: number,
): Promise<TimeReport> {
  return mapTimeReport(
    await traegerRequest<BackendTimeReport>(
      `${BASE}/times?${monthQuery(year, month)}`,
    ),
  );
}

export interface ExportDownload {
  readonly blob: Blob;
  readonly filename: string | null;
}

async function download(path: string): Promise<ExportDownload> {
  const response = await transportFetch(path, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw apiErrorFromBody(
      `Request failed (${response.status})`,
      response.status,
      await readJson(response),
    );
  }
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response),
  };
}

/** Die DATEV-Lohndatei; eine noch nicht fertige Datei lehnt der Server ab. */
export const downloadPayrollFile = (
  year: number,
  month: number,
  format: PayrollFormat,
) =>
  download(
    `${BASE}/payroll/export?${monthQuery(year, month)}&format=${format}`,
  );

/** Der Zeitexport als CSV. */
export const downloadTimeFile = (year: number, month: number) =>
  download(`${BASE}/times/export?${monthQuery(year, month)}`);

/** Der Schlüssel der Lohnart einer Kategorie bei einer Art des Vertrags. */
export const wageTypeKey = (category: PayrollCategory, kind: string) =>
  `traeger_payroll.wage_type.${category}.${kind}`;

/** Der Schlüssel der Einheit einer Tageskategorie. */
export const unitKey = (category: PayrollCategory) =>
  `traeger_payroll.unit.${category}`;

export const CONSULTANT_KEY = "traeger_payroll.datev_consultant_number";
export const CLIENT_KEY = "traeger_payroll.datev_client_number";

/** Der Bereich der Lohnwerte in den Einstellungen des Trägers. */
export const PAYROLL_SETTINGS_TAB = "lohnexport";
