import { bffFile, bffJson } from "~/lib/bff-fetch";
/**
 * Lohnexport und Zeitexport des Trägers über alle Schulen (#4712, ADR 0250).
 *
 * Die Prüfung und die Datei kommen aus derselben Rechnung: Jede Schule rechnet
 * den Monat ihrer Beschäftigungen, der Träger bucht jede Art des
 * Arbeitsvertrags mit ihren eigenen Lohnarten. Jedes Laden steht im
 * Zugriffsprotokoll jeder Schule; nichts wird zwischengespeichert.
 */
import { filenameFromDisposition } from "./file-download";
import type * as traegerStaffExportsContract from "./contract/traeger-staff-exports.generated";
import { knownEnum } from "./contract/known-enum";

// Go does not register the set; the contract types it as string.
const PAYROLL_FORMAT_VALUES = ["datev_lodas", "datev_lug"] as const;

export type PayrollFormat = (typeof PAYROLL_FORMAT_VALUES)[number];

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

// Go does not register the set; the contract types it as string.
const PAYROLL_FORM_VALUES = ["traeger", "arbeitgeber"] as const;

/**
 * Die Form der Lohndatei (#8041, ADR 0320): eine Datei für den ganzen
 * Träger oder eine Datei je Arbeitgeber.
 */
export type PayrollForm = (typeof PAYROLL_FORM_VALUES)[number];

const EMPLOYER_BODY_VALUES = ["traeger", "schultraeger", "gemeinde"] as const;

/** Wer anstellt: der Träger, der Schulträger oder die Gemeinde. */
type EmployerBody = (typeof EMPLOYER_BODY_VALUES)[number];

export const EMPLOYER_BODY_LABELS: Record<EmployerBody, string> = {
  traeger: "Träger",
  schultraeger: "Schulträger",
  gemeinde: "Gemeinde",
};

/** Ein Arbeitgeber, dessen Zeilen eine Datei trägt. */
interface PayrollFileEmployer {
  readonly body: EmployerBody;
  /** Leer beim Träger. */
  readonly name: string;
}

interface PayrollDuplicate {
  readonly number: string;
  readonly people: readonly ExportPerson[];
}

/** Eine Datei des Monats; `key` wählt sie beim Herunterladen. */
export interface PayrollFile {
  readonly key: string;
  readonly employers: readonly PayrollFileEmployer[];
  readonly schools: readonly string[];
  readonly consultantNumber: string;
  readonly clientNumber: string;
  readonly people: number;
  readonly lineCount: number;
  readonly missingClient: boolean;
  readonly withoutNumber: readonly ExportPerson[];
  readonly duplicates: readonly PayrollDuplicate[];
  /** Personen, die in dieser Datei unter zwei Nummern stünden. */
  readonly splitNumbers: readonly {
    readonly person: ExportPerson;
    readonly numbers: readonly string[];
  }[];
  readonly ready: boolean;
}

/** Ein anderer Arbeitgeber mit Werten im Monat und was ihm fehlt. */
interface PayrollEmployerCheck {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly body: EmployerBody;
  readonly name: string;
  readonly missingClient: boolean;
  readonly missingCostCenter: boolean;
}

export interface PayrollReport {
  readonly year: number;
  readonly month: number;
  /** undefined: a format this build does not know. */
  readonly format: PayrollFormat | undefined;
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
  /** undefined: eine Form, die dieser Stand nicht kennt. */
  readonly form: PayrollForm | undefined;
  readonly files: readonly PayrollFile[];
  readonly employers: readonly PayrollEmployerCheck[];
  /** Personen in mehr als einer Datei: ihre Nummer je Arbeitgeber prüfen. */
  readonly inSeveralFiles: readonly ExportPerson[];
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

const mapPerson = (
  person: traegerStaffExportsContract.TraegerExportPerson,
): ExportPerson => ({
  recordId: person.record_id,
  firstName: person.first_name,
  lastName: person.last_name,
});

function mapPayrollReport(
  data: traegerStaffExportsContract.TraegerPayrollReport,
): PayrollReport {
  return {
    year: data.year,
    month: data.month,
    format: knownEnum(PAYROLL_FORMAT_VALUES, data.format),
    contracts: data.contracts,
    people: data.people,
    schools: data.schools,
    lineCount: data.line_count,
    kinds: data.kinds ?? [],
    withoutNumber: (data.without_number ?? []).map(mapPerson),
    // A category this build does not know has no field to fill in; `ready`
    // from the backend still holds the file back.
    unconfigured: (data.unconfigured ?? []).flatMap((gap) => {
      const category = knownEnum(PAYROLL_CATEGORIES, gap.category);
      return category === undefined ? [] : [{ category, kind: gap.kind }];
    }),
    missingClient: data.missing_client,
    noWageType: data.no_wage_type,
    openSchools: data.open_schools ?? [],
    contractChanges: (data.contract_changes ?? []).map(mapPerson),
    form: knownEnum(PAYROLL_FORM_VALUES, data.form),
    files: (data.files ?? []).map(mapPayrollFile),
    // Eine Stelle, die dieser Stand nicht kennt, zeigt die Seite nicht;
    // `ready` hält die Datei trotzdem zurück.
    employers: (data.employers ?? []).flatMap((employer) => {
      const body = knownEnum(EMPLOYER_BODY_VALUES, employer.body);
      return body === undefined
        ? []
        : [
            {
              schoolId: employer.school_id,
              schoolName: employer.school_name,
              body,
              name: employer.name,
              missingClient: employer.missing_client,
              missingCostCenter: employer.missing_cost_center,
            },
          ];
    }),
    inSeveralFiles: (data.in_several_files ?? []).map(mapPerson),
    ready: data.ready,
  };
}

function mapPayrollFile(
  file: traegerStaffExportsContract.TraegerPayrollFile,
): PayrollFile {
  return {
    key: file.key,
    employers: (file.employers ?? []).flatMap((employer) => {
      const body = knownEnum(EMPLOYER_BODY_VALUES, employer.body);
      return body === undefined ? [] : [{ body, name: employer.name }];
    }),
    schools: file.schools ?? [],
    consultantNumber: file.consultant_number,
    clientNumber: file.client_number,
    people: file.people,
    lineCount: file.line_count,
    missingClient: file.missing_client,
    withoutNumber: (file.without_number ?? []).map(mapPerson),
    duplicates: (file.duplicates ?? []).map((duplicate) => ({
      number: duplicate.number,
      people: (duplicate.people ?? []).map(mapPerson),
    })),
    splitNumbers: (file.split_numbers ?? []).map((split) => ({
      person: mapPerson(split.person),
      numbers: split.numbers ?? [],
    })),
    ready: file.ready,
  };
}

function mapTimeReport(
  data: traegerStaffExportsContract.TraegerTimeReport,
): TimeReport {
  return {
    year: data.year,
    month: data.month,
    people: data.people,
    schools: data.schools,
    rows: data.rows,
    withoutNumber: (data.without_number ?? []).map(mapPerson),
  };
}

export async function fetchPayrollReport(
  year: number,
  month: number,
  format: PayrollFormat,
): Promise<PayrollReport> {
  return mapPayrollReport(
    await bffJson("org", "GET /traeger/staff-exports/payroll", {
      query: { year, month, format },
    }),
  );
}

export async function fetchTimeReport(
  year: number,
  month: number,
): Promise<TimeReport> {
  return mapTimeReport(
    await bffJson("org", "GET /traeger/staff-exports/times", {
      query: { year, month },
    }),
  );
}

export interface ExportDownload {
  readonly blob: Blob;
  readonly filename: string | null;
}

async function download(file: Promise<Response>): Promise<ExportDownload> {
  const response = await file;
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response),
  };
}

/**
 * Die DATEV-Lohndatei; eine noch nicht fertige Datei lehnt der Server ab.
 * In der Form je Arbeitgeber wählt `file` die Datei (#8041).
 */
export const downloadPayrollFile = (
  year: number,
  month: number,
  format: PayrollFormat,
  file?: string,
) =>
  download(
    bffFile("org", "GET /traeger/staff-exports/payroll/export", {
      query: file ? { year, month, format, file } : { year, month, format },
    }),
  );

/**
 * Die Lohnwerte eines Arbeitgebers neben dem Träger (#8041, ADR 0320): die
 * DATEV-Nummern seiner eigenen Datei und die Kostenstelle seiner Zeilen in
 * der einen Datei des Trägers.
 */
export interface PayrollEmployer {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly body: EmployerBody;
  readonly name: string;
  readonly consultantNumber: string;
  readonly clientNumber: string;
  readonly costCenter: string;
  readonly version: string;
}

export type PayrollEmployerValues = Pick<
  PayrollEmployer,
  "consultantNumber" | "clientNumber" | "costCenter"
>;

function mapPayrollEmployer(
  employer: traegerStaffExportsContract.TraegerPayrollEmployerValues,
): PayrollEmployer[] {
  const body = knownEnum(EMPLOYER_BODY_VALUES, employer.body);
  if (body === undefined) return [];
  return [
    {
      schoolId: employer.school_id,
      schoolName: employer.school_name,
      body,
      name: employer.name,
      consultantNumber: employer.consultant_number,
      clientNumber: employer.client_number,
      costCenter: employer.cost_center,
      version: employer.version,
    },
  ];
}

/** Jede Schule, an der eine Gemeinde oder ein Schulträger anstellt. */
export async function fetchPayrollEmployers(): Promise<
  readonly PayrollEmployer[]
> {
  const data = await bffJson(
    "org",
    "GET /traeger/staff-exports/payroll/employers",
  );
  return (data.employers ?? []).flatMap(mapPayrollEmployer);
}

export async function savePayrollEmployer(
  employer: PayrollEmployer,
  values: PayrollEmployerValues,
): Promise<void> {
  await bffJson(
    "org",
    "PUT /traeger/staff-exports/payroll/employers/{schoolId}",
    {
      params: { schoolId: employer.schoolId },
      body: {
        body: employer.body,
        consultant_number: values.consultantNumber,
        client_number: values.clientNumber,
        cost_center: values.costCenter,
        expected_version: employer.version,
      } satisfies traegerStaffExportsContract.PayrollEmployerRequest,
    },
  );
}

/** Der Zeitexport als CSV. */
export const downloadTimeFile = (year: number, month: number) =>
  download(
    bffFile("org", "GET /traeger/staff-exports/times/export", {
      query: { year, month },
    }),
  );

/** Der Schlüssel der Lohnart einer Kategorie bei einer Art des Vertrags. */
export const wageTypeKey = (category: PayrollCategory, kind: string) =>
  `traeger_payroll.wage_type.${category}.${kind}`;

/** Der Schlüssel der Einheit einer Tageskategorie. */
export const unitKey = (category: PayrollCategory) =>
  `traeger_payroll.unit.${category}`;

export const FILE_FORM_KEY = "traeger_payroll.file_form";
export const CONSULTANT_KEY = "traeger_payroll.datev_consultant_number";
export const CLIENT_KEY = "traeger_payroll.datev_client_number";

/** Der Bereich der Lohnwerte in den Einstellungen des Trägers. */
export const PAYROLL_SETTINGS_TAB = "lohnexport";
