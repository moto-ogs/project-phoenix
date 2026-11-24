/**
 * API client for the timetable feature.
 *
 * Calls use the generated route keys through the tenant catalog proxy,
 * which supplies the session token server-side. The client mirrors the surface of the backend:
 * - getWeek(from, to)            → GET    /instances?from=&to=
 * - start(id), complete(id),     → POST   /instances/{id}/{action}
 *   cancel(id), reinstate(id)
 * - materialize(from?, to?)      → POST   /materialize
 */

import type {
  CancelInstanceRequest,
  materializeRequest,
  moveStaffRequest,
  replanWeekRequest,
} from "./contract/timetable.generated";
import { bffJson } from "./bff-fetch";
import { createLogger } from "./logger";
import {
  NO_PLAN_FILTER,
  planFilterQuery,
  type PlanFilter,
} from "./plan-filter";
import type {
  MoveStaffInput,
  MoveStaffResponse,
  StaffPoolResponse,
  CombinedOfferingCounts,
  OfferingSourceOption,
  AttendancePatchBody,
  AttendanceResponse,
  ConflictCheckParams,
  ConflictCheckResult,
  CreateInstanceBody,
  UpdateInstanceBody,
  CreateTemplateBody,
  CreateTemplateResult,
  ConvertInstanceToSeriesBody,
  ConvertInstanceToSeriesResult,
  EndTemplateBody,
  EndTemplateResult,
  EnrichedInstance,
  GapsResponse,
  DeviationHistoryResponse,
  GuardianNoticeInput,
  GuardianNoticeReach,
  InstanceStatusResult,
  MaterializeResult,
  BulkCancelResult,
  ReplanWeekResult,
  EditedInWindowResult,
  ShiftCoverageCheckParams,
  ShiftCoverageCheckResult,
  SplitTemplateBody,
  SplitTemplateResult,
  StartInstanceResult,
  ApplyDeviationsInput,
  ApplyDeviationsResponse,
  BulkSubstitutionInput,
  BulkSubstitutionResponse,
  TemplatesResponse,
  TimetableTemplate,
  UpdateTemplateBody,
  WeeklyInstancesResponse,
} from "./timetable-types";
import {
  mapConflictCheckResult,
  mapShiftCoverageCheckResult,
  mapCreateTemplateResult,
  mapEndTemplateResult,
  mapAttendance,
  mapGaps,
  mapDeviationHistory,
  mapApplyDeviations,
  mapBulkSubstitution,
  prepareApplyDeviationsBody,
  prepareBulkSubstitutionBody,
  mapMoveStaff,
  mapStaffPool,
  mapInstance,
  mapGuardianNoticeReach,
  mapInstanceStatusResult,
  mapMaterializeResult,
  mapBulkCancelResult,
  mapReplanWeekResult,
  mapEditedInWindowResult,
  mapSplitTemplateResult,
  mapStartInstanceResult,
  mapCombinedOfferingCounts,
  mapOfferingSourceOptions,
  mapTemplates,
  mapWeeklyInstances,
} from "./timetable-helpers";
import {
  connectionBody,
  mapOfferingPreview,
  mapRosterDeviations,
  previewQuery,
  type OfferingPreview,
  type OfferingSelection,
  type RosterDeviation,
} from "./roster-deviation";
import { mapBookingLeftovers, type BookingLeftover } from "./booking-leftover";
import { mapOfferingGaps, type OfferingGap } from "./offering-gap";
import {
  draftPreviewQuery,
  mapOfferingSuggestion,
  suggestionQuery,
  type DraftRoster,
  type OfferingSuggestion,
  type OfferingSuggestionQuery,
} from "./offering-suggestion";

const logger = createLogger({ component: "TimetableApiClient" });

/** A query the roster helpers built, as bffJson's query record. */
function queryOf(params: URLSearchParams): Record<string, string[]> {
  const query: Record<string, string[]> = {};
  for (const key of new Set(params.keys())) query[key] = params.getAll(key);
  return query;
}

/** Namens-Maps (ID → Anzeigename) aus dem Teilnehmer-Endpunkt (#2283). */
export interface InstanceParticipantNames {
  studentNames: Map<string, string>;
  staffNames: Map<string, string>;
}

function logLifecycle(instanceId: string, action: string): void {
  logger.info("instance_lifecycle_action", { instance_id: instanceId, action });
}

class TimetableService {
  /**
   * GET /api/timetable/instances?from=YYYY-MM-DD&to=YYYY-MM-DD.
   * Returns the materialized instances in the requested window plus
   * lightweight enrichment (room name, type, staff list, counts). The
   * optional filter narrows them to one OGS group and/or one person (#4766).
   * `view: "slim"` drops the per-child attendance rows (#4996): every block
   * then carries `students: []`, while counts and student IDs stay.
   */
  async getWeek(
    from: string,
    to: string,
    filter: PlanFilter = NO_PLAN_FILTER,
    options: { view?: "slim" } = {},
  ): Promise<WeeklyInstancesResponse> {
    const raw = await bffJson("tenant", "GET /api/timetable/instances/", {
      query: { from, to, ...planFilterQuery(filter), view: options.view },
    });
    return mapWeeklyInstances(raw);
  }

  /**
   * POST /api/timetable/instances — creates a planned instance outside
   * the materialization flow. When activity_group_id is omitted the row
   * is purely spontaneous (is_spontaneous=true server-side). Returns the
   * enriched instance shape so the caller can splice it into the SWR
   * cache without a refetch.
   */
  async create(
    body: CreateInstanceBody,
    idempotencyKey: string,
  ): Promise<EnrichedInstance> {
    const raw = await bffJson("tenant", "POST /api/timetable/instances/", {
      body,
      headers: { "Idempotency-Key": idempotencyKey },
    });
    logger.info("instance_created", {
      instance_id: raw.id,
      is_spontaneous: raw.is_spontaneous,
    });
    return mapInstance(raw);
  }

  /**
   * POST /api/timetable/templates — creates a recurring template
   * (activities.groups + schedules + timeframe in one shot) plus
   * optionally materializes the visible week so the new rows appear
   * on the planner grid immediately.
   */
  async createTemplate(
    body: CreateTemplateBody,
  ): Promise<CreateTemplateResult> {
    const raw = await bffJson("tenant", "POST /api/timetable/templates", {
      body,
    });
    logger.info("template_created", {
      template_id: raw.template_id,
      schedules: raw.schedule_ids?.length ?? 0,
      instances_created: raw.instances_created,
    });
    return mapCreateTemplateResult(raw);
  }

  /** Atomically creates a series and links the existing one-off occurrence. */
  async convertInstanceToSeries(
    instanceId: string,
    body: ConvertInstanceToSeriesBody,
  ): Promise<ConvertInstanceToSeriesResult> {
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/instances/{id}/convert-to-series",
      { params: { id: instanceId }, body },
    );
    logger.info("instance_converted_to_series", {
      instance_id: raw.linked_instance_id,
      template_id: raw.template_id,
    });
    return {
      templateId: raw.template_id,
      timeframeId: raw.timeframe_id,
      scheduleIds: raw.schedule_ids ?? [],
      linkedInstanceId: raw.linked_instance_id,
    };
  }

  /**
   * GET /api/timetable/offering-sources — Betreuungsangebote selectable as
   * Regeltermin roster source (#2137), with per-Jahrgang counts of approved
   * children and the templates already sourcing each offering.
   */
  async getOfferingSources(
    calendarPeriodId?: string | null,
  ): Promise<OfferingSourceOption[]> {
    const raw = await bffJson("tenant", "GET /api/timetable/offering-sources", {
      query: { calendar_period_id: calendarPeriodId || undefined },
    });
    return mapOfferingSourceOptions(raw);
  }

  /**
   * GET /api/timetable/offering-sources/combined-counts — deduplizierte
   * Kinderzahl über eine Auswahl mehrerer Angebote (Mehrfach-Quelle): ein
   * Kind in zwei gewählten Angeboten zählt einmal, damit der Editor die
   * exakte Belegung der Vereinigung anzeigt.
   */
  async getCombinedOfferingCounts(
    offeringIds: string[],
    calendarPeriodId?: string | null,
  ): Promise<CombinedOfferingCounts> {
    const raw = await bffJson(
      "tenant",
      "GET /api/timetable/offering-sources/combined-counts",
      {
        query: {
          ids: offeringIds,
          calendar_period_id: calendarPeriodId || undefined,
        },
      },
    );
    return mapCombinedOfferingCounts(raw);
  }

  async getTemplates(periodId?: string | null): Promise<TemplatesResponse> {
    const raw = await bffJson("tenant", "GET /api/timetable/templates", {
      query: { period_id: periodId || undefined },
    });
    return mapTemplates(raw);
  }

  /**
   * GET /api/timetable/templates/{id} — single template with schedules,
   * enrollment and staff assignments. The required period keeps scoped
   * rosters isolated in the same way as the list endpoint.
   */
  async getTemplate(
    templateId: string,
    periodId: string,
  ): Promise<TimetableTemplate> {
    const raw = await bffJson("tenant", "GET /api/timetable/templates/{id}", {
      params: { id: templateId },
      query: { period_id: periodId },
    });
    return mapTemplates({ templates: [raw] }).templates[0]!;
  }

  /**
   * GET /api/timetable/templates/roster-deviations — Regeltermine whose
   * children list differs from an offering's bookings (#5103).
   * `templateId` also reviews that Regeltermin when it is kept by hand:
   * „Mit Angebot verbinden“ names it, and connecting ends that state.
   */
  async getRosterDeviations(
    periodId: string,
    templateId?: string,
  ): Promise<RosterDeviation[]> {
    return mapRosterDeviations(
      await bffJson(
        "tenant",
        "GET /api/timetable/templates/roster-deviations",
        {
          query: { period_id: periodId, template_id: templateId || undefined },
        },
      ),
    );
  }

  /**
   * GET /api/timetable/templates/booking-leftovers — children a
   * hand-maintained Regeltermin keeps after their booking of those weekdays
   * ended (#5102).
   */
  async getBookingLeftovers(periodId: string): Promise<BookingLeftover[]> {
    return mapBookingLeftovers(
      await bffJson(
        "tenant",
        "GET /api/timetable/templates/booking-leftovers",
        { query: { period_id: periodId } },
      ),
    );
  }

  /**
   * PUT /api/timetable/templates/{id}/students/{studentId}/kept-days —
   * „Bleibt so“ (#5102) for the leftover, or its undo.
   */
  async setBookingLeftoverKept(
    leftover: BookingLeftover,
    kept: boolean,
  ): Promise<void> {
    await bffJson(
      "tenant",
      "PUT /api/timetable/templates/{id}/students/{studentId}/kept-days",
      {
        params: { id: leftover.templateId, studentId: leftover.studentId },
        body: {
          weekdays: leftover.weekdays,
          booking_ended_on: leftover.bookingEndedOn,
          kept,
        },
      },
    );
  }

  /**
   * GET /api/timetable/offering-gaps — offerings whose booked children no
   * Regeltermin of the period takes over (#5140).
   */
  async getOfferingGaps(periodId: string): Promise<OfferingGap[]> {
    return mapOfferingGaps(
      await bffJson("tenant", "GET /api/timetable/offering-gaps", {
        query: { period_id: periodId },
      }),
    );
  }

  /**
   * PUT /api/timetable/offering-gaps/{offeringId}/acknowledgement —
   * „Kein eigener Regeltermin nötig“ (#5140) for the classes the hint names,
   * or its undo.
   */
  async setOfferingGapAcknowledged(
    offeringId: string,
    periodId: string,
    acknowledged: boolean,
  ): Promise<void> {
    await bffJson(
      "tenant",
      "PUT /api/timetable/offering-gaps/{offeringId}/acknowledgement",
      {
        params: { offeringId },
        body: { period_id: periodId, acknowledged },
      },
    );
  }

  /** GET /api/timetable/templates/{id}/offering-preview (#5103). */
  async getOfferingPreview(
    templateId: string,
    selection: OfferingSelection,
    from?: string,
  ): Promise<OfferingPreview> {
    return mapOfferingPreview(
      await bffJson(
        "tenant",
        "GET /api/timetable/templates/{id}/offering-preview",
        {
          params: { id: templateId },
          query: queryOf(previewQuery(selection, from)),
        },
      ),
    );
  }

  /**
   * GET /api/timetable/offering-sources/suggestion — the offering whose
   * bookings match the children an unsaved Regeltermin plans (#5104); null
   * when none matches.
   */
  async getOfferingSuggestion(
    query: OfferingSuggestionQuery,
  ): Promise<OfferingSuggestion | null> {
    return mapOfferingSuggestion(
      await bffJson(
        "tenant",
        "GET /api/timetable/offering-sources/suggestion",
        { query: queryOf(suggestionQuery(query)) },
      ),
    );
  }

  /**
   * GET /api/timetable/offering-sources/preview — per weekday who joins and
   * who leaves an unsaved Regeltermin when it takes its children from the
   * offerings (#5104).
   */
  async getDraftOfferingPreview(
    periodId: string,
    selection: OfferingSelection,
    roster: DraftRoster,
    from?: string,
    template?: Pick<OfferingSuggestionQuery, "type" | "listKind">,
  ): Promise<OfferingPreview> {
    return mapOfferingPreview(
      await bffJson("tenant", "GET /api/timetable/offering-sources/preview", {
        query: queryOf(
          draftPreviewQuery(periodId, selection, roster, from, template),
        ),
      }),
    );
  }

  /**
   * POST /api/timetable/templates/{id}/offering-connection — „Mit Angebot
   * verbinden“ (#5103) for every period of the series from the confirmed
   * preview's day on. The preview's fingerprint travels along; the server
   * refuses when other children would join or leave now (ADR 0311).
   */
  async connectTemplateToOffering(
    templateId: string,
    selection: OfferingSelection,
    preview: Pick<OfferingPreview, "from" | "fingerprint">,
  ): Promise<void> {
    await bffJson(
      "tenant",
      "POST /api/timetable/templates/{id}/offering-connection",
      {
        params: { id: templateId },
        body: connectionBody(selection, preview),
      },
    );
  }

  /** PUT /api/timetable/templates/{id}/manual-roster (#5103). */
  async setManualRosterConfirmed(
    templateId: string,
    confirmed: boolean,
  ): Promise<void> {
    await bffJson("tenant", "PUT /api/timetable/templates/{id}/manual-roster", {
      params: { id: templateId },
      body: { confirmed },
    });
  }

  /**
   * POST /api/timetable/templates/{id}/split — "ab Datum ändern". Ends
   * the old template version at effective_date and creates a new one with
   * the submitted fields from that date on. Future instances of the old
   * version are deleted; the optional materialize window re-creates them
   * from the new version immediately.
   */
  async splitTemplate(
    templateId: string,
    body: SplitTemplateBody,
  ): Promise<SplitTemplateResult> {
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/templates/{id}/split",
      { params: { id: templateId }, body },
    );
    logger.info("template_split", {
      old_template_id: raw.old_template_id,
      new_template_id: raw.new_template_id,
      deleted_instances: raw.deleted_instances,
      instances_created: raw.instances_created,
    });
    return mapSplitTemplateResult(raw);
  }

  /**
   * POST /api/timetable/templates/{id}/end — "dieser und alle folgenden
   * löschen". Ends the template at effective_date and removes still-planned
   * future instances of that template.
   */
  async endTemplate(
    templateId: string,
    body: EndTemplateBody,
  ): Promise<EndTemplateResult> {
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/templates/{id}/end",
      {
        params: { id: templateId },
        body,
      },
    );
    logger.info("template_ended", {
      template_id: raw.template_id,
      effective_date: raw.effective_date,
      deleted_instances: raw.deleted_instances,
    });
    return mapEndTemplateResult(raw);
  }

  /**
   * GET /api/timetable/conflicts — advisory pre-save conflict check
   * for a date/time window. Optional resource params are omitted when
   * empty so the backend only checks what the caller asked about.
   */
  async checkConflicts(
    params: ConflictCheckParams,
  ): Promise<ConflictCheckResult> {
    const raw = await bffJson("tenant", "GET /api/timetable/conflicts", {
      query: {
        date: params.date,
        start_time: params.startTime,
        end_time: params.endTime,
        room_id: params.roomId || undefined,
        staff_ids: params.staffIds,
        student_ids: params.studentIds,
        exclude_instance_id: params.excludeInstanceId || undefined,
        exclude_activity_group_id: params.excludeActivityGroupId || undefined,
      },
    });
    return mapConflictCheckResult(raw);
  }

  /**
   * GET /api/timetable/conflict-acks — fingerprints of the conflicts the
   * current user has hidden in this school (#2139).
   */
  async getConflictAcks(): Promise<string[]> {
    const raw = await bffJson("tenant", "GET /api/timetable/conflict-acks/");
    return raw.fingerprints ?? [];
  }

  /**
   * PUT /api/timetable/conflict-acks/{fingerprint} — hide one reviewed
   * conflict for the current user. Idempotent.
   */
  async acknowledgeConflict(fingerprint: string): Promise<void> {
    await bffJson("tenant", "PUT /api/timetable/conflict-acks/{fingerprint}", {
      params: { fingerprint },
    });
  }

  /**
   * DELETE /api/timetable/conflict-acks/{fingerprint} — show a previously
   * hidden conflict again. Idempotent.
   */
  async unacknowledgeConflict(fingerprint: string): Promise<void> {
    await bffJson(
      "tenant",
      "DELETE /api/timetable/conflict-acks/{fingerprint}",
      { params: { fingerprint } },
    );
  }

  /**
   * POST /api/timetable/shift-coverage — batched, read-only comparison of
   * concrete candidate dates with the assigned staff members' shifts.
   */
  async checkShiftCoverage(
    params: ShiftCoverageCheckParams,
    options?: { signal?: AbortSignal },
  ): Promise<ShiftCoverageCheckResult> {
    const raw = await bffJson("tenant", "POST /api/timetable/shift-coverage", {
      signal: options?.signal,
      body: {
        dates: params.dates,
        start_time: params.startTime,
        end_time: params.endTime,
        staff_ids: params.staffIds,
        exclude_instance_id: params.excludeInstanceId || undefined,
        concrete_instance_date: params.concreteInstanceDate,
        replan_activity_group_id: params.replanActivityGroupId || undefined,
        calendar_period_id: params.calendarPeriodId || undefined,
        week_pattern: params.weekPattern,
      },
    });
    return mapShiftCoverageCheckResult(raw);
  }

  async updateTemplate(
    templateId: string,
    body: UpdateTemplateBody,
  ): Promise<TimetableTemplate> {
    const raw = await bffJson("tenant", "PUT /api/timetable/templates/{id}", {
      params: { id: templateId },
      body,
    });
    return mapTemplates({ templates: [raw] }).templates[0]!;
  }

  async archiveTemplate(templateId: string): Promise<void> {
    await bffJson("tenant", "DELETE /api/timetable/templates/{id}", {
      params: { id: templateId },
    });
  }

  async update(
    instanceId: string,
    body: UpdateInstanceBody,
  ): Promise<EnrichedInstance> {
    const raw = await bffJson("tenant", "PUT /api/timetable/instances/{id}", {
      params: { id: instanceId },
      body,
    });
    return mapInstance(raw);
  }

  async deleteCancelled(instanceId: string): Promise<void> {
    await bffJson("tenant", "DELETE /api/timetable/instances/{id}", {
      params: { id: instanceId },
    });
    logger.info("cancelled_instance_deleted", {
      instance_id: instanceId,
    });
  }

  /**
   * POST /api/timetable/instances/{id}/start.
   * Transitions a planned instance to active and creates the active.group
   * bridge. Returns soft warnings (staff/student double-bookings) so the
   * caller can surface them.
   */
  async start(instanceId: string): Promise<StartInstanceResult> {
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/instances/{id}/start",
      { params: { id: instanceId } },
    );
    logLifecycle(instanceId, "start");
    return mapStartInstanceResult(raw);
  }

  /**
   * POST /api/timetable/instances/{id}/complete.
   * Transitions an active instance to completed. Closes the active.group,
   * marks remaining expected students as absent. The planner has no live
   * roster: confirming present children belongs to the operations path.
   */
  async complete(instanceId: string): Promise<InstanceStatusResult> {
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/instances/{id}/complete",
      { params: { id: instanceId } },
    );
    logLifecycle(instanceId, "complete");
    return mapInstanceStatusResult(raw);
  }

  async reopen(instanceId: string): Promise<StartInstanceResult> {
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/instances/{id}/reopen",
      { params: { id: instanceId } },
    );
    logLifecycle(instanceId, "reopen");
    return mapStartInstanceResult(raw);
  }

  /**
   * POST /api/timetable/instances/{id}/cancel.
   * Cancels a planned or active instance. From active, ends the bridge
   * cleanly via active.EndActivitySession.
   */
  async cancel(
    instanceId: string,
    reason?: string,
    guardianNotice?: GuardianNoticeInput,
  ): Promise<InstanceStatusResult> {
    const body: CancelInstanceRequest = {};
    if (reason) body.reason = reason;
    if (guardianNotice) {
      body.guardian_notice = {
        title: guardianNotice.title,
        message: guardianNotice.message,
      };
    }
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/instances/{id}/cancel",
      { params: { id: instanceId }, body },
    );
    logLifecycle(instanceId, "cancel");
    return mapInstanceStatusResult(raw);
  }

  /**
   * POST /api/timetable/instances/{id}/reinstate (#7151).
   * Takes back a cancellation while the block has not ended; the block is
   * planned again and its staff hear "findet doch statt".
   */
  async reinstate(instanceId: string): Promise<InstanceStatusResult> {
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/instances/{id}/reinstate",
      { params: { id: instanceId } },
    );
    logLifecycle(instanceId, "reinstate");
    return mapInstanceStatusResult(raw);
  }

  /**
   * Preview for "Eltern informieren" in the cancel dialog (#2601): whether the
   * school allows the notice, whether the checkbox starts ticked, and how many
   * children / families the block reaches.
   */
  async getGuardianNoticeReach(
    instanceId: string,
  ): Promise<GuardianNoticeReach> {
    return mapGuardianNoticeReach(
      await bffJson(
        "tenant",
        "GET /api/timetable/instances/{id}/guardian-notice",
        { params: { id: instanceId } },
      ),
    );
  }

  /**
   * POST /api/timetable/materialize.
   * When called without arguments, the backend defaults to next Mon–Sun.
   * The planner UI passes the currently visible week so the user can re-run
   * materialization for that window.
   */
  async materialize(from?: string, to?: string): Promise<MaterializeResult> {
    const body: materializeRequest = {};
    if (from) body.from_date = from;
    if (to) body.to_date = to;

    const raw = await bffJson("tenant", "POST /api/timetable/materialize", {
      body,
    });
    logger.info("materialize_completed", {
      from: raw.from,
      to: raw.to,
      created: raw.instances_created,
    });
    return mapMaterializeResult(raw);
  }

  /**
   * POST /api/timetable/instances/re-plan-week.
   * Optional activityGroupId narrows the re-plan to one template's planned
   * instances (backend body field activity_group_id); the
   * re-materialization still covers the whole window (insert-only).
   */
  async replanWeek(
    from: string,
    to: string,
    activityGroupId?: string,
  ): Promise<ReplanWeekResult> {
    const body: replanWeekRequest = { from_date: from, to_date: to };
    if (activityGroupId) {
      body.activity_group_id = activityGroupId;
    }
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/instances/re-plan-week",
      { body },
    );
    logger.info("week_replanned", {
      from: raw.from,
      to: raw.to,
      deleted: raw.deleted_instances,
      created: raw.instances_created,
    });
    return mapReplanWeekResult(raw);
  }

  /**
   * POST /api/timetable/instances/bulk-cancel (#3594).
   * Cancels and removes the planned appointments in [from, to] from today
   * on, except series planned on closing days on purpose unless
   * `includeClosingDaySeries` is set. Parents are not notified. `dryRun`
   * only counts them for the confirmation dialog; a real run sends that
   * count's `fingerprint`, and the server refuses it when other appointments
   * would be cancelled now (ADR 0311).
   */
  async bulkCancel(
    from: string,
    to: string,
    dryRun: boolean,
    includeClosingDaySeries = false,
    expectedFingerprint?: string,
  ): Promise<BulkCancelResult> {
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/instances/bulk-cancel",
      {
        body: {
          from,
          to,
          dry_run: dryRun,
          include_closing_day_series: includeClosingDaySeries,
          expected_fingerprint: expectedFingerprint,
        },
      },
    );
    if (!dryRun) {
      logger.info("instances_bulk_cancelled", {
        from: raw.from,
        to: raw.to,
        count: raw.count,
      });
    }
    return mapBulkCancelResult(raw);
  }

  /**
   * GET /api/timetable/instances/edited-in-window (#1875).
   * Which planned occurrences of one template were individually edited ("Nur
   * diesen Termin") in [from, to] — the changes a series re-plan would discard.
   * The planner calls this before an "Alle Termine" / "Dieser und folgende"
   * edit to warn and list the affected dates. Pass includeDeletions on the
   * "following" split path: a split resurrects individually-deleted occurrences
   * under the successor template (same-template re-plans preserve them).
   */
  async countEditedInWindow(
    activityGroupId: string,
    from: string,
    to: string,
    includeDeletions = false,
  ): Promise<EditedInWindowResult> {
    const raw = await bffJson(
      "tenant",
      "GET /api/timetable/instances/edited-in-window",
      {
        query: {
          activity_group_id: activityGroupId,
          from,
          to,
          include_deletions: includeDeletions || undefined,
        },
      },
    );
    return mapEditedInWindowResult(raw);
  }

  async getGaps(from: string, to: string): Promise<GapsResponse> {
    const raw = await bffJson("tenant", "GET /api/timetable/gaps", {
      query: { date: from, date_to: to },
    });
    return mapGaps(raw);
  }

  /** Änderungsprotokoll (#1886): Abweichungs-Verlauf im Datumsfenster,
   * optional auf einen Slot (Serie + Startzeit) eingegrenzt. */
  async getDeviationHistory(
    from: string,
    to: string,
    activityGroupId?: string,
    startTime?: string,
  ): Promise<DeviationHistoryResponse> {
    const raw = await bffJson(
      "tenant",
      "GET /api/timetable/deviations/history",
      {
        query: {
          date: from,
          date_to: to,
          activity_group_id: activityGroupId || undefined,
          start_time: startTime || undefined,
        },
      },
    );
    return mapDeviationHistory(raw);
  }

  /**
   * POST /api/timetable/instances/{id}/deviations — applies an entire
   * Vertretungsplan slide-over save (absences, substitute, understaffed
   * acknowledgement, cancel) in ONE backend transaction (#1840). Either every
   * edit lands or none does; the frontend never sequences independent
   * mutations that could half-commit.
   */
  async applyDeviations(
    instanceId: string,
    input: ApplyDeviationsInput,
  ): Promise<ApplyDeviationsResponse> {
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/instances/{id}/deviations",
      { params: { id: instanceId }, body: prepareApplyDeviationsBody(input) },
    );
    logger.info("deviations_applied", {
      instance_id: instanceId,
      cancelled: raw.cancelled,
    });
    return mapApplyDeviations(raw);
  }

  /**
   * POST /api/timetable/substitutions/bulk — Sammel-Vertretung (#2284):
   * applies one person's day-wide absence (optionally covered by one
   * substitute) to several selected days in ONE backend transaction. Either
   * every selected day lands or none does.
   */
  async applyBulkSubstitution(
    input: BulkSubstitutionInput,
  ): Promise<BulkSubstitutionResponse> {
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/substitutions/bulk",
      { body: prepareBulkSubstitutionBody(input) },
    );
    const result = mapBulkSubstitution(raw);
    logger.info("bulk_substitution_applied", {
      dates: input.dates.length,
      affected_instances: result.totalAffected,
      with_substitute: Boolean(input.substituteStaffId),
    });
    return result;
  }

  /**
   * GET /api/timetable/instances/{id}/staff-pool — Personalpool für das
   * Zeitfenster des Blocks (#1884): jede Person kategorisiert gegen
   * Dienstplan (Schichten) und überlappende Blockzuordnungen.
   */
  async getStaffPool(instanceId: string): Promise<StaffPoolResponse> {
    const raw = await bffJson(
      "tenant",
      "GET /api/timetable/instances/{id}/staff-pool",
      { params: { id: instanceId } },
    );
    return mapStaffPool(raw);
  }

  /**
   * GET /api/timetable/instances/{id}/participants — Teilnehmer- und
   * Personal-Namen eines Blocks für die Leseansicht (#2283). schedules:read
   * genügt; Kindernamen filtert das Backend pro Kind über
   * gdpr.student_data_scope (gefilterte Kinder fehlen still), Personal-Namen
   * kommen ungefiltert.
   */
  async getInstanceParticipants(
    instanceId: string,
  ): Promise<InstanceParticipantNames> {
    const raw = await bffJson(
      "tenant",
      "GET /api/timetable/instances/{id}/participants",
      { params: { id: instanceId } },
    );
    return {
      studentNames: new Map(
        (raw.participants ?? []).map((p) => [p.student_id, p.display_name]),
      ),
      staffNames: new Map(
        (raw.staff ?? []).map((s) => [s.staff_id, s.display_name]),
      ),
    };
  }

  /**
   * POST /api/timetable/instances/{id}/move-staff — atomarer Personal-Move
   * (#1884): Entnahme aus dem Quellblock und Zuordnung zum Zielblock in
   * EINEM Save; ohne sourceInstanceId wird eine freie Person zugewiesen.
   */
  async moveStaff(
    instanceId: string,
    input: MoveStaffInput,
  ): Promise<MoveStaffResponse> {
    const body: moveStaffRequest = { staff_id: input.staffId };
    if (input.sourceInstanceId) {
      body.source_instance_id = input.sourceInstanceId;
    }
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/instances/{id}/move-staff",
      { params: { id: instanceId }, body },
    );
    logger.info("staff_moved", {
      target_instance_id: instanceId,
      action: raw.action,
    });
    return mapMoveStaff(raw);
  }

  async patchAttendance(
    instanceId: string,
    studentId: string,
    body: AttendancePatchBody,
  ): Promise<AttendanceResponse> {
    const raw = await bffJson(
      "tenant",
      "PATCH /api/timetable/instances/{instance_id}/students/{student_id}",
      {
        params: { instance_id: instanceId, student_id: studentId },
        body,
      },
    );
    return mapAttendance(raw);
  }
}

export const timetableService = new TimetableService();
