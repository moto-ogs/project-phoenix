import { bffFile, bffJson } from "~/lib/bff-fetch";
/**
 * Berichte des Trägers nach Vorlage (#4716, Spec #4611 Stories 115 und 116).
 *
 * Ein Bericht zählt die Schulen des Trägers an einem Stichtag: Kinder je
 * Standort und Betreuungsform, Personal, Fehlzeiten sowie Belegung und
 * Nachfrage. Eine Vorlage des Trägers wählt die Abschnitte, den üblichen
 * Stichtag und ordnet Schulen einem Sozialraum zu. Nur Zahlen, keine Namen
 * von Kindern oder Personal. Backend-IDs werden zu Strings.
 */

import { filenameFromDisposition } from "./file-download";
import type * as traegerReportsContract from "./contract/traeger-reports.generated";
import type * as traegerReportTemplatesContract from "./contract/traeger-report-templates.generated";
import { requiredDay } from "./contract/required-day";

/** Das Recht, das Vorlagen anlegen, ändern und löschen lässt. */
export const REPORT_TEMPLATES_MANAGE_RIGHT = "traeger_settings:manage";

/** Die Abschnitte eines Berichts, in der Reihenfolge des Berichts. */
export const REPORT_SECTIONS = [
  "children",
  "staff",
  "absences",
  "demand",
] as const;

export type ReportSection = (typeof REPORT_SECTIONS)[number];

export type ReportExportFormat = "pdf" | "xlsx" | "csv";

/** Die Zahlen einer Schule, eines Sozialraums oder aller Schulen. */
export interface ReportFigures {
  readonly children: number;
  readonly withoutCareForm: number;
  readonly staff: number;
  /** Kinder je Person im Personal; `null` ohne Personal. */
  readonly childrenPerStaff: number | null;
  readonly presentDays: number;
  readonly sickDays: number;
  readonly excusedDays: number;
  /** Gemeldete Fehltage in Prozent aller Tage; `null` ohne Tage. */
  readonly absenceRate: number | null;
  readonly places: number;
  readonly bookedPlaces: number;
  readonly freePlaces: number;
  readonly booked: number;
  /** Anmeldungen, über die noch niemand entschieden hat (Stand heute). */
  readonly open: number;
  /** Kinder auf der Warteliste (Stand heute). */
  readonly waitlisted: number;
  /** Gebucht, offen und Warteliste zusammen. */
  readonly demand: number;
}

export interface ReportCareForm {
  readonly name: string;
  readonly children: number;
  /** Die Plätze; `null` ohne Platzgrenze. */
  readonly capacity: number | null;
  readonly active: boolean;
}

interface ReportSchool {
  readonly id: string;
  readonly name: string;
  readonly city: string;
  /** Der Sozialraum aus der Vorlage; `null` ohne Zuordnung. */
  readonly district: string | null;
  /** Der erste Tag mit gespeicherten Check-ins, `YYYY-MM-DD`. */
  readonly attendanceFrom: string | null;
  readonly figures: ReportFigures;
  readonly careForms: readonly ReportCareForm[];
}

interface ReportGroup {
  readonly name: string;
  readonly schools: number;
  readonly figures: ReportFigures;
  readonly careForms: readonly ReportCareForm[];
}

interface ReportDistrict extends ReportGroup {
  readonly unmapped: boolean;
}

export interface KeyDateReport {
  readonly keyDate: string;
  readonly asOf: string;
  readonly template: { readonly id: string; readonly name: string } | null;
  readonly sections: readonly ReportSection[];
  /** Der Zeitraum der Fehlzeiten; `null` ohne Abschnitt oder ohne Tag. */
  readonly absenceWindow: { readonly from: string; readonly to: string } | null;
  readonly schools: readonly ReportSchool[];
  /** Die Sozialräume, leer ohne Zuordnung in der Vorlage. */
  readonly districts: readonly ReportDistrict[];
  readonly total: ReportGroup;
}

interface ReportTemplateDistrict {
  readonly schoolId: string;
  readonly district: string;
}

export interface ReportTemplate {
  readonly id: string;
  readonly name: string;
  readonly sections: readonly ReportSection[];
  readonly keyDateMonth: number;
  readonly keyDateDay: number;
  readonly districts: readonly ReportTemplateDistrict[];
  readonly updatedAt: string | null;
  /** Der gelesene Stand, den eine Änderung mitschickt (ADR 0311). */
  readonly version: string;
}

export type ReportTemplateInput = Omit<
  ReportTemplate,
  "id" | "updatedAt" | "version"
>;

function isSection(value: string): value is ReportSection {
  return (REPORT_SECTIONS as readonly string[]).includes(value);
}

/** Die bekannten Abschnitte, in der Reihenfolge des Berichts. */
export function sectionsOf(values: readonly string[]): ReportSection[] {
  const known = new Set(values.filter(isSection));
  return REPORT_SECTIONS.filter((section) => known.has(section));
}

function figuresFromBackend(
  figures: traegerReportsContract.KeyDateFigures,
): ReportFigures {
  return {
    children: figures.children,
    withoutCareForm: figures.without_care_form,
    staff: figures.staff,
    childrenPerStaff: figures.children_per_staff,
    presentDays: figures.present_days,
    sickDays: figures.sick_days,
    excusedDays: figures.excused_days,
    absenceRate: figures.absence_rate,
    places: figures.places,
    bookedPlaces: figures.booked_places,
    freePlaces: figures.free_places,
    booked: figures.booked,
    open: figures.open,
    waitlisted: figures.waitlisted,
    demand: figures.demand,
  };
}

function careFormsFromBackend(
  forms: traegerReportsContract.KeyDateCareForm[] | null,
): ReportCareForm[] {
  return (forms ?? []).map((form) => ({
    name: form.name,
    children: form.children,
    capacity: form.capacity,
    active: form.active,
  }));
}

function groupFromBackend(
  group:
    | traegerReportsContract.KeyDateDistrict
    | traegerReportsContract.KeyDateTotal,
  name: string,
): ReportGroup {
  return {
    name,
    schools: group.schools,
    figures: figuresFromBackend(group.figures),
    careForms: careFormsFromBackend(group.care_forms),
  };
}

export function reportFromBackend(
  body: traegerReportsContract.KeyDateReport,
): KeyDateReport {
  const window = body.absence_window;
  return {
    keyDate: requiredDay(body.key_date, "key_date_report.key_date"),
    asOf: body.as_of,
    template: body.template,
    sections: sectionsOf(body.sections ?? []),
    absenceWindow: window
      ? {
          from: requiredDay(window.from, "key_date_report.absence_window.from"),
          to: requiredDay(window.to, "key_date_report.absence_window.to"),
        }
      : null,
    schools: (body.schools ?? []).map((school) => ({
      id: school.id,
      name: school.name,
      city: school.city,
      district: school.district,
      attendanceFrom: school.attendance_from,
      figures: figuresFromBackend(school.figures),
      careForms: careFormsFromBackend(school.care_forms),
    })),
    districts: (body.districts ?? []).map((group) => ({
      ...groupFromBackend(group, group.name),
      unmapped: group.unmapped,
    })),
    total: groupFromBackend(body.total, ""),
  };
}

function templateFromBackend(
  template: traegerReportTemplatesContract.TraegerReportTemplate,
): ReportTemplate {
  return {
    id: template.id,
    name: template.name,
    sections: sectionsOf(template.sections ?? []),
    keyDateMonth: template.key_date_month,
    keyDateDay: template.key_date_day,
    districts: (template.districts ?? []).map((entry) => ({
      schoolId: entry.school_id,
      district: entry.district,
    })),
    updatedAt: template.updated_at,
    version: template.version,
  };
}

function templateToBackend(
  input: ReportTemplateInput,
): traegerReportTemplatesContract.ReportTemplateRequest {
  return {
    name: input.name.trim(),
    sections: sectionsOf(input.sections),
    key_date_month: input.keyDateMonth,
    key_date_day: input.keyDateDay,
    districts: input.districts
      .filter((entry) => entry.district.trim() !== "")
      .map((entry) => ({
        school_id: entry.schoolId,
        district: entry.district.trim(),
      })),
  };
}

export function reportQuery(keyDate: string, templateId: string | null) {
  return { key_date: keyDate, template: templateId || undefined };
}

/** Der Bericht zum Stichtag, mit oder ohne Vorlage. */
export async function fetchKeyDateReport(
  keyDate: string,
  templateId: string | null,
): Promise<KeyDateReport> {
  return reportFromBackend(
    await bffJson("org", "GET /traeger/reports/key-date", {
      query: reportQuery(keyDate, templateId),
    }),
  );
}

/** Der Bericht als PDF, Excel oder CSV. */
export async function downloadKeyDateReport(
  keyDate: string,
  templateId: string | null,
  format: ReportExportFormat,
): Promise<{ readonly blob: Blob; readonly filename: string | null }> {
  const response = await bffFile(
    "org",
    "GET /traeger/reports/key-date/export",
    {
      query: { ...reportQuery(keyDate, templateId), format },
    },
  );
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response),
  };
}

/** Die Vorlagen des Trägers, nach Namen. */
export async function fetchReportTemplates(): Promise<ReportTemplate[]> {
  return mapReportTemplates(
    await bffJson("org", "GET /traeger/report-templates/"),
  );
}

export function mapReportTemplates(
  body: traegerReportTemplatesContract.TraegerReportTemplate[],
): ReportTemplate[] {
  return body.map(templateFromBackend);
}

export async function createReportTemplate(
  input: ReportTemplateInput,
): Promise<ReportTemplate> {
  return templateFromBackend(
    await bffJson("org", "POST /traeger/report-templates/", {
      body: templateToBackend(input),
    }),
  );
}

/**
 * Ändert eine Vorlage über dem Stand, mit dem sie gelesen wurde (ADR 0311);
 * eine inzwischen geänderte Vorlage antwortet `general.changed_since_read`.
 */
export async function updateReportTemplate(
  id: string,
  input: ReportTemplateInput,
  expectedVersion: string,
): Promise<ReportTemplate> {
  return templateFromBackend(
    await bffJson("org", "PUT /traeger/report-templates/{id}", {
      params: { id },
      body: { ...templateToBackend(input), expected_version: expectedVersion },
    }),
  );
}

export async function deleteReportTemplate(id: string): Promise<void> {
  await bffJson("org", "DELETE /traeger/report-templates/{id}", {
    params: { id },
  });
}
