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
import {
  downloadTraegerList,
  type TraegerListFile,
  type TraegerListFormat,
} from "./traeger-list-export";
import { traegerRequest } from "~/lib/traeger-api";
import {
  mapStaffProof,
  type BackendProof,
  type StaffProof,
} from "~/lib/traeger-staff-proofs-api";

const BASE = "/api/traeger/staff-records";

/** Die Felder einer Akte, in der Reihenfolge der Vorschau. */
export type StaffRecordField =
  | "first_name"
  | "last_name"
  | "birthday"
  | "personnel_number"
  | "iban"
  | "tax_id"
  | "social_security_number";

/** Warum moto Beschäftigungen zusammen vorschlägt (ADR 0089 Abschnitt 5). */
export type StaffMatchReason =
  "same_account" | "same_personnel_number" | "same_name_birthday" | "single";

type StaffRepresentation = "agreement" | "none";

interface StaffRelease {
  readonly representation: StaffRepresentation;
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
  readonly reason: StaffMatchReason;
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

/** Die Felder eines Vertragseintrags im Verlauf (#4706). */
type StaffContractChangeField = "contract" | "contract_soll" | "holiday_week";

export interface StaffChange {
  /** `imported`: angelegt oder ergänzt vom Personal-Import (#4724). */
  readonly kind:
    "linked" | "not_chosen" | "changed" | "added" | "removed" | "imported";
  /** `record`: die ganze Akte, die der Personal-Import angelegt hat. */
  readonly field:
    StaffRecordField | "school" | "record" | StaffContractChangeField;
  readonly value: string;
  readonly schoolName: string;
  readonly occurredAt: string;
}

/** Die Art eines Arbeitsvertrags (#4706). */
export type StaffContractKind =
  "part_time" | "full_time" | "minijob" | "uebungsleiter" | "ehrenamt";

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
  readonly kind: StaffContractKind;
  readonly startsOn: string;
  /** Letzter Tag oder `null`, solange der Vertrag unbefristet läuft. */
  readonly endsOn: string | null;
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

interface BackendEmployment {
  school_id: number;
  school_name: string;
  staff_id: number;
  active: boolean;
}

interface BackendSummary {
  id: number;
  first_name: string;
  last_name: string;
  birthday?: string;
  personnel_number: string | null;
  has_financial: boolean;
  employments: BackendEmployment[] | null;
}

interface BackendCandidate {
  school_id: number;
  school_name: string;
  staff_id: number;
  first_name: string;
  last_name: string;
  birthday?: string;
  personnel_number: string | null;
  has_account: boolean;
}

interface BackendFinancial {
  iban: string | null;
  tax_id: string | null;
  social_security_number: string | null;
}

interface BackendContract {
  id: number;
  kind: StaffContractKind;
  starts_on: string;
  ends_on: string | null;
  sites:
    | {
        school_id: number;
        school_name: string;
        staff_id: number;
        changeable_from: string;
        soll: { valid_from: string; weekday_minutes: number[] }[] | null;
      }[]
    | null;
  holiday_weeks:
    | {
        school_id: number;
        school_name: string;
        staff_id: number;
        week_start: string;
        weekday_minutes: number[];
      }[]
    | null;
}

interface BackendDetail extends BackendSummary {
  contracts?: BackendContract[] | null;
  unsynced_schools?: string[] | null;
  financial: BackendFinancial;
  proofs?: BackendProof[] | null;
  changes:
    | {
        kind: StaffChange["kind"];
        field: StaffChange["field"];
        value: string;
        school_name?: string;
        occurred_at: string;
      }[]
    | null;
}

interface BackendOverview {
  release: { representation: StaffRepresentation; released_at: string } | null;
  schools: { id: number; name: string }[] | null;
  records: BackendSummary[] | null;
  suggestions:
    | {
        reason: StaffMatchReason;
        staff_record_id?: number;
        members: BackendCandidate[] | null;
      }[]
    | null;
}

interface BackendPreview {
  record?: BackendSummary | null;
  members: BackendCandidate[] | null;
  fields:
    | {
        field: StaffRecordField;
        conflict: boolean;
        options:
          { source: string; school_name?: string; value: string }[] | null;
      }[]
    | null;
}

function mapSummary(record: BackendSummary): StaffRecordSummary {
  return {
    id: String(record.id),
    firstName: record.first_name,
    lastName: record.last_name,
    birthday: record.birthday ?? "",
    personnelNumber: record.personnel_number,
    hasFinancial: record.has_financial,
    employments: (record.employments ?? []).map((employment) => ({
      schoolId: String(employment.school_id),
      schoolName: employment.school_name,
      staffId: String(employment.staff_id),
      active: employment.active,
    })),
  };
}

function mapCandidate(candidate: BackendCandidate): StaffCandidate {
  return {
    schoolId: String(candidate.school_id),
    schoolName: candidate.school_name,
    staffId: String(candidate.staff_id),
    firstName: candidate.first_name,
    lastName: candidate.last_name,
    birthday: candidate.birthday ?? "",
    personnelNumber: candidate.personnel_number,
    hasAccount: candidate.has_account,
  };
}

function mapFinancial(financial: BackendFinancial): StaffFinancial {
  return {
    iban: financial.iban,
    taxId: financial.tax_id,
    socialSecurityNumber: financial.social_security_number,
  };
}

function mapDetail(record: BackendDetail): StaffRecordDetail {
  return {
    ...mapSummary(record),
    financial: mapFinancial(record.financial),
    changes: (record.changes ?? []).map((change) => ({
      kind: change.kind,
      field: change.field,
      value: change.value,
      schoolName: change.school_name ?? "",
      occurredAt: change.occurred_at,
    })),
    proofs: (record.proofs ?? []).map(mapStaffProof),
    contracts: (record.contracts ?? []).map(mapContract),
    unsyncedSchools: record.unsynced_schools ?? [],
  };
}

function mapContract(contract: BackendContract): StaffContract {
  return {
    id: String(contract.id),
    kind: contract.kind,
    startsOn: contract.starts_on,
    endsOn: contract.ends_on,
    sites: (contract.sites ?? []).map((site) => ({
      schoolId: String(site.school_id),
      schoolName: site.school_name,
      staffId: String(site.staff_id),
      changeableFrom: site.changeable_from,
      soll: (site.soll ?? []).map((soll) => ({
        validFrom: soll.valid_from,
        weekdayMinutes: soll.weekday_minutes,
      })),
    })),
    holidayWeeks: (contract.holiday_weeks ?? []).map((week) => ({
      schoolId: String(week.school_id),
      schoolName: week.school_name,
      staffId: String(week.staff_id),
      weekStart: week.week_start,
      weekdayMinutes: week.weekday_minutes,
    })),
  };
}

const siteBody = (site: StaffContractSiteInput) => ({
  school_id: site.schoolId,
  staff_id: site.staffId,
  weekday_minutes: site.weekdayMinutes,
});

function mapStaffOverview(data: BackendOverview): StaffOverview {
  return {
    release: data.release
      ? {
          representation: data.release.representation,
          releasedAt: data.release.released_at,
        }
      : null,
    schools: (data.schools ?? []).map((school) => ({
      id: String(school.id),
      name: school.name,
    })),
    records: (data.records ?? []).map(mapSummary),
    suggestions: (data.suggestions ?? []).map((suggestion) => ({
      reason: suggestion.reason,
      recordId:
        suggestion.staff_record_id === undefined
          ? null
          : String(suggestion.staff_record_id),
      members: (suggestion.members ?? []).map(mapCandidate),
    })),
  };
}

function linkBody(input: StaffLinkInput) {
  return {
    staff_record_id: input.recordId === null ? null : Number(input.recordId),
    members: input.members.map((member) => ({
      school_id: Number(member.schoolId),
      staff_id: Number(member.staffId),
    })),
    choices: input.choices,
  };
}

const recordPath = (id: string, suffix = "") =>
  `${BASE}/${encodeURIComponent(id)}${suffix}`;

export async function fetchStaffOverview(): Promise<StaffOverview> {
  return mapStaffOverview(await traegerRequest<BackendOverview>(`${BASE}`));
}

/** Die Liste der Akten als Datei; der Download steht im Zugriffsprotokoll. */
export function downloadStaffRecordList(
  format: TraegerListFormat,
): Promise<TraegerListFile> {
  return downloadTraegerList(`${BASE}/export`, format);
}

export async function fetchStaffRecord(id: string): Promise<StaffRecordDetail> {
  return mapDetail(await traegerRequest<BackendDetail>(recordPath(id)));
}

export async function previewStaffLink(
  input: StaffLinkInput,
): Promise<StaffLinkPreview> {
  const data = await traegerRequest<BackendPreview>(`${BASE}/link-preview`, {
    method: "POST",
    body: linkBody(input),
  });
  return {
    record: data.record ? mapSummary(data.record) : null,
    members: (data.members ?? []).map(mapCandidate),
    fields: (data.fields ?? []).map((field) => ({
      field: field.field,
      conflict: field.conflict,
      options: (field.options ?? []).map((option) => ({
        source: option.source,
        schoolName: option.school_name ?? "",
        value: option.value,
      })),
    })),
  };
}

export async function linkStaff(
  input: StaffLinkInput,
): Promise<StaffRecordDetail> {
  return mapDetail(
    await traegerRequest<BackendDetail>(`${BASE}`, {
      method: "POST",
      body: linkBody(input),
    }),
  );
}

export async function updateStaffPersonnelNumber(
  id: string,
  value: string | null,
): Promise<StaffRecordDetail> {
  return mapDetail(
    await traegerRequest<BackendDetail>(recordPath(id, "/personnel-number"), {
      method: "PUT",
      body: { personnel_number: value },
    }),
  );
}

export async function revealStaffFinancial(
  id: string,
): Promise<StaffFinancial> {
  return mapFinancial(
    await traegerRequest<BackendFinancial>(
      recordPath(id, "/financial/reveal"),
      { method: "POST" },
    ),
  );
}

export async function updateStaffFinancial(
  id: string,
  values: StaffFinancial,
): Promise<void> {
  await traegerRequest<unknown>(recordPath(id, "/financial"), {
    method: "PUT",
    body: {
      iban: values.iban,
      tax_id: values.taxId,
      social_security_number: values.socialSecurityNumber,
    },
  });
}

const contractPath = (recordId: string, contractId: string, suffix = "") =>
  recordPath(recordId, `/contracts/${encodeURIComponent(contractId)}${suffix}`);

/** Legt einen Arbeitsvertrag mit dem ersten Soll je Einsatzort an (#4706). */
export async function createStaffContract(
  recordId: string,
  input: StaffContractInput,
): Promise<StaffRecordDetail> {
  return mapDetail(
    await traegerRequest<BackendDetail>(recordPath(recordId, "/contracts"), {
      method: "POST",
      body: {
        kind: input.kind,
        starts_on: input.startsOn,
        ends_on: input.endsOn,
        sites: input.sites.map(siteBody),
      },
    }),
  );
}

/** Ändert Art und letzten Tag eines Vertrags. */
export async function updateStaffContract(
  recordId: string,
  contractId: string,
  input: { readonly kind: StaffContractKind; readonly endsOn: string | null },
): Promise<StaffRecordDetail> {
  return mapDetail(
    await traegerRequest<BackendDetail>(contractPath(recordId, contractId), {
      method: "PUT",
      body: { kind: input.kind, ends_on: input.endsOn },
    }),
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
    await traegerRequest<BackendDetail>(
      contractPath(recordId, contractId, "/soll"),
      {
        method: "POST",
        body: { valid_from: validFrom, sites: sites.map(siteBody) },
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
    await traegerRequest<BackendDetail>(
      contractPath(recordId, contractId, "/holiday-weeks"),
      {
        method: "POST",
        body: {
          school_id: input.schoolId,
          staff_id: input.staffId,
          from_week: input.fromWeek,
          to_week: input.toWeek,
          weekday_minutes: input.weekdayMinutes,
        },
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
    await traegerRequest<BackendDetail>(
      contractPath(
        recordId,
        contractId,
        `/holiday-weeks/${encodeURIComponent(schoolId)}/${encodeURIComponent(weekStart)}`,
      ),
      { method: "DELETE" },
    ),
  );
}

/** Löscht einen Vertrag, der noch nicht gezählt hat. */
export async function deleteStaffContract(
  recordId: string,
  contractId: string,
): Promise<StaffRecordDetail> {
  return mapDetail(
    await traegerRequest<BackendDetail>(contractPath(recordId, contractId), {
      method: "DELETE",
    }),
  );
}

export async function dissolveStaffRecord(id: string): Promise<void> {
  await traegerRequest<unknown>(recordPath(id), { method: "DELETE" });
}

/** Der Name einer Person, wie die Liste ihn zeigt. */
export function staffName(person: {
  readonly firstName: string;
  readonly lastName: string;
}): string {
  return `${person.firstName} ${person.lastName}`.trim();
}
