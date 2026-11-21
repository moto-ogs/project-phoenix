// Payroll configuration status (#1417 Tranche 2b): the /payroll page's data
// source. Requires config:manage — callers gate rendering on the permission
// so no request fires without it. Values are written to the generic settings
// route (savePayrollSetting) using the setting keys this status carries.

import { apiErrorFromResponse } from "./api-error";
import { knownEnum } from "./contract/known-enum";
import type { PayrollStatus as PayrollStatusWire } from "./contract/settings.generated";
import type {
  PayrollDispatchOverview,
  PayrollDispatchView as PayrollDispatchViewWire,
  TargetCoverage,
} from "./contract/staff.generated";
import {
  knownMailOutcome,
  type MailOutcome,
  type MailOutcomeCounts,
} from "./email-delivery-status";
import { sessionFetch } from "./session-cache";
import { monthYearLabel } from "./time-account-links";
import { transferFailureMessage } from "./sftp-export-api";

interface PayrollCategoryStatus {
  id: string;
  label: string;
  number: string;
  unit: string;
  unitRequired: boolean;
  settingKey: string;
  unitSettingKey: string | null;
}

export interface PayrollStatus {
  categories: PayrollCategoryStatus[];
  beraternummer: string;
  mandantennummer: string;
  lodasHeaderComplete: boolean;
  configuredCategories: number;
  totalCategories: number;
  staffTotal: number;
  staffWithoutPersonnelNumber: number;
  dispatch: PayrollDispatchSettings;
}

/** Wege zum Lohnbüro (#4805); die Werte von `payroll.dispatch_channel`. */
export type PayrollDispatchChannel = "sftp" | "email";

/** Dateiformate; die Werte von `payroll.dispatch_format`. */
export type PayrollDispatchFormat =
  "csv" | "xlsx" | "datev_lodas" | "datev_lug";

/** Der Versand an das Lohnbüro nach dem Monatsabschluss (#4805). */
export interface PayrollDispatchSettings {
  auto: boolean;
  channel: PayrollDispatchChannel;
  format: PayrollDispatchFormat;
  email: string;
}

/** Setting-Schlüssel des Versands; das Backend prüft Typ und Muster. */
export const PAYROLL_DISPATCH_KEYS = {
  auto: "payroll.dispatch_auto",
  channel: "payroll.dispatch_channel",
  format: "payroll.dispatch_format",
  email: "payroll.dispatch_email",
} as const;

/** Dasselbe Muster wie `payroll.dispatch_email` im Backend; leer ist erlaubt. */
export const PAYROLL_DISPATCH_EMAIL_PATTERN =
  /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;

export const PAYROLL_DISPATCH_CHANNEL_LABELS: Record<
  PayrollDispatchChannel,
  string
> = {
  sftp: "SFTP",
  email: "E-Mail",
};

/** Dieselben Namen wie die Auswahl im Backend-Schema. */
export const PAYROLL_DISPATCH_FORMAT_LABELS: Record<
  PayrollDispatchFormat,
  string
> = {
  csv: "CSV",
  xlsx: "Excel",
  datev_lodas: "DATEV LODAS",
  datev_lug: "DATEV Lohn und Gehalt",
};

function dispatchChannel(value: string | undefined): PayrollDispatchChannel {
  return value === "email" ? "email" : "sftp";
}

function dispatchFormat(value: string | undefined): PayrollDispatchFormat {
  return value !== undefined && value in PAYROLL_DISPATCH_FORMAT_LABELS
    ? (value as PayrollDispatchFormat)
    : "csv";
}

export function mapPayrollStatus(data: PayrollStatusWire): PayrollStatus {
  return {
    categories: (data.categories ?? []).map((cat) => ({
      id: cat.id,
      label: cat.label,
      number: cat.number,
      unit: cat.unit ?? "",
      unitRequired: cat.unit_required,
      settingKey: cat.setting_key,
      unitSettingKey: cat.unit_setting_key ?? null,
    })),
    beraternummer: data.beraternummer,
    mandantennummer: data.mandantennummer,
    lodasHeaderComplete: data.lodas_header_complete,
    configuredCategories: data.configured_categories,
    totalCategories: data.total_categories,
    staffTotal: data.staff_total,
    staffWithoutPersonnelNumber: data.staff_without_personnel_number,
    // Der Vertrag verlangt den Block; unbekannte Kanäle und Formate fallen
    // auf die Vorgaben des Backends (SFTP, CSV) zurück.
    dispatch: {
      auto: data.dispatch.auto,
      channel: dispatchChannel(data.dispatch.channel),
      format: dispatchFormat(data.dispatch.format),
      email: data.dispatch.email,
    },
  };
}

export async function fetchPayrollStatus(): Promise<PayrollStatus> {
  const response = await sessionFetch("/api/settings/payroll-status");
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `Failed to fetch payroll status: ${response.statusText}`,
    );
  }
  const json = (await response.json()) as { data: PayrollStatusWire };
  return mapPayrollStatus(json.data);
}

/** Ein Einstellungswert der Abrechnung im JSON-Typ seines Schemas. */
export type PayrollSettingValue = string | boolean;

/**
 * Saves one payroll setting. Throws an ApiError with code, field errors and
 * request ID, so the page shows the catalog text (#2517). The value travels
 * in its schema type: the Lohnbüro switch as a boolean, everything else as a
 * string.
 */
export async function savePayrollSetting(
  key: string,
  value: PayrollSettingValue,
): Promise<void> {
  const response = await sessionFetch(
    `/api/settings/values/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    },
  );
  if (!response.ok) {
    throw await apiErrorFromResponse(response, `Saving ${key} failed`);
  }
}

/**
 * Lohnartnummern that appear on more than one category. Not an error — a
 * Träger may legitimately book two categories on one Lohnart — but worth a
 * warning, because a duplicate usually is a typo that would double-book.
 */
export function duplicateLohnartNumbers(status: PayrollStatus): string[] {
  const seen = new Map<string, number>();
  for (const cat of status.categories) {
    if (cat.number === "") continue;
    seen.set(cat.number, (seen.get(cat.number) ?? 0) + 1);
  }
  return [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([number]) => number);
}

// ─── Letzter Versand an das Lohnbüro (#4805) ────────────────────────────────

export type PayrollDispatchState =
  "pending" | "mailing" | "sent" | "blocked" | "failed";

export interface PayrollDispatchView {
  year: number;
  month: number;
  correction: boolean;
  channel: PayrollDispatchChannel;
  format: PayrollDispatchFormat;
  recipient: string | null;
  state: PayrollDispatchState;
  reason: string | null;
  attempts: number;
  filename: string | null;
  /** Zeitpunkte (RFC 3339), keine Kalendertage. */
  createdAt: string;
  finishedAt: string | null;
  downloadExpiresAt: string | null;
  downloadedAt: string | null;
  /** Was aus der Mail mit dem Link ans Lohnbüro wurde (#7058). */
  linkMail: MailOutcome | null;
  /** Die Hinweise an die Leitung, nach Ergebnis gezählt (#7058). */
  noticeMails: MailOutcomeCounts | null;
}

const DISPATCH_STATES: readonly PayrollDispatchState[] = [
  "pending",
  "mailing",
  "sent",
  "blocked",
  "failed",
];

/** Counts per outcome; an outcome this build does not know is left out. */
function mailCounts(
  counts: Readonly<Record<string, number>> | undefined,
): MailOutcomeCounts | null {
  if (!counts) return null;
  const known: Partial<Record<MailOutcome, number>> = {};
  for (const [key, count] of Object.entries(counts)) {
    const outcome = knownMailOutcome(key);
    if (outcome) known[outcome] = count;
  }
  return known;
}

function mapPayrollDispatch(
  data: PayrollDispatchViewWire,
): PayrollDispatchView {
  return {
    year: data.year,
    month: data.month,
    correction: data.correction,
    channel: dispatchChannel(data.channel),
    format: dispatchFormat(data.format),
    recipient: data.recipient ?? null,
    // An unknown state reads as failed: the screen asks the school to look.
    state: knownEnum(DISPATCH_STATES, data.state) ?? "failed",
    reason: data.reason ?? null,
    attempts: data.attempts,
    filename: data.filename ?? null,
    createdAt: data.created_at,
    finishedAt: data.finished_at ?? null,
    downloadExpiresAt: data.download_expires_at ?? null,
    downloadedAt: data.downloaded_at ?? null,
    linkMail: knownMailOutcome(data.link_mail) ?? null,
    noticeMails: mailCounts(data.notice_mails),
  };
}

/**
 * Der neueste automatische Versand, `null` vor dem ersten. Braucht
 * time_tracking:manage oder config:manage.
 */
export async function fetchPayrollDispatch(): Promise<PayrollDispatchView | null> {
  const response = await sessionFetch(
    "/api/staff/time-tracking/payroll-dispatch",
  );
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `Failed to fetch payroll dispatch: ${response.statusText}`,
    );
  }
  const json = (await response.json()) as {
    data: PayrollDispatchOverview;
  };
  return json.data.latest ? mapPayrollDispatch(json.data.latest) : null;
}

/**
 * Wie viele Beschäftigte im Monat kein Soll haben (#6890). Ohne Soll zählen
 * Krankheit, Urlaub und Fortbildung 0 Stunden. Dieselbe Rechnung wie die
 * Zeitkonten, nur die Zahlen.
 */
export interface PayrollTargetCoverage {
  year: number;
  month: number;
  staffTotal: number;
  staffWithoutTarget: number;
}

/**
 * Die Soll-Prüfung des laufenden Monats. Braucht time_tracking:manage oder
 * config:manage und das Modul Zeiterfassung.
 */
export async function fetchPayrollTargetCoverage(): Promise<PayrollTargetCoverage> {
  const response = await sessionFetch(
    "/api/staff/time-tracking/target-coverage",
  );
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `Failed to fetch payroll target coverage: ${response.statusText}`,
    );
  }
  const json = (await response.json()) as {
    data: TargetCoverage;
  };
  return {
    year: json.data.year,
    month: json.data.month,
    staffTotal: json.data.staff_total,
    staffWithoutTarget: json.data.staff_without_target,
  };
}

/**
 * Sätze zu den Grund-Codes des Versands. Derselbe Wortlaut steht in der
 * Hinweis-E-Mail des Backends (payroll_dispatch_mail.go).
 */
const DISPATCH_REASON_TEXTS: Record<string, string> = {
  datev_incomplete:
    "Die DATEV-Angaben sind nicht vollständig. Zum Beispiel fehlt eine Personalnummer oder die Nummer einer Lohnart.",
  sftp_not_configured:
    "Die Übertragung per SFTP ist ausgeschaltet oder nicht vollständig eingetragen.",
  email_missing: "Für den Versand per E-Mail fehlt die Adresse des Lohnbüros.",
  mail_failed: "Die E-Mail an das Lohnbüro konnte nicht zugestellt werden.",
  internal_error: "Die Datei konnte nicht erstellt werden.",
};

/** Nach allen Versuchen per SFTP: erster Versuch und drei Wiederholungen. */
const SFTP_GAVE_UP_TEXT =
  "Die Übertragung an das Lohnbüro hat viermal nicht geklappt.";

/**
 * Warum ein Versand nicht ankam, als Satz; `null`, solange nichts schiefging.
 * Ein gescheiterter SFTP-Versand trägt den Grund der Übertragung
 * (connection_failed, host_key_mismatch, ...), dessen Text die
 * SFTP-Übertragung schon kennt.
 */
export function payrollDispatchReasonText(
  dispatch: Pick<PayrollDispatchView, "state" | "reason" | "channel">,
): string | null {
  if (dispatch.state !== "blocked" && dispatch.state !== "failed") return null;
  const reason = dispatch.reason ?? "internal_error";
  if (dispatch.state === "failed" && dispatch.channel === "sftp") {
    // Ohne genauen Grund bleibt es beim ersten Satz: „Bitte versuche es
    // noch einmal“ passt nicht zu einem Versand, den moto selbst wiederholt.
    return reason === "internal_error"
      ? SFTP_GAVE_UP_TEXT
      : `${SFTP_GAVE_UP_TEXT} ${transferFailureMessage(reason)}`;
  }
  return DISPATCH_REASON_TEXTS[reason] ?? DISPATCH_REASON_TEXTS.internal_error!;
}

/** „September 2026“ für Jahr und Monat (1 bis 12). */
export const payrollMonthLabel = monthYearLabel;
