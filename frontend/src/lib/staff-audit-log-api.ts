// Cross-staff audit feed (#1417): merged change trail over session edits,
// absence transitions, Stundenkonto bookings, month close/reopen, and
// deletion tombstones. Requires time_tracking:manage — callers must gate on
// the permission (like the time-accounts overview) so no request fires
// without it.

import { bffJson } from "./bff-fetch";
import { knownEnum } from "./contract/known-enum";
import type * as staffContract from "./contract/staff.generated";
import { createLogger } from "./logger";

const logger = createLogger({ component: "StaffAuditLogApi" });

// ─── Wire shapes (backend snake_case) ────────────────────────────────────────

export type AuditLogSource =
  | "session_edit"
  | "absence"
  | "adjustment"
  | "vacation_opening"
  | "absence_type_allowance"
  | "vacation_quota"
  | "month_close"
  | "month_reopen"
  | "deletion"
  | "personnel_number";

/** An event of a source this build can describe. */
export type KnownAuditLogEvent = staffContract.AuditLogEvent & {
  source: AuditLogSource;
};

// ─── Frontend shapes ─────────────────────────────────────────────────────────

export interface AuditLogEvent {
  occurredAt: string;
  source: AuditLogSource;
  entryId: string;
  staffId: string | null;
  staffName: string;
  actorStaffId: string | null;
  actorName: string;
  actorIsSystem: boolean;
  actorIsSelf: boolean;
  reason: string;
  detail: Record<string, unknown>;
}

export interface AuditLogPage {
  events: AuditLogEvent[];
  nextCursor: string | null;
  retentionCutoff: string;
}

export const auditLogSourceLabels: Record<AuditLogSource, string> = {
  session_edit: "Zeiterfassung",
  absence: "Abwesenheit",
  adjustment: "Stundenkonto",
  vacation_opening: "Urlaubs-Übernahme",
  absence_type_allowance: "Abwesenheitskontingent",
  vacation_quota: "Urlaubsanspruch",
  month_close: "Monatsabschluss",
  month_reopen: "Monat geöffnet",
  deletion: "Löschung",
  personnel_number: "Personalnummer",
};

const SOURCES = Object.keys(auditLogSourceLabels) as AuditLogSource[];

function isKnown(
  event: staffContract.AuditLogEvent | null,
): event is KnownAuditLogEvent {
  if (event === null) return false;
  if (knownEnum(SOURCES, event.source)) return true;
  // A source a newer backend added: this build has no sentence for it.
  logger.warn("audit_log_unknown_source", { source: event.source });
  return false;
}

function detailOf(detail: unknown): Record<string, unknown> {
  return typeof detail === "object" && detail !== null && !Array.isArray(detail)
    ? (detail as Record<string, unknown>)
    : {};
}

export function mapAuditLogEvent(data: KnownAuditLogEvent): AuditLogEvent {
  return {
    occurredAt: data.occurred_at,
    source: data.source,
    entryId: data.entry_id,
    staffId: data.staff?.id ?? null,
    staffName: data.staff?.name ?? "",
    actorStaffId: data.actor.staff_id ?? null,
    actorName: data.actor.name,
    actorIsSystem: data.actor.is_system,
    actorIsSelf: data.actor.is_self,
    reason: data.reason,
    detail: detailOf(data.detail),
  };
}

export interface AuditLogQuery {
  /** YYYY-MM-DD, inclusive. */
  from?: string;
  to?: string;
  staffId?: string;
  actorId?: string;
  sources?: AuditLogSource[];
  cursor?: string;
  limit?: number;
}

export function buildAuditLogQuery(query: AuditLogQuery): string {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.staffId) params.set("staff_id", query.staffId);
  if (query.actorId) params.set("actor_id", query.actorId);
  if (query.sources && query.sources.length > 0)
    params.set("sources", query.sources.join(","));
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  return params.toString();
}

export const staffAuditLogService = {
  /** Requires time_tracking:manage. */
  async getAuditLog(query: AuditLogQuery = {}): Promise<AuditLogPage> {
    const page = await bffJson(
      "tenant",
      "GET /api/staff/time-tracking/audit-log",
      {
        query: Object.fromEntries(
          new URLSearchParams(buildAuditLogQuery(query)),
        ),
        errorMessage: "Failed to fetch audit log",
      },
    );
    return {
      events: (page.events ?? []).filter(isKnown).map(mapAuditLogEvent),
      nextCursor: page.next_cursor ?? null,
      retentionCutoff: page.retention_cutoff,
    };
  },
};
