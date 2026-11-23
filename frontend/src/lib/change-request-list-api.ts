import { ApiError, isReadStateRefusal } from "~/lib/api-error";
import { bffJson } from "~/lib/bff-fetch";
import type * as enrollmentContract from "~/lib/contract/enrollment.generated";
import { knownEnum, requiredEnum } from "~/lib/contract/known-enum";
import type * as studentsContract from "~/lib/contract/students.generated";
import { createLogger } from "~/lib/logger";
import {
  toStaffCareRequest,
  toStaffCareRequestHistoryEntry,
  type StaffCareRequest,
  type StaffCareRequestHistoryEntry,
} from "~/lib/care-request-review-api";
import {
  toStaffExcusedRequest,
  toStaffExcusedRequestHistoryEntry,
  type StaffExcusedRequest,
  type StaffExcusedRequestHistoryEntry,
} from "~/lib/excused-request-review-api";
import {
  toStaffMasterDataChange,
  toStaffMasterDataHistoryEntry,
  type StaffMasterDataChange,
  type StaffMasterDataHistoryEntry,
} from "~/lib/master-data-review-api";
import {
  toStaffOfferingRequest,
  toStaffOfferingRequestHistoryEntry,
  type StaffOfferingRequest,
  type StaffOfferingRequestHistoryEntry,
} from "~/lib/offering-request-review-api";

const logger = createLogger({ component: "ChangeRequestListApi" });

/**
 * Aggregierte Eltern-Anfragenliste (#2432): ein Endpunkt über die vier
 * Anfragearten (Stammdaten, Betreuungszeiten, Angebote, Abwesenheiten),
 * offen oder Historie, mit serverseitiger Namenssuche, Filtern und
 * Keyset-Pagination. Jedes Item trägt seine Art-Projektion im Feld seiner
 * Art (`master_data`, `care_schedule`, …); der Client legt sie unter `data`
 * ab, diskriminiert über `request_type` (#7882).
 */

export type AggregatedRequestType =
  | "master_data"
  | "care_schedule"
  | "offering"
  | "excused"
  | "direct_correction"
  | "enrollment"
  | "care_withdrawal";

/**
 * Eine Direkt-Korrektur der Verwaltung an den Angebots-Buchungen eines Kindes
 * (#2436). Keine Anfrage: kein Status, keine Entscheidung, nur in der
 * Historie.
 */
type DirectCorrection = Omit<
  studentsContract.DirectCorrectionResponse,
  "diff"
> & {
  readonly diff: readonly studentsContract.OfferingRequestDiffResponse[];
};

/**
 * Eine Anmeldungsänderung (#2435) ist `enrollmentContract.ChangeRequestReviewEntry`:
 * der Wunsch einer Familie, ihre Anmeldung nach dem Absenden noch zu ändern.
 * Eigener Endpunkt, weil die Freigabe an config:manage hängt statt an
 * users:update.
 */

export type AggregatedRequestStatus = "approved" | "rejected" | "withdrawn";

/**
 * Der Zeitpunkt, nach dem alle Quellen des Eltern-Reiters gemeinsam sortiert
 * werden: die Einreichung in der Arbeitsliste, die Entscheidung in der
 * Historie.
 */
type Occurred = Pick<studentsContract.Item, "occurred_at">;

/**
 * Stabiler Code, warum eine Anfrage nicht gemeinsam freigegeben werden kann
 * (#2267). Der Text kommt zusätzlich als `bulk_ineligible_text` mit; der Code
 * ist das, wonach die Oberfläche ihre Formulierung wählt.
 */
export type BulkIneligibleReason =
  | "past"
  | "stale"
  | "conflict"
  | "single_only"
  | "child_unavailable"
  | "access_revoked";

/**
 * Die Felder einer offenen Zeile neben ihrer Art-Projektion (#2267, #4359):
 * wer eingereicht hat, Sammelfreigabe, Widerspruchsgruppe, Familienschutz.
 * `bulk_ineligible_reason` ist ein stabiler Code; der Text steht in
 * `bulk_ineligible_text`. Die Widerspruchsfelder FEHLEN ohne Widerspruch und
 * zählen über alle offenen Anfragen des Kindes, auch nicht geladene.
 */
export type RequestReviewMetadata = Omit<
  studentsContract.Item,
  | "request_type"
  | "data"
  | "occurred_at"
  | "bulk_ineligible_reason"
  | ParentRequestKind
> & { readonly bulk_ineligible_reason?: BulkIneligibleReason };

/** Eine Anmeldungsänderung als Zeile der gemeinsamen Liste. */
export type EnrollmentRequestItem = Occurred & {
  request_type: "enrollment";
  data: enrollmentContract.ChangeRequestReviewEntry;
};

export type AggregatedOpenRequest =
  | (Occurred &
      RequestReviewMetadata &
      (
        | { request_type: "master_data"; data: StaffMasterDataChange }
        | { request_type: "care_schedule"; data: StaffCareRequest }
        | { request_type: "offering"; data: StaffOfferingRequest }
        | { request_type: "excused"; data: StaffExcusedRequest }
      ))
  | EnrollmentRequestItem;
// Direkt-Korrekturen fehlen hier bewusst: sie haben keinen offenen Zustand.

/**
 * Was an einer entschiedenen Zeile noch möglich ist (#2267): `can_correct`
 * sagt, ob die Person diese Entscheidung korrigieren darf. Die Version wird
 * beim Korrigieren mitgeschickt, damit zwei gleichzeitige Korrekturen sich
 * nicht überschreiben.
 */
type HistoryDecisionMeta = Pick<
  studentsContract.Item,
  "can_correct" | "submitted_by_name" | "submitted_by_relationship"
> &
  Partial<Pick<studentsContract.Item, "expected_version">>;

export type AggregatedHistoryRequest =
  | (Occurred &
      HistoryDecisionMeta &
      (
        | { request_type: "master_data"; data: StaffMasterDataHistoryEntry }
        | { request_type: "care_schedule"; data: StaffCareRequestHistoryEntry }
        | { request_type: "offering"; data: StaffOfferingRequestHistoryEntry }
        | { request_type: "excused"; data: StaffExcusedRequestHistoryEntry }
        | { request_type: "direct_correction"; data: DirectCorrection }
      ))
  | EnrollmentRequestItem;

/**
 * Was die abrufende Person mit Elternanfragen tun darf (#2267). „none" heißt:
 * sie sieht die Seite, darf aber nichts entscheiden — die Liste erklärt das,
 * statt leer zu bleiben.
 */
export type RequestReviewAccess = "admin" | "team" | "group_leader" | "none";

/**
 * Eine Seite der Liste: die Zeilen als Sichttypen, `next_cursor` fehlt auf
 * der letzten Seite und gilt nur für denselben Filtersatz, `review_access`
 * kommt nur mit der offenen Liste.
 */
export type AggregatedRequestPage<T> = Pick<
  studentsContract.Page,
  "next_cursor"
> & {
  readonly items: readonly T[];
  readonly review_access?: RequestReviewAccess;
};

export interface AggregatedRequestParams {
  readonly search?: string;
  /**
   * Nur die Einträge eines Kindes — das Änderungsprotokoll der Kinderkartei
   * (#2437). Die Anmeldungsänderungen kennen diesen Filter nicht; ihre Quelle
   * lässt ihn weg (siehe listEnrollmentChangeRequests).
   */
  readonly studentId?: string;
  readonly types?: readonly AggregatedRequestType[];
  /** Nur Historie. */
  readonly statuses?: readonly AggregatedRequestStatus[];
  /** Nur Historie, YYYY-MM-DD. */
  readonly from?: string;
  /** Nur Historie, YYYY-MM-DD. */
  readonly to?: string;
  readonly cursor?: string;
}

function listQuery(params: AggregatedRequestParams) {
  const join = (values?: readonly string[]) =>
    values && values.length > 0 ? values.join(",") : undefined;
  return {
    search: params.search?.trim() || undefined,
    student_id: params.studentId || undefined,
    types: join(params.types),
    status: join(params.statuses),
    from: params.from || undefined,
    to: params.to || undefined,
    cursor: params.cursor || undefined,
  };
}

const REVIEW_ACCESS = ["admin", "team", "group_leader", "none"] as const;
const BULK_INELIGIBLE_REASONS = [
  "past",
  "stale",
  "conflict",
  "single_only",
  "child_unavailable",
  "access_revoked",
] as const satisfies readonly BulkIneligibleReason[];

/** The projection of a row's kind; a row without it breaks the contract. */
function projection<T>(value: T | undefined, kind: string): T {
  if (value === undefined) {
    throw new Error(`contract: change request row without its ${kind}`);
  }
  return value;
}

function openRequest(item: studentsContract.Item): AggregatedOpenRequest {
  const {
    request_type,
    data: _data,
    master_data,
    care_schedule,
    offering,
    excused,
    bulk_ineligible_reason,
    ...meta
  } = item;
  const row = {
    ...meta,
    bulk_ineligible_reason: knownEnum(
      BULK_INELIGIBLE_REASONS,
      bulk_ineligible_reason,
    ),
  };
  const kind = requiredEnum(PARENT_REQUEST_KINDS, request_type, "request_type");
  switch (kind) {
    case "master_data":
      return {
        ...row,
        request_type: kind,
        data: toStaffMasterDataChange(projection(master_data, kind)),
      };
    case "care_schedule":
      return {
        ...row,
        request_type: kind,
        data: toStaffCareRequest(projection(care_schedule, kind)),
      };
    case "offering":
      return {
        ...row,
        request_type: kind,
        data: toStaffOfferingRequest(projection(offering, kind)),
      };
    case "excused":
      return {
        ...row,
        request_type: kind,
        data: toStaffExcusedRequest(projection(excused, kind)),
      };
  }
}

const HISTORY_KINDS = [
  "master_data",
  "care_schedule",
  "offering",
  "excused",
  "direct_correction",
] as const;

function historyRequest(
  item: studentsContract.HistoryItem,
): AggregatedHistoryRequest {
  const {
    request_type,
    master_data,
    care_schedule,
    offering,
    excused,
    direct_correction,
    ...meta
  } = item;
  const kind = requiredEnum(HISTORY_KINDS, request_type, "request_type");
  switch (kind) {
    case "master_data":
      return {
        ...meta,
        request_type: kind,
        data: toStaffMasterDataHistoryEntry(projection(master_data, kind)),
      };
    case "care_schedule":
      return {
        ...meta,
        request_type: kind,
        data: toStaffCareRequestHistoryEntry(projection(care_schedule, kind)),
      };
    case "offering":
      return {
        ...meta,
        request_type: kind,
        data: toStaffOfferingRequestHistoryEntry(projection(offering, kind)),
      };
    case "excused":
      return {
        ...meta,
        request_type: kind,
        data: toStaffExcusedRequestHistoryEntry(projection(excused, kind)),
      };
    case "direct_correction": {
      const correction = projection(direct_correction, kind);
      return {
        ...meta,
        request_type: kind,
        data: { ...correction, diff: correction.diff ?? [] },
      };
    }
  }
}

function logLoadFailure(view: "open" | "history", error: unknown): void {
  // Fehlt das Recht „Kinder sehen“, trägt die Antwort den Code
  // students.absence_read_required; den Text liefert der Katalog (#2513).
  logger.warn("change_request_list_load_failed", {
    view,
    ...(error instanceof ApiError
      ? { status: error.status, ...(error.code ? { code: error.code } : {}) }
      : {}),
  });
}

export async function listAggregatedOpenRequests(
  params: AggregatedRequestParams = {},
): Promise<AggregatedRequestPage<AggregatedOpenRequest>> {
  try {
    const page = await bffJson("tenant", "GET /api/students/change-requests", {
      query: { view: "open", ...listQuery(params) },
      errorMessage: "change request list load failed",
    });
    return {
      items: (page.items ?? []).map(openRequest),
      next_cursor: page.next_cursor,
      review_access: knownEnum(REVIEW_ACCESS, page.review_access),
    };
  } catch (error) {
    logLoadFailure("open", error);
    throw error;
  }
}

export async function listAggregatedRequestHistory(
  params: AggregatedRequestParams = {},
): Promise<AggregatedRequestPage<AggregatedHistoryRequest>> {
  try {
    const page = await bffJson(
      "tenant",
      "GET /api/students/change-requests/history",
      {
        query: listQuery(params),
        errorMessage: "change request list load failed",
      },
    );
    return {
      items: (page.items ?? []).map(historyRequest),
      next_cursor: page.next_cursor,
    };
  } catch (error) {
    logLoadFailure("history", error);
    throw error;
  }
}

const PARENT_REQUEST_KINDS = [
  "master_data",
  "care_schedule",
  "offering",
  "excused",
] as const;
export type ParentRequestKind = (typeof PARENT_REQUEST_KINDS)[number];

export interface BulkApproveRequestRef {
  readonly kind: ParentRequestKind;
  readonly id: string;
  readonly expected_version: string;
}

/**
 * Eine Entscheidung, die auf einem veralteten Stand beruht: die Anfrage ist
 * seit dem Lesen anders gespeichert (`general.changed_since_read`, ADR 0311),
 * oder der bisherige Wert einer Stammdaten-Anfrage stimmt nicht mehr
 * (`students.change_request_stale`). Dieselbe Prüfung wie
 * `isReadStateRefusal`.
 */
export const isOutdatedDecision = isReadStateRefusal;

/**
 * Meldet eine abgelehnte schreibende Anfrage (#2513). Eine veraltete
 * Entscheidung (`isOutdatedDecision`) erkennt die Oberfläche am Code und lädt
 * neu, statt die Person eine verlorene Entscheidung wiederholen zu lassen;
 * sie ist kein Fehler zum Protokollieren.
 */
function logWriteError(error: unknown): void {
  if (!(error instanceof ApiError)) return;
  if (isOutdatedDecision(error)) return;
  logger.warn("change_request_write_failed", {
    status: error.status,
    ...(error.code ? { code: error.code } : {}),
  });
}

async function write<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (error) {
    logWriteError(error);
    throw error;
  }
}

/**
 * Schließt eine Anfrage ab, die nur noch vergangene Tage betrifft (#2267).
 * Nichts wird übernommen; die Zeile verschwindet nur aus der Arbeitsliste.
 */
export function markRequestDone(
  kind: ParentRequestKind,
  requestID: string,
  expectedVersion: string,
  reason?: string,
): Promise<unknown> {
  return write(() =>
    bffJson(
      "tenant",
      "POST /api/students/change-requests/{kind}/{requestId}/mark-done",
      {
        params: { kind, requestId: requestID },
        body: {
          expected_version: expectedVersion,
          // Der Grund ist freiwillig; ein leerer würde nur eine leere Zeile
          // in der Historie erzeugen.
          ...(reason?.trim() ? { reason: reason.trim() } : {}),
        },
        errorMessage: "change request mark done failed",
      },
    ),
  );
}

/**
 * Nimmt eine bereits gefallene Entscheidung zurück und ersetzt sie (#2267).
 *
 * `kind` ist die Art der WARTESCHLANGE, nicht die des Vorgangs: eine
 * Abholzeit-Änderung wird als `care_schedule` korrigiert, weil sie dort
 * liegt. Das Backend unterscheidet die beiden selbst und antwortet für einen
 * echten Wochenplan mit 409 `students.correction_unsupported` plus einem deutschen
 * Satz. Der wird unverändert durchgereicht: er sagt genauer, warum es dort
 * nicht geht, als jeder Ersatztext hier.
 */
export function correctRequestDecision(
  kind: ParentRequestKind,
  requestID: string,
  input: Readonly<{
    approve: boolean;
    reason: string;
    expectedVersion: string;
  }>,
): Promise<studentsContract.parentRequestCorrectedResponse> {
  return write(() =>
    bffJson(
      "tenant",
      "POST /api/students/change-requests/{kind}/{requestId}/correct",
      {
        params: { kind, requestId: requestID },
        body: {
          approve: input.approve,
          reason: input.reason,
          expected_version: input.expectedVersion,
        },
        errorMessage: "change request correction failed",
      },
    ),
  );
}

/**
 * Die Art, unter der ein Widerspruch aufgelöst wird. Nicht dasselbe wie die
 * Art der Anfrage: eine Abholzeit-Änderung reist als `care_schedule` durch
 * die Liste, wird aber als `pickup_change` aufgelöst. Maßgeblich ist der
 * Schlüssel der Gruppe.
 */
export type ConflictResolutionKind = ParentRequestKind | "pickup_change";

export function conflictResolutionKind(
  conflictKey: string,
  requestType: ParentRequestKind,
): ConflictResolutionKind {
  return conflictKey.startsWith("pickup:") ? "pickup_change" : requestType;
}

export interface ConflictResolution {
  readonly kind: ConflictResolutionKind;
  /** Der Schlüssel der Gruppe, die aufgelöst wird. */
  readonly conflictKey: string;
  readonly requestIDs: readonly string[];
  readonly expectedVersions: readonly string[];
  /** Genau eine Anfrage freigeben; die übrigen werden abgelehnt. */
  readonly chosenRequestID?: string;
  /**
   * Eigener Wert der OGS: alle Anfragen ablehnen und diesen Wert eintragen.
   * Die Form hängt an der Art (Status, Uhrzeit, Feldwert).
   */
  readonly staffValue?: unknown;
  /** Keine Änderung: alle Anfragen ablehnen. */
  readonly none?: boolean;
  /** Bei einem Widerspruch immer Pflicht, unabhängig von der Einstellung. */
  readonly reason: string;
}

/**
 * Legt für eine Gruppe sich widersprechender Anfragen EIN Ergebnis fest
 * (#2267). Entweder klappt alles zusammen oder nichts. Genau eines von
 * `chosenRequestID`, `staffValue` und `none` wird mitgeschickt.
 */
export async function resolveRequestConflict(
  input: ConflictResolution,
): Promise<number> {
  const result = await write(() =>
    bffJson("tenant", "POST /api/students/change-requests/conflicts/resolve", {
      body: {
        kind: input.kind,
        conflict_key: input.conflictKey,
        request_ids: [...input.requestIDs],
        expected_versions: [...input.expectedVersions],
        ...(input.chosenRequestID
          ? { chosen_request_id: input.chosenRequestID }
          : input.staffValue !== undefined
            ? { staff_value: { value: input.staffValue } }
            : { none: true }),
        reason: input.reason,
      },
      errorMessage: "change request conflict resolution failed",
    }),
  );
  return result.resolved_count;
}

export async function bulkApproveParentRequests(
  requests: readonly BulkApproveRequestRef[],
  reason: string,
): Promise<number> {
  const result = await write(() =>
    bffJson("tenant", "POST /api/students/change-requests/bulk-approve", {
      body: { requests: [...requests], reason },
      errorMessage: "change request bulk approval failed",
    }),
  );
  return result.approved_count;
}

export async function setFamilyProtection(
  studentId: string,
  enabled: boolean,
  reason: string,
): Promise<void> {
  await bffJson("tenant", "PUT /api/students/{id}/family-protection", {
    params: { id: studentId },
    body: { enabled, reason },
    errorMessage: "family protection save failed",
  });
}

export async function getFamilyProtection(
  studentId: string,
): Promise<studentsContract.familyProtectionResponse> {
  return bffJson("tenant", "GET /api/students/{id}/family-protection", {
    params: { id: studentId },
    errorMessage: "family protection load failed",
  });
}

/**
 * Zahl der offenen Anmeldungsänderungen für das Badge (#2435). Wie die übrigen
 * Badge-Abrufe: ein Fehler ergibt 0, damit ein Zähler nie die Seitenleiste
 * beschädigt.
 */
export async function fetchPendingEnrollmentChangeRequestCount(): Promise<number> {
  try {
    const data = await bffJson(
      "tenant",
      "GET /api/enrollment/admin/change-requests/pending-count",
    );
    return data.pending_count;
  } catch {
    return 0;
  }
}

/**
 * Anmeldungsänderungen, offen oder in der Historie (#2435). Gleiche Antwort-
 * form wie oben, eigener Endpunkt hinter config:manage. Der Art-Filter wirkt
 * hier clientseitig: die Quelle wird schlicht weggelassen, wenn die Art nicht
 * gewählt ist.
 */
export async function listEnrollmentChangeRequests(
  view: "open" | "history",
  params: AggregatedRequestParams = {},
): Promise<AggregatedRequestPage<EnrollmentRequestItem>> {
  // Ohne Art-Filter: diese Quelle kennt nur eine Art. Und ohne Kind-Filter:
  // dieser Endpunkt kennt ihn nicht, würde also ungefiltert antworten.
  const { types: _types, studentId: _studentId, ...rest } = params;
  try {
    const page = await bffJson(
      "tenant",
      "GET /api/enrollment/admin/change-requests/list",
      {
        query: { view, ...listQuery(rest) },
        errorMessage: "enrollment change request list load failed",
      },
    );
    return {
      items: (page.items ?? []).map((item) => ({
        occurred_at: item.occurred_at,
        request_type: requiredEnum(
          ["enrollment"] as const,
          item.request_type,
          "request_type",
        ),
        data: item.data,
      })),
      next_cursor: page.next_cursor,
    };
  } catch (error) {
    logger.warn("enrollment_change_request_list_load_failed", {
      view,
      ...(error instanceof ApiError ? { status: error.status } : {}),
    });
    throw error;
  }
}
