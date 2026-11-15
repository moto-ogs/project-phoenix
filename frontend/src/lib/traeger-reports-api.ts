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

export interface KeyDateReport {
  readonly keyDate: string;
  readonly asOf: string;
  readonly template: { readonly id: string; readonly name: string } | null;
  readonly sections: readonly ReportSection[];
  /** Der Zeitraum der Fehlzeiten; `null` ohne Abschnitt oder ohne Tag. */
  readonly absenceWindow: { readonly from: string; readonly to: string } | null;
  readonly schools: readonly ReportSchool[];
  /** Die Sozialräume, leer ohne Zuordnung in der Vorlage. */
  readonly districts: readonly ReportGroup[];
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

interface BackendFigures {
  readonly children?: number;
  readonly without_care_form?: number;
  readonly staff?: number;
  readonly children_per_staff?: number | null;
  readonly present_days?: number;
  readonly sick_days?: number;
  readonly excused_days?: number;
  readonly absence_rate?: number | null;
  readonly places?: number;
  readonly booked_places?: number;
  readonly free_places?: number;
  readonly booked?: number;
  readonly open?: number;
  readonly waitlisted?: number;
  readonly demand?: number;
}

interface BackendCareForm {
  readonly name: string;
  readonly children?: number;
  readonly capacity?: number | null;
  readonly active?: boolean;
}

interface BackendGroup {
  readonly name?: string;
  readonly schools?: number;
  readonly figures?: BackendFigures;
  readonly care_forms?: readonly BackendCareForm[] | null;
}

interface BackendReport {
  readonly key_date: string;
  readonly as_of: string;
  readonly template: {
    readonly id: number | string;
    readonly name: string;
  } | null;
  readonly sections?: readonly string[] | null;
  readonly absence_window: {
    readonly from: string;
    readonly to: string;
  } | null;
  readonly schools?:
    | readonly {
        readonly id: number | string;
        readonly name: string;
        readonly city?: string;
        readonly district?: string | null;
        readonly attendance_from?: string | null;
        readonly figures?: BackendFigures;
        readonly care_forms?: readonly BackendCareForm[] | null;
      }[]
    | null;
  readonly districts?: readonly BackendGroup[] | null;
  readonly total?: BackendGroup;
}

interface BackendTemplate {
  readonly id: number | string;
  readonly name: string;
  readonly sections?: readonly string[] | null;
  readonly key_date_month: number;
  readonly key_date_day: number;
  readonly districts?:
    | readonly {
        readonly school_id: number | string;
        readonly district: string;
      }[]
    | null;
  readonly updated_at?: string | null;
}

function isSection(value: string): value is ReportSection {
  return (REPORT_SECTIONS as readonly string[]).includes(value);
}

/** Die bekannten Abschnitte, in der Reihenfolge des Berichts. */
export function sectionsOf(values: readonly string[]): ReportSection[] {
  const known = new Set(values.filter(isSection));
  return REPORT_SECTIONS.filter((section) => known.has(section));
}

function figuresFromBackend(figures: BackendFigures = {}): ReportFigures {
  return {
    children: figures.children ?? 0,
    withoutCareForm: figures.without_care_form ?? 0,
    staff: figures.staff ?? 0,
    childrenPerStaff: figures.children_per_staff ?? null,
    presentDays: figures.present_days ?? 0,
    sickDays: figures.sick_days ?? 0,
    excusedDays: figures.excused_days ?? 0,
    absenceRate: figures.absence_rate ?? null,
    places: figures.places ?? 0,
    bookedPlaces: figures.booked_places ?? 0,
    freePlaces: figures.free_places ?? 0,
    booked: figures.booked ?? 0,
    open: figures.open ?? 0,
    waitlisted: figures.waitlisted ?? 0,
    demand: figures.demand ?? 0,
  };
}

function careFormsFromBackend(
  forms: readonly BackendCareForm[] | null | undefined,
): ReportCareForm[] {
  return (forms ?? []).map((form) => ({
    name: form.name,
    children: form.children ?? 0,
    capacity: form.capacity ?? null,
    active: form.active ?? true,
  }));
}

function groupFromBackend(group: BackendGroup = {}): ReportGroup {
  return {
    name: group.name ?? "",
    schools: group.schools ?? 0,
    figures: figuresFromBackend(group.figures),
    careForms: careFormsFromBackend(group.care_forms),
  };
}

function reportFromBackend(body: BackendReport): KeyDateReport {
  return {
    keyDate: body.key_date,
    asOf: body.as_of,
    template: body.template
      ? { id: String(body.template.id), name: body.template.name }
      : null,
    sections: sectionsOf(body.sections ?? []),
    absenceWindow: body.absence_window ?? null,
    schools: (body.schools ?? []).map((school) => ({
      id: String(school.id),
      name: school.name,
      city: school.city ?? "",
      district: school.district ?? null,
      attendanceFrom: school.attendance_from ?? null,
      figures: figuresFromBackend(school.figures),
      careForms: careFormsFromBackend(school.care_forms),
    })),
    districts: (body.districts ?? []).map(groupFromBackend),
    total: groupFromBackend(body.total),
  };
}

function templateFromBackend(template: BackendTemplate): ReportTemplate {
  return {
    id: String(template.id),
    name: template.name,
    sections: sectionsOf(template.sections ?? []),
    keyDateMonth: template.key_date_month,
    keyDateDay: template.key_date_day,
    districts: (template.districts ?? []).map((entry) => ({
      schoolId: String(entry.school_id),
      district: entry.district,
    })),
    updatedAt: template.updated_at ?? null,
  };
}

function templateToBackend(input: ReportTemplateInput) {
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
    await traegerRequest<BackendReport>(
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
  const body = await traegerRequest<BackendTemplate[] | null>(TEMPLATES_PATH);
  return (body ?? []).map(templateFromBackend);
}

export async function createReportTemplate(
  input: ReportTemplateInput,
): Promise<ReportTemplate> {
  return templateFromBackend(
    await traegerRequest<BackendTemplate>(TEMPLATES_PATH, {
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
    await traegerRequest<BackendTemplate>(
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
