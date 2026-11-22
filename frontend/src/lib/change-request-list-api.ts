import { ApiError } from "~/lib/api-error";
import { bffJson } from "~/lib/bff-fetch";
import type * as enrollmentContract from "~/lib/contract/enrollment.generated";
import type * as studentsContract from "~/lib/contract/students.generated";
import { createLogger } from "~/lib/logger";
import type {
  StaffCareRequest,
  StaffCareRequestHistoryEntry,
} from "~/lib/care-request-review-api";
import type {
  StaffExcusedRequest,
  StaffExcusedRequestHistoryEntry,
} from "~/lib/excused-request-review-api";
import type {
  StaffMasterDataChange,
  StaffMasterDataHistoryEntry,
} from "~/lib/master-data-review-api";
import type {
  StaffOfferingRequest,
  StaffOfferingRequestHistoryEntry,
} from "~/lib/offering-request-review-api";

const logger = createLogger({ component: "ChangeRequestListApi" });

/**
 * Aggregierte Eltern-Anfragenliste (#2432): ein Endpunkt über die vier
 * Anfragearten (Stammdaten, Betreuungszeiten, Angebote, Abwesenheiten),
 * offen oder Historie, mit serverseitiger Namenssuche, Filtern und
 * Keyset-Pagination. Jedes Item trägt unter `data` die unveränderte
 * Art-Projektion, diskriminiert über `request_type` — die bestehenden
 * Entscheiden-Aufrufe der Art-APIs bleiben unverändert.
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
interface DirectCorrection {
  readonly id: string;
  readonly student_id: string;
  readonly student_name: string;
  readonly changed_at: string;
  readonly changed_by_name: string;
  readonly reason: string;
  readonly diff: readonly {
    readonly offering_id: string;
    readonly label: string;
    readonly old: string;
    readonly new: string;
  }[];
}

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
  "request_type" | "data" | "occurred_at" | "bulk_ineligible_reason"
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

export interface AggregatedRequestPage<T> {
  readonly items: readonly T[];
  /** Fehlt auf der letzten Seite. Nur für denselben Filtersatz gültig. */
  readonly next_cursor?: string;
  /** Nur in der offenen Liste. */
  readonly review_access?: RequestReviewAccess;
}

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

function listQuery(view: "open" | "history", params: AggregatedRequestParams) {
  const join = (values?: readonly string[]) =>
    values && values.length > 0 ? values.join(",") : undefined;
  return {
    view,
    search: params.search?.trim() || undefined,
    student_id: params.studentId || undefined,
    types: join(params.types),
    status: join(params.statuses),
    from: params.from || undefined,
    to: params.to || undefined,
    cursor: params.cursor || undefined,
  };
}

// The contract types `data` of an item as unknown: its shape follows
// `request_type`, which the union types above spell out.
function refinedPage<T>(page: {
  items: readonly unknown[] | null;
  next_cursor?: string;
  review_access?: string;
}): AggregatedRequestPage<T> {
  return {
    items: (page.items ?? []) as readonly T[],
    next_cursor: page.next_cursor,
    review_access: page.review_access as RequestReviewAccess | undefined,
  };
}

async function fetchPage<T>(
  view: "open" | "history",
  params: AggregatedRequestParams,
): Promise<AggregatedRequestPage<T>> {
  try {
    return refinedPage<T>(
      await bffJson("tenant", "GET /api/students/change-requests", {
        query: listQuery(view, params),
        errorMessage: "change request list load failed",
      }),
    );
  } catch (error) {
    // Fehlt das Recht „Kinder sehen“, trägt die Antwort den Code
    // students.absence_read_required; den Text liefert der Katalog (#2513).
    logger.warn("change_request_list_load_failed", {
      view,
      ...(error instanceof ApiError
        ? { status: error.status, ...(error.code ? { code: error.code } : {}) }
        : {}),
    });
    throw error;
  }
}

export function listAggregatedOpenRequests(
  params: AggregatedRequestParams = {},
): Promise<AggregatedRequestPage<AggregatedOpenRequest>> {
  return fetchPage<AggregatedOpenRequest>("open", params);
}

export function listAggregatedRequestHistory(
  params: AggregatedRequestParams = {},
): Promise<AggregatedRequestPage<AggregatedHistoryRequest>> {
  return fetchPage<AggregatedHistoryRequest>("history", params);
}

/** Die vier Arten, die über den gemeinsamen Lebenszyklus entschieden werden. */
export type ParentRequestKind =
  "master_data" | "care_schedule" | "offering" | "excused";

export interface BulkApproveRequestRef {
  readonly kind: ParentRequestKind;
  readonly id: string;
  readonly expected_version: string;
}

/**
 * Meldet eine abgelehnte schreibende Anfrage (#2513). Eine veraltete Version
 * (409 `students.change_request_stale`, #2267) erkennt die Oberfläche am
 * Code und lädt neu, statt die Person eine verlorene Entscheidung
 * wiederholen zu lassen; sie ist kein Fehler zum Protokollieren.
 */
function logWriteError(error: unknown): void {
  if (!(error instanceof ApiError)) return;
  if (error.code === "students.change_request_stale") return;
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
    return refinedPage<EnrollmentRequestItem>(
      await bffJson(
        "tenant",
        "GET /api/enrollment/admin/change-requests/list",
        {
          query: listQuery(view, rest),
          errorMessage: "enrollment change request list load failed",
        },
      ),
    );
  } catch (error) {
    logger.warn("enrollment_change_request_list_load_failed", {
      view,
      ...(error instanceof ApiError ? { status: error.status } : {}),
    });
    throw error;
  }
}
