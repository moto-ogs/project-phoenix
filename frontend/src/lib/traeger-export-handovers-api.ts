import { bffJson } from "~/lib/bff-fetch";
/**
 * Client of the handover of finance exports to the recipients of the Träger
 * (#6824, ADR 0218; #6911, ADR 0222): the recipients without their
 * passwords, the recipient of each format, their newest handovers, and the
 * handover of a Sollstellung, a DATEV booking batch or a PAIN.008 file. Backend int64 IDs leave here as strings, instants as ISO
 * strings.
 */

import type {
  ExportFormat,
  ExportRunPathKind,
  HandoverState,
} from "./traeger-finance-exports-api";
import { knownEnum } from "./contract/known-enum";
import type * as traegerExportRecipientContract from "./contract/traeger-export-recipient.generated";
import type * as traegerFinanceHandoversContract from "./contract/traeger-finance-handovers.generated";

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const RECIPIENT_FIELD_VALUES = [
  "name",
  "host",
  "port",
  "username",
  "password",
  "remote_directory",
  "host_key_fingerprint",
] as const;
const HANDOVER_FORMAT_VALUES = ["sollstellung", "datev", "pain008"] as const;
const HANDOVER_STATE_VALUES = [
  "transferred",
  "failed",
  "in_progress",
  "unknown",
] as const satisfies readonly HandoverState[];

/** The backend names a state it cannot read "unknown" itself. */
function knownHandoverState(value: string): HandoverState {
  return knownEnum(HANDOVER_STATE_VALUES, value) ?? "unknown";
}

function knownList<T extends string>(
  values: readonly T[],
  list: readonly string[] | null,
): T[] {
  return (list ?? []).flatMap((value) => {
    const known = knownEnum(values, value);
    return known ? [known] : [];
  });
}

/** The fields of a recipient, in form order; the backend names these. */
export type RecipientField = (typeof RECIPIENT_FIELD_VALUES)[number];

export type { HandoverState } from "./traeger-finance-exports-api";

export type HandoverFormat = Extract<
  ExportFormat,
  "sollstellung" | "datev" | "pain008"
>;

/** The formats a recipient can receive, in the order the Träger sees them. */
export const HANDOVER_FORMATS: readonly HandoverFormat[] =
  HANDOVER_FORMAT_VALUES;

export interface ExportHandover {
  readonly id: string;
  readonly createdAt: string;
  /** undefined: a format this build does not know. */
  readonly format: HandoverFormat | undefined;
  readonly fileName: string;
  readonly byteSize: number;
  readonly targetHost: string;
  readonly targetDirectory: string;
  /** Null once the recipient was removed; the name stays as it was then. */
  readonly recipientId: string | null;
  readonly recipientName: string;
  readonly state: HandoverState;
  /** Stable reason code of a failure, empty otherwise. */
  readonly reason: string;
}

export interface ExportRecipient {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  /** Switched on and complete: a handover can start. */
  readonly ready: boolean;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly remoteDirectory: string;
  readonly hostKeyFingerprint: string;
  /** A password is stored; it never comes back. */
  readonly passwordSet: boolean;
  readonly missingFields: readonly RecipientField[];
  /** The formats this recipient receives, in order. */
  readonly formats: readonly HandoverFormat[];
  /** Its newest handover: its error state until the next one. */
  readonly lastHandover: ExportHandover | null;
  readonly updatedAt: string;
  /** The read state a save sends back (ADR 0311). */
  readonly version: string;
}

/** The recipient of one format; null leaves it to the download. */
export interface ExportFormatAssignment {
  readonly format: HandoverFormat;
  readonly recipientId: string | null;
}

/** Every recipient, the recipient of each format and the newest handovers. */
export interface ExportRecipientsPage {
  readonly recipients: readonly ExportRecipient[];
  readonly assignments: readonly ExportFormatAssignment[];
  readonly handovers: readonly ExportHandover[];
  /** The read state of the assignments a change sends back (ADR 0311). */
  readonly assignmentsVersion: string;
}

/** One recipient with its own newest handovers. */
export interface ExportRecipientPage {
  readonly recipient: ExportRecipient;
  readonly handovers: readonly ExportHandover[];
}

/** What the Träger saves. Without a password the stored one stays. */
export interface ExportRecipientDraft {
  readonly name: string;
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password?: string;
  readonly remoteDirectory: string;
  readonly hostKeyFingerprint: string;
}

export interface HandoverOptions {
  /** Sends a content again that already reached the recipient. */
  readonly repeat?: boolean;
  /** DATEV: every booking again, in the fiscal year starting then. */
  readonly all?: boolean;
  readonly fiscalYear?: string;
}

export interface HandoverResult {
  readonly fileName: string;
  /** transferred, failed or unknown; a failure is a result, not an error. */
  readonly state: HandoverState;
  readonly reason: string;
  readonly recipientName: string;
  readonly targetHost: string;
  readonly targetDirectory: string;
}

function handoverFromBackend(
  handover: traegerExportRecipientContract.TraegerTransferEntry,
): ExportHandover {
  return {
    id: handover.id,
    createdAt: handover.created_at,
    format: knownEnum(HANDOVER_FORMAT_VALUES, handover.format),
    fileName: handover.filename,
    byteSize: handover.byte_size,
    targetHost: handover.target_host,
    targetDirectory: handover.target_directory,
    recipientId: handover.recipient_id,
    recipientName: handover.recipient_name,
    state: knownHandoverState(handover.state),
    reason: handover.reason ?? "",
  };
}

function recipientFromBackend(
  recipient: traegerExportRecipientContract.TraegerRecipient,
): ExportRecipient {
  return {
    id: recipient.id,
    name: recipient.name,
    enabled: recipient.enabled,
    ready: recipient.ready,
    host: recipient.host,
    port: recipient.port,
    username: recipient.username,
    remoteDirectory: recipient.remote_directory,
    hostKeyFingerprint: recipient.host_key_fingerprint,
    passwordSet: recipient.password_set,
    missingFields: knownList(RECIPIENT_FIELD_VALUES, recipient.missing_fields),
    formats: knownList(HANDOVER_FORMAT_VALUES, recipient.formats),
    lastHandover: recipient.last_handover
      ? handoverFromBackend(recipient.last_handover)
      : null,
    updatedAt: recipient.updated_at,
    version: recipient.version,
  };
}

export function recipientsPageFromBackend(
  page: traegerExportRecipientContract.TraegerRecipientsPage,
): ExportRecipientsPage {
  return {
    recipients: (page.recipients ?? []).map(recipientFromBackend),
    // An assignment of a format this build does not know is left out.
    assignments: (page.assignments ?? []).flatMap((assignment) => {
      const format = knownEnum(HANDOVER_FORMAT_VALUES, assignment.format);
      return format ? [{ format, recipientId: assignment.recipient_id }] : [];
    }),
    handovers: (page.handovers ?? []).map(handoverFromBackend),
    assignmentsVersion: page.assignments_version,
  };
}

function recipientBody(
  draft: ExportRecipientDraft,
): traegerExportRecipientContract.RecipientRequest {
  return {
    name: draft.name,
    enabled: draft.enabled,
    host: draft.host,
    port: draft.port,
    username: draft.username,
    ...(draft.password ? { password: draft.password } : {}),
    remote_directory: draft.remoteDirectory,
    host_key_fingerprint: draft.hostKeyFingerprint,
  };
}

/** Every recipient of the Träger, its formats and the newest handovers. */
export async function fetchExportRecipients(): Promise<ExportRecipientsPage> {
  return recipientsPageFromBackend(
    await bffJson("org", "GET /traeger/export-recipient/"),
  );
}

/** One recipient with its own newest handovers. */
export async function fetchExportRecipient(
  id: string,
): Promise<ExportRecipientPage> {
  return mapExportRecipient(
    await bffJson("org", "GET /traeger/export-recipient/{id}", {
      params: { id },
    }),
  );
}

export function mapExportRecipient(
  page: traegerExportRecipientContract.TraegerRecipientPage,
): ExportRecipientPage {
  return {
    recipient: recipientFromBackend(page.recipient),
    handovers: (page.handovers ?? []).map(handoverFromBackend),
  };
}

/** Adds a recipient; it receives no format until the Träger assigns one. */
export async function createExportRecipient(
  draft: ExportRecipientDraft,
): Promise<ExportRecipient> {
  return recipientFromBackend(
    await bffJson("org", "POST /traeger/export-recipient/", {
      body: recipientBody(draft),
    }),
  );
}

/**
 * Saves a recipient over the version it was read with (ADR 0311); the
 * backend names each wrong field.
 */
export async function saveExportRecipient(
  id: string,
  draft: ExportRecipientDraft,
  expectedVersion: string,
): Promise<ExportRecipient> {
  return recipientFromBackend(
    await bffJson("org", "PUT /traeger/export-recipient/{id}", {
      params: { id },
      body: { ...recipientBody(draft), expected_version: expectedVersion },
    }),
  );
}

/** Removes a recipient and its password; its formats go to the download. */
export async function deleteExportRecipient(
  id: string,
): Promise<ExportRecipientsPage> {
  return recipientsPageFromBackend(
    await bffJson("org", "DELETE /traeger/export-recipient/{id}", {
      params: { id },
    }),
  );
}

/** Sends each format to its recipient, or to the download for null. */
export async function assignExportFormats(
  assignments: readonly ExportFormatAssignment[],
  expectedVersion: string,
): Promise<ExportRecipientsPage> {
  return recipientsPageFromBackend(
    await bffJson("org", "PUT /traeger/export-recipient/formats", {
      body: {
        assignments: assignments.map((assignment) => ({
          format: assignment.format,
          recipient_id: assignment.recipientId,
        })),
        expected_version: expectedVersion,
      } satisfies traegerExportRecipientContract.FormatsRequest,
    }),
  );
}

const HANDOVER_ROUTES = {
  sollstellung: "POST /traeger/finance-handovers/runs/{kind}/{id}/sollstellung",
  datev: "POST /traeger/finance-handovers/runs/{kind}/{id}/datev",
  pain008: "POST /traeger/finance-handovers/runs/{kind}/{id}/pain008",
} as const satisfies Record<HandoverFormat, string>;

/** Makes the file of a run and hands it to the recipient. */
export async function handOverRunFile(
  format: HandoverFormat,
  pathKind: ExportRunPathKind,
  runId: string,
  options: HandoverOptions = {},
): Promise<HandoverResult> {
  const result = await bffJson("org", HANDOVER_ROUTES[format], {
    params: { kind: pathKind, id: runId },
    body: {
      repeat: options.repeat ?? false,
      ...(options.all ? { mode: "all" } : {}),
      ...(options.fiscalYear ? { fiscal_year: options.fiscalYear } : {}),
    } satisfies traegerFinanceHandoversContract.HandoverRequestBody,
  });
  return {
    fileName: result.file_name,
    state: knownHandoverState(result.state),
    reason: result.reason ?? "",
    recipientName: result.recipient_name,
    targetHost: result.target_host,
    targetDirectory: result.target_directory,
  };
}
