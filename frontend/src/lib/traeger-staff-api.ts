import { bffJson } from "~/lib/bff-fetch";
/**
 * Personalakte des Trägers über alle Schulen (#4705, ADR 0089, ADR 0233).
 *
 * Die Personalverwaltung führt eine Person mit einer Akte über alle Schulen:
 * moto schlägt vor, welche Beschäftigungen eine Person sind, die
 * Personalverwaltung bestätigt jede Verknüpfung und wählt bei verschiedenen
 * Werten je Feld. Die Akte führt die Personalnummer des Trägers und die Bank-
 * und Steuerdaten. Personendaten werden nie zwischengespeichert; jede Anfrage
 * steht im Zugriffsprotokoll der Schulen. Backend-IDs werden hier zu Strings.
 */
import type * as traegerStaffRecordsContract from "~/lib/contract/traeger-staff-records.generated";
import { knownEnum } from "~/lib/contract/known-enum";
import { requiredDay } from "~/lib/contract/required-day";
import {
  downloadTraegerList,
  type TraegerListFile,
  type TraegerListFormat,
} from "./traeger-list-export";
import { mapStaffProof, type StaffProof } from "~/lib/traeger-staff-proofs-api";

const BASE = "/api/traeger/staff-records";

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined and shows as „–“.
const STAFF_RECORD_FIELD_VALUES = [
  "first_name",
  "last_name",
  "birthday",
  "personnel_number",
  "iban",
  "tax_id",
  "social_security_number",
] as const;
const STAFF_MATCH_REASON_VALUES = [
  "same_account",
  "same_personnel_number",
  "same_name_birthday",
  "single",
] as const;
const STAFF_REPRESENTATION_VALUES = ["agreement", "none"] as const;
const STAFF_CHANGE_KIND_VALUES = [
  "linked",
  "not_chosen",
  "changed",
  "added",
  "removed",
  "imported",
  "ended",
  "resumed",
] as const;
const STAFF_CHANGE_FIELD_VALUES = [
  ...STAFF_RECORD_FIELD_VALUES,
  "school",
  "record",
  "contract",
  "contract_soll",
  "holiday_week",
] as const;
const STAFF_CONTRACT_KIND_VALUES = [
  "part_time",
  "full_time",
  "minijob",
  "uebungsleiter",
  "ehrenamt",
] as const;

/** Die Felder einer Akte, in der Reihenfolge der Vorschau. */
export type StaffRecordField = (typeof STAFF_RECORD_FIELD_VALUES)[number];

/** Warum moto Beschäftigungen zusammen vorschlägt (ADR 0089 Abschnitt 5). */
export type StaffMatchReason = (typeof STAFF_MATCH_REASON_VALUES)[number];

type StaffRepresentation = (typeof STAFF_REPRESENTATION_VALUES)[number];

interface StaffRelease {
  /** undefined: eine Vertretung, die dieser Build nicht kennt. */
  readonly representation: StaffRepresentation | undefined;
  readonly releasedAt: string;
}

interface StaffSchool {
  readonly id: string;
  readonly name: string;
}

/** Ein Einsatzort einer Akte: die Beschäftigung an einer Schule. */
interface StaffEmployment {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly staffId: string;
  /** `false`, wenn die Schule die Beschäftigung beendet hat. */
  readonly active: boolean;
  /**
   * Die erste Blockung aus dem Vertretungspool hat den Einsatzort angelegt
   * (#7173). Er endet nach der letzten Blockung der Schule, die nächste
   * nimmt ihn wieder auf (#7197).
   */
  readonly viaPool: boolean;
}

export interface StaffRecordSummary {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  /** Kalendertag `YYYY-MM-DD` oder leer. */
  readonly birthday: string;
  readonly personnelNumber: string | null;
  readonly hasFinancial: boolean;
  readonly employments: readonly StaffEmployment[];
}

/** Eine Beschäftigung, die noch zu keiner Akte gehört. */
export interface StaffCandidate {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly staffId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly birthday: string;
  readonly personnelNumber: string | null;
  readonly hasAccount: boolean;
}

export interface StaffSuggestion {
  /** undefined: ein Grund, den dieser Build nicht kennt. */
  readonly reason: StaffMatchReason | undefined;
  /** Gesetzt, wenn die Beschäftigungen zu einer bestehenden Akte passen. */
  readonly recordId: string | null;
  readonly members: readonly StaffCandidate[];
}

export interface StaffOverview {
  readonly release: StaffRelease | null;
  readonly schools: readonly StaffSchool[];
  readonly records: readonly StaffRecordSummary[];
  readonly suggestions: readonly StaffSuggestion[];
}

export interface StaffFinancial {
  readonly iban: string | null;
  readonly taxId: string | null;
  readonly socialSecurityNumber: string | null;
}

export interface StaffChange {
  /**
   * `imported`: angelegt oder ergänzt vom Personal-Import (#4724).
   * `ended`: der Einsatzort aus dem Vertretungspool endete nach der letzten
   * Blockung, `resumed`: eine neue Blockung nahm ihn wieder auf (#7197).
   * undefined: eine Art, die dieser Build nicht kennt.
   */
  readonly kind: (typeof STAFF_CHANGE_KIND_VALUES)[number] | undefined;
  /**
   * `record`: die ganze Akte, die der Personal-Import angelegt hat;
   * `contract`, `contract_soll`, `holiday_week`: ein Vertragseintrag (#4706).
   * undefined: ein Feld, das dieser Build nicht kennt.
   */
  readonly field: (typeof STAFF_CHANGE_FIELD_VALUES)[number] | undefined;
  readonly value: string;
  readonly schoolName: string;
  readonly occurredAt: string;
}

/** Die Art eines Arbeitsvertrags (#4706). */
export type StaffContractKind = (typeof STAFF_CONTRACT_KIND_VALUES)[number];

/** Ein Soll ab einem Tag, Montag bis Freitag in Minuten. */
interface StaffContractSoll {
  readonly validFrom: string;
  readonly weekdayMinutes: readonly number[];
}

/** Ein Einsatzort eines Vertrags mit dem Verlauf seines Solls. */
export interface StaffContractSite {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly staffId: string;
  /** Neuestes Soll zuerst. */
  readonly soll: readonly StaffContractSoll[];
  /** Ab diesem Tag lässt die Schule eine Änderung noch zu. */
  readonly changeableFrom: string;
}

/** Das Ferien-Soll einer Woche (Montag) an einem Einsatzort. */
export interface StaffContractHolidayWeek {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly staffId: string;
  readonly weekStart: string;
  readonly weekdayMinutes: readonly number[];
}

export interface StaffContract {
  readonly id: string;
  /** undefined: eine Art, die dieser Build nicht kennt. */
  readonly kind: StaffContractKind | undefined;
  readonly startsOn: string;
  /** Letzter Tag oder `null`, solange der Vertrag unbefristet läuft. */
  readonly endsOn: string | null;
  /** Merkmal „Vertretungspool“: die Person ist Springer (#4709). */
  readonly pool: boolean;
  readonly sites: readonly StaffContractSite[];
  readonly holidayWeeks: readonly StaffContractHolidayWeek[];
}

export interface StaffRecordDetail extends StaffRecordSummary {
  readonly financial: StaffFinancial;
  readonly changes: readonly StaffChange[];
  /** Der Stand jeder Nachweisart des Trägers an der Akte (#4707). */
  readonly proofs: readonly StaffProof[];
  readonly contracts: readonly StaffContract[];
  /** Schulen, die eine gespeicherte Änderung noch nicht erreicht hat. */
  readonly unsyncedSchools: readonly string[];
}

/** Das Soll eines Einsatzorts in einer Eingabe. */
export interface StaffContractSiteInput {
  readonly schoolId: string;
  readonly staffId: string;
  readonly weekdayMinutes: readonly number[];
}

export interface StaffContractInput {
  readonly kind: StaffContractKind;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly pool: boolean;
  readonly sites: readonly StaffContractSiteInput[];
}

export interface StaffHolidayWeeksInput {
  readonly schoolId: string;
  readonly staffId: string;
  readonly fromWeek: string;
  readonly toWeek: string;
  readonly weekdayMinutes: readonly number[];
}

interface StaffFieldOption {
  /** `record` oder die ID der Schule, deren Beschäftigung den Wert bringt. */
  readonly source: string;
  readonly schoolName: string;
  readonly value: string;
}

interface StaffFieldPreview {
  readonly field: StaffRecordField;
  readonly options: readonly StaffFieldOption[];
  readonly conflict: boolean;
}

export interface StaffLinkPreview {
  readonly record: StaffRecordSummary | null;
  readonly members: readonly StaffCandidate[];
  readonly fields: readonly StaffFieldPreview[];
}

interface StaffMemberRef {
  readonly schoolId: string;
  readonly staffId: string;
}

export interface StaffLinkInput {
  readonly recordId: string | null;
  readonly members: readonly StaffMemberRef[];
  readonly choices: Readonly<Partial<Record<StaffRecordField, string>>>;
}

function mapSummary(
  record: traegerStaffRecordsContract.TraegerStaffRecordSummary,
): StaffRecordSummary {
  return {
    id: record.id,
    firstName: record.first_name,
    lastName: record.last_name,
    birthday: record.birthday ?? "",
    personnelNumber: record.personnel_number,
    hasFinancial: record.has_financial,
    employments: (record.employments ?? []).map((employment) => ({
      schoolId: employment.school_id,
      schoolName: employment.school_name,
      staffId: employment.staff_id,
      active: employment.active,
      viaPool: employment.via_pool,
    })),
  };
}

function mapCandidate(
  candidate: traegerStaffRecordsContract.TraegerStaffCandidate,
): StaffCandidate {
  return {
    schoolId: candidate.school_id,
    schoolName: candidate.school_name,
    staffId: candidate.staff_id,
    firstName: candidate.first_name,
    lastName: candidate.last_name,
    birthday: candidate.birthday ?? "",
    personnelNumber: candidate.personnel_number,
    hasAccount: candidate.has_account,
  };
}

function mapFinancial(
  financial: traegerStaffRecordsContract.TraegerStaffFinancial,
): StaffFinancial {
  return {
    iban: financial.iban,
    taxId: financial.tax_id,
    socialSecurityNumber: financial.social_security_number,
  };
}

function mapDetail(
  record: traegerStaffRecordsContract.TraegerStaffRecordDetail,
): StaffRecordDetail {
  return {
    ...mapSummary(record),
    financial: mapFinancial(record.financial),
    changes: (record.changes ?? []).map((change) => ({
      kind: knownEnum(STAFF_CHANGE_KIND_VALUES, change.kind),
      field: knownEnum(STAFF_CHANGE_FIELD_VALUES, change.field),
      value: change.value,
      schoolName: change.school_name ?? "",
      occurredAt: change.occurred_at,
    })),
    proofs: (record.proofs ?? []).map(mapStaffProof),
    contracts: (record.contracts ?? []).map(mapContract),
    unsyncedSchools: record.unsynced_schools ?? [],
  };
}

function mapContract(
  contract: traegerStaffRecordsContract.TraegerStaffContract,
): StaffContract {
  return {
    id: contract.id,
    kind: knownEnum(STAFF_CONTRACT_KIND_VALUES, contract.kind),
    startsOn: requiredDay(contract.starts_on, "staff_contract.starts_on"),
    endsOn: contract.ends_on,
    pool: contract.pool,
    sites: (contract.sites ?? []).map((site) => ({
      schoolId: site.school_id,
      schoolName: site.school_name,
      staffId: site.staff_id,
      changeableFrom: requiredDay(
        site.changeable_from,
        "staff_contract_site.changeable_from",
      ),
      soll: (site.soll ?? []).map((soll) => ({
        validFrom: requiredDay(
          soll.valid_from,
          "staff_contract_soll.valid_from",
        ),
        weekdayMinutes: soll.weekday_minutes ?? [],
      })),
    })),
    holidayWeeks: (contract.holiday_weeks ?? []).map((week) => ({
      schoolId: week.school_id,
      schoolName: week.school_name,
      staffId: week.staff_id,
      weekStart: requiredDay(
        week.week_start,
        "staff_contract_holiday_week.week_start",
      ),
      weekdayMinutes: week.weekday_minutes ?? [],
    })),
  };
}

const siteBody = (
  site: StaffContractSiteInput,
): traegerStaffRecordsContract.SiteSollPayload => ({
  school_id: site.schoolId,
  staff_id: site.staffId,
  weekday_minutes: [...site.weekdayMinutes],
});

function mapStaffOverview(
  data: traegerStaffRecordsContract.TraegerStaffOverview,
): StaffOverview {
  return {
    release: data.release
      ? {
          representation: knownEnum(
            STAFF_REPRESENTATION_VALUES,
            data.release.representation,
          ),
          releasedAt: data.release.released_at,
        }
      : null,
    schools: (data.schools ?? []).map((school) => ({
      id: school.id,
      name: school.name,
    })),
    records: (data.records ?? []).map(mapSummary),
    suggestions: (data.suggestions ?? []).map((suggestion) => ({
      reason: knownEnum(STAFF_MATCH_REASON_VALUES, suggestion.reason),
      recordId: suggestion.staff_record_id ?? null,
      members: (suggestion.members ?? []).map(mapCandidate),
    })),
  };
}

function linkBody(
  input: StaffLinkInput,
): traegerStaffRecordsContract.StaffLinkRequest {
  return {
    staff_record_id: input.recordId === null ? null : input.recordId,
    members: input.members.map((member) => ({
      school_id: member.schoolId,
      staff_id: member.staffId,
    })),
    choices: input.choices,
  };
}

export async function fetchStaffOverview(): Promise<StaffOverview> {
  return mapStaffOverview(await bffJson("org", "GET /traeger/staff-records/"));
}

/** Die Liste der Akten als Datei; der Download steht im Zugriffsprotokoll. */
export function downloadStaffRecordList(
  format: TraegerListFormat,
): Promise<TraegerListFile> {
  return downloadTraegerList(`${BASE}/export`, format);
}

export async function fetchStaffRecord(id: string): Promise<StaffRecordDetail> {
  return mapDetail(
    await bffJson("org", "GET /traeger/staff-records/{id}", { params: { id } }),
  );
}

export async function previewStaffLink(
  input: StaffLinkInput,
): Promise<StaffLinkPreview> {
  const data = await bffJson(
    "org",
    "POST /traeger/staff-records/link-preview",
    { body: linkBody(input) },
  );
  return {
    record: data.record ? mapSummary(data.record) : null,
    members: (data.members ?? []).map(mapCandidate),
    // A field this build does not know cannot be chosen here: it stays out.
    fields: (data.fields ?? []).flatMap((entry) => {
      const field = knownEnum(STAFF_RECORD_FIELD_VALUES, entry.field);
      if (field === undefined) return [];
      return [
        {
          field,
          conflict: entry.conflict,
          options: (entry.options ?? []).map((option) => ({
            source: option.source,
            schoolName: option.school_name ?? "",
            value: option.value,
          })),
        },
      ];
    }),
  };
}

export async function linkStaff(
  input: StaffLinkInput,
): Promise<StaffRecordDetail> {
  return mapDetail(
    await bffJson("org", "POST /traeger/staff-records/", {
      body: linkBody(input),
    }),
  );
}

export async function updateStaffPersonnelNumber(
  id: string,
  value: string | null,
): Promise<StaffRecordDetail> {
  return mapDetail(
    await bffJson("org", "PUT /traeger/staff-records/{id}/personnel-number", {
      params: { id },
      body: {
        personnel_number: value,
      } satisfies traegerStaffRecordsContract.PersonnelNumberRequest,
    }),
  );
}

/** Name und Geburtstag der Akte, wie die Personalverwaltung sie korrigiert. */
export interface StaffPersonInput {
  readonly firstName: string;
  readonly lastName: string;
  /** Kalendertag `YYYY-MM-DD`; leer entfernt den Geburtstag. */
  readonly birthday: string;
}

/**
 * Korrigiert Vorname, Nachname und Geburtstag der Akte (#7379). Jeder
 * geänderte Wert steht danach mit seinem alten Wert im Verlauf; die
 * Angaben an den Schulen bleiben unverändert. Die Antwort trägt keine Akte:
 * Wer sie zeigt, lädt sie neu.
 */
export async function updateStaffPerson(
  id: string,
  input: StaffPersonInput,
): Promise<void> {
  const body: traegerStaffRecordsContract.PersonRequest = {
    first_name: input.firstName,
    last_name: input.lastName,
    birthday: input.birthday === "" ? null : input.birthday,
  };
  await bffJson("org", "PUT /traeger/staff-records/{id}/person", {
    params: { id },
    body,
  });
}

export async function revealStaffFinancial(
  id: string,
): Promise<StaffFinancial> {
  return mapFinancial(
    await bffJson("org", "POST /traeger/staff-records/{id}/financial/reveal", {
      params: { id },
    }),
  );
}

export async function updateStaffFinancial(
  id: string,
  values: StaffFinancial,
): Promise<void> {
  await bffJson("org", "PUT /traeger/staff-records/{id}/financial", {
    params: { id },
    body: {
      iban: values.iban,
      tax_id: values.taxId,
      social_security_number: values.socialSecurityNumber,
    } satisfies traegerStaffRecordsContract.StaffFinancialRequest,
  });
}

/** Legt einen Arbeitsvertrag mit dem ersten Soll je Einsatzort an (#4706). */
export async function createStaffContract(
  recordId: string,
  input: StaffContractInput,
): Promise<StaffRecordDetail> {
  return mapDetail(
    await bffJson("org", "POST /traeger/staff-records/{id}/contracts", {
      params: { id: recordId },
      body: {
        kind: input.kind,
        starts_on: input.startsOn,
        ends_on: input.endsOn,
        pool: input.pool,
        sites: input.sites.map(siteBody),
      } satisfies traegerStaffRecordsContract.CreateContractRequest,
    }),
  );
}

/** Ändert Art und letzten Tag eines Vertrags. */
export async function updateStaffContract(
  recordId: string,
  contractId: string,
  input: {
    readonly kind: StaffContractKind;
    readonly endsOn: string | null;
    readonly pool: boolean;
  },
): Promise<StaffRecordDetail> {
  return mapDetail(
    await bffJson(
      "org",
      "PUT /traeger/staff-records/{id}/contracts/{contractId}",
      {
        params: { id: recordId, contractId },
        body: {
          kind: input.kind,
          ends_on: input.endsOn,
          pool: input.pool,
        } satisfies traegerStaffRecordsContract.UpdateContractRequest,
      },
    ),
  );
}

/** Setzt ein neues Soll ab einem Tag für die genannten Einsatzorte. */
export async function changeStaffContractSoll(
  recordId: string,
  contractId: string,
  validFrom: string,
  sites: readonly StaffContractSiteInput[],
): Promise<StaffRecordDetail> {
  return mapDetail(
    await bffJson(
      "org",
      "POST /traeger/staff-records/{id}/contracts/{contractId}/soll",
      {
        params: { id: recordId, contractId },
        body: {
          valid_from: validFrom,
          sites: sites.map(siteBody),
        } satisfies traegerStaffRecordsContract.ContractSollRequest,
      },
    ),
  );
}

/** Trägt das Ferien-Soll für eine oder mehrere Wochen ein. */
export async function addStaffHolidayWeeks(
  recordId: string,
  contractId: string,
  input: StaffHolidayWeeksInput,
): Promise<StaffRecordDetail> {
  return mapDetail(
    await bffJson(
      "org",
      "POST /traeger/staff-records/{id}/contracts/{contractId}/holiday-weeks",
      {
        params: { id: recordId, contractId },
        body: {
          school_id: input.schoolId,
          staff_id: input.staffId,
          from_week: input.fromWeek,
          to_week: input.toWeek,
          weekday_minutes: [...input.weekdayMinutes],
        } satisfies traegerStaffRecordsContract.HolidayWeeksRequest,
      },
    ),
  );
}

/** Löscht eine Ferienwoche an einem Einsatzort. */
export async function deleteStaffHolidayWeek(
  recordId: string,
  contractId: string,
  schoolId: string,
  weekStart: string,
): Promise<StaffRecordDetail> {
  return mapDetail(
    await bffJson(
      "org",
      "DELETE /traeger/staff-records/{id}/contracts/{contractId}/holiday-weeks/{schoolId}/{weekStart}",
      { params: { id: recordId, contractId, schoolId, weekStart } },
    ),
  );
}

/** Löscht einen Vertrag, der noch nicht gezählt hat. */
export async function deleteStaffContract(
  recordId: string,
  contractId: string,
): Promise<StaffRecordDetail> {
  return mapDetail(
    await bffJson(
      "org",
      "DELETE /traeger/staff-records/{id}/contracts/{contractId}",
      { params: { id: recordId, contractId } },
    ),
  );
}

export async function dissolveStaffRecord(id: string): Promise<void> {
  await bffJson("org", "DELETE /traeger/staff-records/{id}", {
    params: { id },
  });
}

/** Der Name einer Person, wie die Liste ihn zeigt. */
export function staffName(person: {
  readonly firstName: string;
  readonly lastName: string;
}): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

/**
 * „Nachname, Vorname“ for a table row, so the column reads alphabetically
 * (TENANT-PAGE-SPEC Regel 11). Tiles and sentences keep `staffName`.
 */
export function staffTableName(person: {
  readonly firstName: string;
  readonly lastName: string;
}): string {
  return [person.lastName.trim(), person.firstName.trim()]
    .filter((part) => part !== "")
    .join(", ");
}

/** „Person einstellen“ (#7206): Person, Arbeitsvertrag und Einsatzorte. */
export interface StaffHireInput {
  readonly firstName: string;
  readonly lastName: string;
  /** Kalendertag `YYYY-MM-DD`, Pflicht. */
  readonly birthday: string;
  readonly email: string;
  readonly phone: string;
  readonly personnelNumber: string;
  readonly kind: StaffContractKind;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly sites: readonly {
    readonly schoolId: string;
    readonly weekdayMinutes: readonly number[];
  }[];
  /** Stellt ein, obwohl es eine Person, die dieselbe sein könnte, schon gibt. */
  readonly confirmDuplicate: boolean;
}

/**
 * Warum moto eine Person für dieselbe hält (#7378): gleicher Name und
 * gleiches Geburtsdatum, gleicher Name einer Person ohne Geburtsdatum oder
 * gleiche E-Mail-Adresse.
 */
export type StaffHireMatchReason = "name_birthday" | "name" | "email";

const HIRE_MATCH_REASONS: readonly StaffHireMatchReason[] = [
  "name_birthday",
  "name",
  "email",
];

interface StaffHireMatchCommon {
  readonly firstName: string;
  readonly lastName: string;
  /** Mindestens ein Grund, in der Reihenfolge Name, dann E-Mail. */
  readonly reasons: readonly StaffHireMatchReason[];
}

/**
 * Eine Person, die vielleicht die ist, die gerade eingestellt wird: eine
 * Akte des Trägers oder eine Person ohne Akte an einer Schule.
 */
export type StaffHireMatch =
  | (StaffHireMatchCommon & {
      readonly kind: "record";
      readonly recordId: string;
    })
  | (StaffHireMatchCommon & {
      readonly kind: "school";
      readonly schoolId: string;
      readonly schoolName: string;
      readonly staffId: string;
    });

/**
 * One entry of `details.matches` of the hire refusal. It travels in the error
 * envelope, which no contract decoder reads, so its IDs may still be numbers.
 */
interface HireMatchDetails {
  kind?: unknown;
  staff_record_id?: unknown;
  school_id?: unknown;
  school_name?: unknown;
  staff_id?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  reasons?: unknown;
}

function hireMatchReasons(raw: unknown): StaffHireMatchReason[] {
  if (!Array.isArray(raw)) return [];
  return HIRE_MATCH_REASONS.filter((reason) => raw.includes(reason));
}

function hireMatch(match: HireMatchDetails): StaffHireMatch | null {
  const common = {
    firstName: typeof match.first_name === "string" ? match.first_name : "",
    lastName: typeof match.last_name === "string" ? match.last_name : "",
    reasons: hireMatchReasons(match.reasons),
  };
  if (match.kind === "record" && match.staff_record_id != null) {
    return {
      ...common,
      kind: "record",
      recordId: String(match.staff_record_id),
    };
  }
  if (
    match.kind === "school" &&
    typeof match.school_name === "string" &&
    match.school_id != null &&
    match.staff_id != null
  ) {
    return {
      ...common,
      kind: "school",
      schoolId: String(match.school_id),
      schoolName: match.school_name,
      staffId: String(match.staff_id),
    };
  }
  return null;
}

/**
 * Die Treffer aus der Antwort auf eine angehaltene Einstellung
 * (`workforce.traeger_staff_hire_duplicate`). Unbekannte Einträge bleiben
 * draußen.
 */
export function staffHireMatches(
  details: Readonly<Record<string, unknown>> | undefined,
): StaffHireMatch[] {
  const raw = Array.isArray(details?.matches) ? details.matches : [];
  const matches: StaffHireMatch[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const match = hireMatch(entry as HireMatchDetails);
    if (match) matches.push(match);
  }
  return matches;
}

/** Was eine abgebrochene Einstellung schon angelegt hat. */
export interface StaffHireIncomplete {
  /** Die Schulen, an denen es die Person jetzt gibt. */
  readonly schools: readonly string[];
  /** Die Akte, wenn sie schon gespeichert ist. */
  readonly recordId: string | null;
}

/**
 * Was die Antwort `workforce.traeger_staff_hire_incomplete` nennt: die
 * Schulen mit der neuen Person und, wenn es sie schon gibt, die Akte.
 */
export function staffHireIncomplete(
  details: Readonly<Record<string, unknown>> | undefined,
): StaffHireIncomplete {
  const schools = Array.isArray(details?.schools) ? details.schools : [];
  const recordId = details?.staff_record_id;
  return {
    schools: schools.filter(
      (school): school is string => typeof school === "string",
    ),
    recordId:
      typeof recordId === "number" || typeof recordId === "string"
        ? String(recordId)
        : null,
  };
}

/**
 * Stellt eine neue Person ein: moto legt die Akte und den Arbeitsvertrag an
 * und an jeder Schule die Person mit ihrer Beschäftigung.
 */
export async function hireStaff(
  input: StaffHireInput,
): Promise<StaffRecordDetail> {
  return mapDetail(
    await bffJson("org", "POST /traeger/staff-records/hire", {
      body: {
        first_name: input.firstName,
        last_name: input.lastName,
        birthday: input.birthday,
        email: input.email || null,
        phone: input.phone || null,
        personnel_number: input.personnelNumber || null,
        contract: {
          kind: input.kind,
          starts_on: input.startsOn,
          ends_on: input.endsOn,
        },
        sites: input.sites.map((site) => ({
          school_id: site.schoolId,
          weekday_minutes: [...site.weekdayMinutes],
        })),
        confirm_duplicate: input.confirmDuplicate,
      } satisfies traegerStaffRecordsContract.HireRequest,
    }),
  );
}
