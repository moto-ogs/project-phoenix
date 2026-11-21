/**
 * Berichte des Trägers nach Vorlage (#4716, Spec #4611 Stories 115 und 116).
 *
 * Ein Bericht zählt die Schulen des Trägers an einem Stichtag: Kinder je
 * Standort und Betreuungsform, Personal, Fehlzeiten sowie Belegung und
 * Nachfrage. Eine Vorlage des Trägers wählt die Abschnitte, den üblichen
 * Stichtag und ordnet Schulen einem Sozialraum zu. Nur Zahlen, keine Namen
 * von Kindern oder Personal. Backend-IDs werden zu Strings.
 */

import { apiErrorFromBody, transportFetch } from "./api-error";
import { filenameFromDisposition } from "./file-download";
import type {
  KeyDateCareForm as WireCareForm,
  KeyDateDistrict as WireDistrict,
  KeyDateFigures as WireFigures,
  KeyDateReport as WireReport,
  KeyDateTotal as WireTotal,
} from "./contract/traeger-reports.generated";
import type {
  ReportTemplateRequest,
  TraegerReportTemplate as WireTemplate,
} from "./contract/traeger-report-templates.generated";
import { requiredDay } from "./contract/required-day";
import { traegerRequest } from "./traeger-api";

/** Das Recht, das Vorlagen anlegen, ändern und löschen lässt. */
export const REPORT_TEMPLATES_MANAGE_RIGHT = "traeger_settings:manage";

const REPORT_PATH = "/api/traeger/reports/key-date";
const TEMPLATES_PATH = "/api/traeger/report-templates";

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
}

export type ReportTemplateInput = Omit<ReportTemplate, "id" | "updatedAt">;

function isSection(value: string): value is ReportSection {
  return (REPORT_SECTIONS as readonly string[]).includes(value);
}

/** Die bekannten Abschnitte, in der Reihenfolge des Berichts. */
export function sectionsOf(values: readonly string[]): ReportSection[] {
  const known = new Set(values.filter(isSection));
  return REPORT_SECTIONS.filter((section) => known.has(section));
}

function figuresFromBackend(figures: WireFigures): ReportFigures {
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

function careFormsFromBackend(forms: WireCareForm[] | null): ReportCareForm[] {
  return (forms ?? []).map((form) => ({
    name: form.name,
    children: form.children,
    capacity: form.capacity,
    active: form.active,
  }));
}

function groupFromBackend(
  group: WireDistrict | WireTotal,
  name: string,
): ReportGroup {
  return {
    name,
    schools: group.schools,
    figures: figuresFromBackend(group.figures),
    careForms: careFormsFromBackend(group.care_forms),
  };
}

function reportFromBackend(body: WireReport): KeyDateReport {
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

function templateFromBackend(template: WireTemplate): ReportTemplate {
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
  };
}

function templateToBackend(input: ReportTemplateInput): ReportTemplateRequest {
  return {
    name: input.name.trim(),
    sections: sectionsOf(input.sections),
    key_date_month: input.keyDateMonth,
    key_date_day: input.keyDateDay,
    districts: input.districts
      .filter((entry) => entry.district.trim() !== "")
      .map((entry) => ({
        school_id: Number(entry.schoolId),
        district: entry.district.trim(),
      })),
  };
}

function reportQuery(keyDate: string, templateId: string | null): string {
  const params = new URLSearchParams({ key_date: keyDate });
  if (templateId) params.set("template", templateId);
  return params.toString();
}

/** Der Bericht zum Stichtag, mit oder ohne Vorlage. */
export async function fetchKeyDateReport(
  keyDate: string,
  templateId: string | null,
): Promise<KeyDateReport> {
  return reportFromBackend(
    await traegerRequest<WireReport>(
      `${REPORT_PATH}?${reportQuery(keyDate, templateId)}`,
    ),
  );
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Der Bericht als PDF, Excel oder CSV. */
export async function downloadKeyDateReport(
  keyDate: string,
  templateId: string | null,
  format: ReportExportFormat,
): Promise<{ readonly blob: Blob; readonly filename: string | null }> {
  const response = await transportFetch(
    `${REPORT_PATH}/export?${reportQuery(keyDate, templateId)}&format=${format}`,
    { credentials: "include", cache: "no-store" },
  );
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

/** Die Vorlagen des Trägers, nach Namen. */
export async function fetchReportTemplates(): Promise<ReportTemplate[]> {
  const body = await traegerRequest<WireTemplate[]>(TEMPLATES_PATH);
  return body.map(templateFromBackend);
}

export async function createReportTemplate(
  input: ReportTemplateInput,
): Promise<ReportTemplate> {
  return templateFromBackend(
    await traegerRequest<WireTemplate>(TEMPLATES_PATH, {
      method: "POST",
      body: templateToBackend(input),
    }),
  );
}

export async function updateReportTemplate(
  id: string,
  input: ReportTemplateInput,
): Promise<ReportTemplate> {
  return templateFromBackend(
    await traegerRequest<WireTemplate>(
      `${TEMPLATES_PATH}/${encodeURIComponent(id)}`,
      { method: "PUT", body: templateToBackend(input) },
    ),
  );
}

export async function deleteReportTemplate(id: string): Promise<void> {
  await traegerRequest<unknown>(`${TEMPLATES_PATH}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
