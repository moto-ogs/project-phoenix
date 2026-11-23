// Übertragung der Zeitkonten-Exporte an die SFTP-Gegenstelle (#3050).
// Gleiche Berechtigung wie der Export selbst (time_tracking:manage); die
// übertragene Datei ist dieselbe, die der Download liefert.

import { bffJson } from "./bff-fetch";
import type { TransferExportRequest } from "./contract/staff.generated";

type ExportFormat = "csv" | "xlsx" | "datev_lodas" | "datev_lug";

export interface SFTPStatus {
  /** Die Übertragung ist eingeschaltet. */
  enabled: boolean;
  /** Eingeschaltet UND vollständig eingerichtet — nur dann ist sie möglich. */
  ready: boolean;
  host?: string;
  remoteDirectory?: string;
  /** Schlüssel der noch leeren Einstellungen, in Formularreihenfolge. */
  missingSettings: string[];
}

export interface TransferOutcome {
  transferred: boolean;
  filename: string;
  targetHost?: string;
  targetDirectory?: string;
  /** Stabiler Grund-Code, leer bei Erfolg. */
  reason?: string;
}

/**
 * Deutsche Sätze zu den Grund-Codes des Backends.
 *
 * Bewusst ohne technische Details: Was die Person tun kann, steht im Text;
 * warum es technisch scheiterte, steht im Log. Die Codes sind ein Vertrag mit
 * dem Backend und dem Übertragungsprotokoll.
 */
const FAILURE_MESSAGES: Record<string, string> = {
  not_configured:
    "Die Übertragung ist noch nicht eingerichtet. Ein Admin kann sie unter Einstellungen > Kalender und Export > Zeitkonten übertragen einschalten.",
  address_denied:
    "Diese Adresse ist nicht erlaubt. Möglich sind nur Adressen im Internet, nicht im eigenen Netz der Schule.",
  host_key_mismatch:
    "Die Gegenstelle konnte nicht sicher erkannt werden. Bitte prüfe den Fingerabdruck unter Einstellungen > Kalender und Export > Zeitkonten übertragen. Es wurde nichts übertragen.",
  authentication_rejected:
    "Die Anmeldung wurde abgelehnt. Bitte prüfe Benutzername und Passwort unter Einstellungen > Kalender und Export > Zeitkonten übertragen.",
  connection_failed:
    "Die Gegenstelle war nicht erreichbar. Bitte versuche es später noch einmal.",
  upload_failed:
    "Die Datei konnte nicht abgelegt werden. Bitte prüfe den Zielordner unter Einstellungen > Kalender und Export > Zeitkonten übertragen.",
  file_too_large: "Die Datei ist zu groß für die Übertragung.",
  internal_error:
    "Das hat leider nicht geklappt. Bitte versuche es noch einmal.",
};

/** Verständlicher Satz zu einem Grund-Code. */
export function transferFailureMessage(reason: string | undefined): string {
  if (!reason) return FAILURE_MESSAGES.internal_error!;
  return FAILURE_MESSAGES[reason] ?? FAILURE_MESSAGES.internal_error!;
}

/** The SFTP settings of the school, opened at one entry (`?highlight=`). */
export function sftpSettingsHref(key = "sftp.enabled"): string {
  return `/settings?tab=system&highlight=${key}`;
}

/**
 * The settings entry a failure reason sends the person to (#7054); `null`
 * when the text names no setting (unreachable, too large, unknown).
 */
const FAILURE_SETTING_KEYS: Record<string, string> = {
  not_configured: "sftp.enabled",
  host_key_mismatch: "sftp.host_key_fingerprint",
  authentication_rejected: "sftp.username",
  upload_failed: "sftp.remote_directory",
};

/** Link to the setting a failure reason names, or `null`. */
export function transferFailureSettingsHref(
  reason: string | undefined,
): string | null {
  const key = reason ? FAILURE_SETTING_KEYS[reason] : undefined;
  return key ? sftpSettingsHref(key) : null;
}

export async function fetchSFTPStatus(): Promise<SFTPStatus> {
  const status = await bffJson(
    "tenant",
    "GET /api/staff/time-tracking/export/sftp-status",
  );
  return {
    enabled: status.enabled,
    ready: status.ready,
    host: status.host,
    remoteDirectory: status.remote_directory,
    missingSettings: status.missing_settings ?? [],
  };
}

interface TransferParams {
  year: number;
  month: number;
  format: ExportFormat;
  granularity?: "month" | "day";
  timeFormat?: "hhmm" | "decimal";
  /** Ganzes Jahr statt eines Monats. */
  wholeYear?: boolean;
}

export async function transferExportViaSFTP(
  params: TransferParams,
): Promise<TransferOutcome> {
  // Die Auswahl reist im Body, nicht in der Query: die POST-Proxy-Route
  // reicht den Body weiter, den Query-String aber nicht.
  const body: TransferExportRequest = {
    year: params.year,
    format: params.format,
  };
  if (!params.wholeYear) {
    body.month = params.month;
  }
  if (params.granularity) {
    body.granularity = params.granularity;
  }
  if (params.timeFormat) {
    body.time_format = params.timeFormat;
  }

  const result = await bffJson(
    "tenant",
    "POST /api/staff/time-tracking/export/sftp",
    { body },
  );
  return {
    transferred: result.transferred,
    filename: result.filename,
    targetHost: result.target_host,
    targetDirectory: result.target_directory,
    reason: result.reason,
  };
}
