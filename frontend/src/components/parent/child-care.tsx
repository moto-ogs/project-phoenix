"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LOCATION_COLORS } from "~/lib/location-helper";
import { StatusColorBadge } from "~/components/ui/status-color-badge";
import { StatusBadge } from "~/components/ui/status-badge";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { ApiError } from "~/lib/api-error";
import { useLocale, useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import type { MotoConcept } from "~/lib/moto-concepts";
import { Modal } from "~/components/ui/modal";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import {
  RequestSharingControl,
  RequestSharingSelector,
} from "~/components/parent/request-sharing-control";
import { TimeField } from "~/components/ui/time-field";
import { ISODatePicker } from "~/components/ui/date-picker";
import { knownEnum } from "~/lib/contract/known-enum";
import { useLocalizedDatePicker } from "~/lib/hooks/use-localized-date-picker";
import {
  type DayDepartureMode,
  REQUESTABLE_DAY_DEPARTURE_MODES,
  type StudentStatusKind,
  deleteCareException,
  downloadPickupRequestProofPdf,
  getChildCareSchedule,
  listCareExceptions,
  listChildGuardians,
  listPickupChangeRequests,
  listExcusedRequests,
  listSickDays,
  submitCareException,
  submitSickNote,
  updatePickupChangeRequest,
} from "~/lib/parent-api";
import {
  RequestEditModal,
  useRequestEditedAt,
} from "~/components/parent/request-edit-modal";
import { useChildFeatures } from "~/components/parent/child-requests-context";
import { CustomSelect } from "~/components/ui/custom-select";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { Textarea } from "~/components/ui/textarea";
import { Input } from "~/components/ui/input";
import { useDebounce } from "~/lib/use-debounce";
import { useApiFormError } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import {
  formatCalendarDate,
  formatLocalizedDate,
} from "~/lib/localized-date-format";
import { berlinTodayISO, parseISODate, toISODate } from "~/lib/date-helpers";
import { useMessagesActivity } from "~/lib/hooks/use-messages-activity";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { PARENT_RESOURCE_OPTIONS } from "~/lib/hooks/use-parent-resources";
import {
  revalidateOrThrow,
  useInvalidateFamily,
  useSWRAuth,
  useTenantMutate,
} from "~/lib/swr";
import { parentKeys } from "~/lib/swr/parent-keys";
import { useDraftOn } from "~/lib/swr/read-draft";
import type { SignatureValue } from "~/lib/signature";
import {
  PickupSignatureField,
  PickupSignatureStatementLoadError,
  usePickupSignatureStatement,
} from "~/components/parent/pickup-permission-fields";
import { pickupConcept } from "~/lib/concepts/pickup";
import { sickConcept } from "~/lib/concepts/sick";
import { InsetPanel } from "~/components/ui/inset-panel";
import { SectionLabel } from "~/components/ui/section-label";
import { useCareTermTranslations } from "~/lib/care-facility-term";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";

const logger = createLogger({ component: "ChildCare" });

// Thrown by reportSick when a gated absence was created server-side but
// the follow-up reload that would surface the new pending request failed. The
// SickNoteModal maps it to a localized "submitted but couldn't refresh" hint
// rather than leaking a raw message — the submission itself succeeded (#1845).
class ChildCareRefreshError extends Error {
  constructor() {
    super("child care refresh failed");
    this.name = "ChildCareRefreshError";
  }
}

const MAX_SICK_DAYS = 60;
const MAX_NOTE_LEN = 2000;

/**
 * How a report landed: written directly, sent as a request for every day, or
 * written for the free days with a request for days the school holds (#5698).
 */
export type AbsenceSubmissionOutcome = "applied" | "pending" | "partly_pending";

// Stable empty default for SickStatusSummary's optional excusedRequests prop —
// a fresh [] literal per render would break referential equality (oxlint
// react/no-object-type-as-default-prop).
const EMPTY_EXCUSED_REQUESTS: readonly parentMeContract.ParentExcusedRequestResponse[] =
  [];
const EMPTY_PICKUP_CHANGE_REQUESTS: parentMeContract.PickupChangeRequestResponse[] =
  [];
const NO_STATUS_DAY_LIST: parentMeContract.StatusDayResponse[] = [];
const NO_EXCUSED_REQUEST_LIST: parentMeContract.ParentExcusedRequestResponse[] =
  [];
const NO_CARE_EXCEPTION_LIST: parentMeContract.CareExceptionResponse[] = [];

// --- date helpers (native <input type=date> already yields YYYY-MM-DD) ---

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function enumerateDates(fromISO: string, toISO: string): string[] {
  if (!DATE_ONLY_RE.test(fromISO) || !DATE_ONLY_RE.test(toISO)) return [];
  const from = parseISODate(fromISO);
  const to = parseISODate(toISO);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];
  if (to.getTime() < from.getTime()) return [];
  const out: string[] = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime() && out.length < MAX_SICK_DAYS) {
    out.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

// True when `next` (YYYY-MM-DD) is exactly the calendar day after `prev`.
// Mirrors the staff review list's isNextDay so a Mon+Wed request is never shown
// as "Mon – Wed" (which would wrongly imply Tuesday is included too).
function isNextDayISO(prev: string, next: string): boolean {
  const d = parseISODate(prev);
  d.setDate(d.getDate() + 1);
  return toISODate(d) === next;
}

function formatLocaleDate(iso: string, locale: string): string {
  return formatLocalizedDate(iso, locale);
}

// --- data hook ---

// An unavailable capability response must not offer parent mutations.
const DEFAULT_FEATURES: parentMeContract.ChildFeaturesResponse = {
  sick_note_enabled: false,
  excused_note_enabled: false,
  // Default false on fetch failure (least privilege), consistent with the other
  // consequential flags below: the features fetch .catch returns DEFAULT_FEATURES,
  // and a school with messaging turned OFF would otherwise show an enabled
  // composer on a transient hiccup → send → 403. The backend enforces the gate
  // regardless; this just keeps the UI from dead-ending on an action it can see.
  notes_enabled: false,
  // Consequential capability: default false on fetch failure (least privilege),
  // so a transient hiccup hides the request actions rather than dead-ending on
  // a 403; the backend enforces the gate regardless.
  request_submit_enabled: false,
  pickup_change_enabled: false,
  pickup_manage_allowed: false,
  guardian_contact_manage_allowed: false,
  absence_request_edit_enabled: false,
  // Capability flags default to false on fetch failure (least privilege —
  // hide invite/remove if we can't confirm they're enabled; the backend
  // enforces the gate regardless).
  related_accounts_invite_enabled: false,
  related_accounts_remove_enabled: false,
  master_data_edit_enabled: false,
  master_data_contact_edit_enabled: false,
  master_data_request_enabled: false,
  meal_plan_enabled: false,
  meal_registration_enabled: false,
  // State flag defaults false so a fetch failure never shows a phantom
  // "Anfrage offen" badge on the overview.
  has_open_change_request: false,
  // Default false on fetch failure (least privilege): hide the Neuigkeiten
  // panel rather than showing an empty one for a school that has news off; the
  // backend feed enforces the gate regardless.
  parent_news_enabled: false,
  conference_book_allowed: false,
  care_ended: false,
  sick_requires_approval: false,
  excused_requires_approval: false,
  pickup_change_mode_enabled: false,
  pickup_change_cutoff_time: "",
  pickup_change_today_closed: false,
  pickup_change_care_day_ended: false,
  emergency_contact_manage_allowed: false,
  reason_required: false,
  care_facility_term: "",
  care_facility_article: "die",
};

// The child's effective pickup situation for TODAY, resolved from the weekly
// base plan, any date-specific override, and today's absence status. The
// "Heute → Abholung" tile renders this; every branch is a real state, never a
// fabricated value (#1725):
//   - "time":    a pickup time applies today (`changed` = a same-day override
//                differs from a KNOWN base-plan time; false when the times are
//                equal or the base plan is unavailable — we never claim a
//                difference we cannot verify)
//   - "absent":  the child is off today (sick / excused / class trip, any
//                source, per the backend today_absent signal), so no pickup
//   - "none":    it's a care day (or weekend) with no pickup configured — bus,
//                self-departure, or simply not set
//   - "unknown": an authoritative input couldn't be loaded, so we assert nothing
export type TodayPickup =
  | { readonly kind: "time"; readonly time: string; readonly changed: boolean }
  | { readonly kind: "absent" }
  | { readonly kind: "none" }
  | { readonly kind: "unknown" };

// ISO weekday (Mon=1 .. Sun=7) of a YYYY-MM-DD date, matching the care-schedule
// wire format where weekdays are 1..5.
function isoWeekday(dateISO: string): number {
  return ((parseISODate(dateISO).getDay() + 6) % 7) + 1;
}

// Pure merge of base plan + override + absence into today's pickup state. Kept
// separate from the hook so it stays trivially unit-testable.
//
// Correctness turns on which inputs actually LOADED, because a failed fetch is
// an empty array/false — indistinguishable from "nothing here" — and silently
// showing a base-plan time that a real (unloaded) override or absence would
// contradict is the bug this guards (#1725 review):
//   - `weekPlanLoaded` gates the base plan AND `todayAbsent` (both ride the
//     care-schedule response). Without it we know neither the base time nor
//     whether the child is off.
//   - `careExceptionsLoaded` gates the override list. Without it we cannot rule
//     out a same-day change, so we must not fall through to a base-plan time.
//
// Order matters: an absence (when known) wins over any configured time, and a
// LOADED same-day override with a pickup time is authoritative even if the base
// plan never loaded — we just can't call it "changed" without a base to compare.
export function resolveTodayPickup(params: {
  readonly weekdays: parentMeContract.CareScheduleResponse["weekdays"];
  readonly weekPlanLoaded: boolean;
  // Authoritative all-source absence for today (sick / excused / class trip),
  // computed server-side. Only meaningful when weekPlanLoaded (same response).
  readonly todayAbsent: boolean;
  readonly careExceptions: readonly parentMeContract.CareExceptionResponse[];
  readonly careExceptionsLoaded: boolean;
  readonly today: string;
}): TodayPickup {
  const {
    weekdays,
    weekPlanLoaded,
    todayAbsent,
    careExceptions,
    careExceptionsLoaded,
    today,
  } = params;

  // Absence wins over any configured time — but only when we actually loaded the
  // signal (it rides the care-schedule response).
  if (weekPlanLoaded && todayAbsent) return { kind: "absent" };

  // Without the override list we can't distinguish "no override" from "fetch
  // failed", so we can't safely assert a base-plan time or "none" (#1725 review).
  if (!careExceptionsLoaded) return { kind: "unknown" };

  // A CareException overrides arrival and pickup independently, so a missing
  // pickup_time normally means "pickup not changed" (fall back to the base
  // plan), NOT "no pickup". Absence is expressed through today_absent above —
  // EXCEPT a staff "not coming today" exception (a pickup row with no time,
  // pickup_absent, OR an arrival row with no time, arrival_absent). Neither
  // creates a status day, so today_absent misses both; either leg being absent
  // resolves as an absence here rather than showing the base-plan pickup — a
  // guardian must never be told to expect a pickup for a child who is not
  // coming (#1725 review).
  const override = careExceptions.find((entry) => entry.date === today);
  if (override?.pickup_absent || override?.arrival_absent)
    return { kind: "absent" };
  if (override?.pickup_time) {
    // "changed" only when a LOADED base plan exists to differ FROM and the times
    // actually differ; an override equal to the plan is no real change, and a
    // missing base plan means we can't claim a difference at all (#1725 review).
    // Gate on weekPlanLoaded, not merely `base !== undefined`: a failed or
    // midnight-stale care-schedule fetch keeps the PREVIOUS weekdays array live
    // (setWeekdays only runs on success), so comparing an override against that
    // stale plan could wrongly flag "changed". When the plan isn't loaded we
    // treat the base as unknown and never mark a difference (#1725 review).
    const base = weekPlanLoaded
      ? (weekdays ?? []).find((entry) => entry.weekday === isoWeekday(today))
          ?.pickup
      : undefined;
    const changed = base !== undefined && base !== override.pickup_time;
    return { kind: "time", time: override.pickup_time, changed };
  }

  if (!weekPlanLoaded) return { kind: "unknown" };

  const base = (weekdays ?? []).find(
    (entry) => entry.weekday === isoWeekday(today),
  );
  if (base?.pickup) return { kind: "time", time: base.pickup, changed: false };
  return { kind: "none" };
}

export interface ChildCare {
  readonly sickDays: parentMeContract.StatusDayResponse[];
  // Absence requests that went through the OGS approval gate (pending +
  // recently decided). Empty for schools that gate neither absence type.
  readonly excusedRequests: parentMeContract.ParentExcusedRequestResponse[];
  readonly careExceptions: parentMeContract.CareExceptionResponse[];
  readonly pickupChangeRequests: parentMeContract.PickupChangeRequestResponse[];
  // Whether the care-exception list actually loaded. A failed fetch leaves
  // careExceptions empty, which is indistinguishable from "no overrides exist"
  // — and submitCareException treats an omitted leg as an authoritative clear.
  // The pickup modal must block saving while this is false so a parent can't
  // silently wipe an existing override the UI never managed to prefill.
  readonly careExceptionsLoaded: boolean;
  readonly pickupChangeRequestsLoaded: boolean;
  /** Reads the pickup requests again; rejects when the read fails. */
  readonly reloadPickupRequests: () => Promise<unknown>;
  /** Reads the absence requests again; rejects when the read fails. */
  readonly reloadExcusedRequests: () => Promise<unknown>;
  // Today's resolved pickup state for the "Heute" tile (see TodayPickup).
  readonly todayPickup: TodayPickup;
  readonly features: parentMeContract.ChildFeaturesResponse;
  readonly loading: boolean;
  /**
   * The first failure of the latest load, null when every list arrived. The
   * page shows it on the shared load-error path: without it a failed feature
   * request would hide every action without a word (#2518).
   */
  readonly loadError: unknown;
  reportSick(
    dates: string[],
    reason: string,
    status: StudentStatusKind,
    recipientGuardianProfileIds?: string[],
  ): Promise<AbsenceSubmissionOutcome | void>;
  saveCareException(params: PickupChangeSubmitParams): Promise<void | string>;
  removeCareException(date: string): Promise<void>;
  /** Lädt die Daten des Kindes neu, etwa nach einer geänderten Anfrage. */
  refresh(): void;
}

export function useChildCare(
  studentId: string,
  options: Readonly<{
    /**
     * Das Kind hat keinen OGS-Platz (#4803). Abholung und Wochenplan gibt es
     * dann nicht; der Server lehnt sie ab, also werden sie nicht geladen.
     */
    withoutCarePlace?: boolean;
  }> = {},
): ChildCare {
  const withoutCarePlace = options.withoutCarePlace === true;
  const tChild = useCareTermTranslations("parentChild");
  // Today's calendar day in the SCHOOL's timezone (Europe/Berlin): the axis
  // the backend resolves absences and overrides against. It advances at
  // midnight in a tab left open, and with it every day-bound key (#1725).
  const today = useBerlinToday();
  const featureState = useChildFeatures(studentId);
  const { failure: featureFailure } = useSwrResourceLoadError(
    [{ data: featureState.features, error: featureState.failure }],
    tChild("errorObjectCare"),
    () => featureState.reload(),
  );
  const sick = useSWRAuth(
    parentKeys.sickDays(studentId, today),
    () => listSickDays(studentId),
    PARENT_RESOURCE_OPTIONS,
  );
  // Always fetched: the response is empty for schools without the approval
  // gate, so gating it on the feature flag would only add an ordering
  // dependency.
  const excused = useSWRAuth(
    parentKeys.excusedRequests(studentId, today),
    () => listExcusedRequests(studentId),
    PARENT_RESOURCE_OPTIONS,
  );
  const exceptions = useSWRAuth(
    withoutCarePlace ? null : parentKeys.careExceptions(studentId, today),
    () => listCareExceptions(studentId),
    PARENT_RESOURCE_OPTIONS,
  );
  const pickupRequests = useSWRAuth(
    withoutCarePlace ? null : parentKeys.pickupChangeRequests(studentId, today),
    () => listPickupChangeRequests(studentId),
    PARENT_RESOURCE_OPTIONS,
  );
  // Not part of loadError: the Heute card says the pickup time is
  // unavailable, and the care-schedule section shows its own load error with
  // retry. A third box would repeat the same outage.
  const schedule = useSWRAuth(
    withoutCarePlace ? null : parentKeys.careSchedule(studentId, today),
    () => getChildCareSchedule(studentId),
    PARENT_RESOURCE_OPTIONS,
  );
  const mutateKey = useTenantMutate();
  // A write captures its child; if the guardian moved on to another child
  // meanwhile, the readers' mutate belongs to that child (#1725 review).
  const currentStudentIdRef = useRef(studentId);
  useLayoutEffect(() => {
    currentStudentIdRef.current = studentId;
  });
  const { mutate: reloadSick } = sick;
  const { mutate: reloadExcused } = excused;
  const { mutate: reloadExceptions } = exceptions;
  const { mutate: reloadPickupRequests } = pickupRequests;
  const { mutate: reloadSchedule } = schedule;

  // A failed list keeps its last confirmed answer; empty only until the first
  // one arrived. The pickup modal relies on careExceptionsLoaded to avoid
  // clearing a leg it never prefilled.
  const careExceptionsLoaded = !!exceptions.data && !exceptions.error;
  const pickupChangeRequestsLoaded =
    !!pickupRequests.data && !pickupRequests.error;
  // Ohne OGS-Platz (#4803) laden Abholung und Ausnahmen nicht; sie zählen
  // dann weder als ladend noch als fehlgeschlagen.
  const lists = withoutCarePlace
    ? [sick, excused]
    : [sick, excused, exceptions, pickupRequests];
  const listsLoading = lists.some(
    (list) => list.data === undefined && !list.error,
  );
  const listFailure = lists.find((list) => list.error)?.error;

  const reload = useCallback(
    () =>
      Promise.all([
        reloadSick(),
        reloadExcused(),
        reloadExceptions(),
        reloadPickupRequests(),
        reloadSchedule(),
      ]),
    [
      reloadExceptions,
      reloadExcused,
      reloadPickupRequests,
      reloadSchedule,
      reloadSick,
    ],
  );

  // A parent write or a staff decision on an absence request flips the
  // request's state or writes status days server-side but emits only an SSE
  // trigger. ParentRealtimeBridge turns the backend's message-independent
  // parent_child_updated event into a `parent-conversation-refresh` window
  // event with the affected studentId, which reaches every guardian of the
  // child even when messaging is off (#1845 review). Focus revalidation of
  // the readers heals a tab whose SSE stream had dropped.
  // SWR's own revalidation per key: an answer already on its way is dropped
  // and every reader of the key waits for the one fresh read.
  const refreshChildStatus = useCallback(() => {
    void reload();
    void mutateKey(parentKeys.careOfferings(studentId));
  }, [mutateKey, reload, studentId]);
  useMessagesActivity({
    eventName: "parent-conversation-refresh",
    studentId,
    onMatch: refreshChildStatus,
    marksRead: false,
  });
  const reloadFeatures = featureState.reload;
  const retryChildCare = useCallback(() => {
    void reloadFeatures();
    void reload();
  }, [reload, reloadFeatures]);

  const reportSick = useCallback(
    async (
      dates: string[],
      reason: string,
      status: StudentStatusKind,
      recipientGuardianProfileIds: string[] = [],
    ) => {
      const { status_days, pending_request } = await submitSickNote(
        studentId,
        dates,
        reason,
        status,
        recipientGuardianProfileIds,
      );
      if (currentStudentIdRef.current !== studentId) return;
      const day = berlinTodayISO();
      // A direct write (sick note, or an excused absence without the approval
      // gate) returns the just-recorded days. Merge them into the loaded list
      // (replacing same-date entries) so previously reported absences stay.
      if ((status_days ?? []).length > 0) {
        const submittedDates = new Set((status_days ?? []).map((d) => d.date));
        void reloadSick(
          (prev) =>
            [
              ...(prev ?? []).filter((d) => !submittedDates.has(d.date)),
              ...(status_days ?? []),
            ].sort((a, b) => a.date.localeCompare(b.date)),
          { revalidate: false },
        );
        // A report that covers today makes the child absent now. todayPickup
        // reads today_absent exclusively, so the "Heute → Abholung" tile
        // follows at once; the server signal agrees on the next load (#1725
        // review). The day is stamped so the midnight guard trusts it.
        if ((status_days ?? []).some((d) => d.date === day)) {
          void reloadSchedule(
            (plan) => plan && { ...plan, today_absent: true, today_date: day },
            { revalidate: false },
          );
        }
        if (!pending_request) return "applied" as const;
      }
      // Empty status days means the school gated this absence: the backend
      // created a pending request instead. Reload authoritatively to surface
      // the new "Freigabe ausstehend" request.
      void Promise.all([
        reloadSick(),
        reloadExceptions(),
        reloadPickupRequests(),
        reloadSchedule(),
      ]);
      const requestsOk = await reloadExcused(listExcusedRequests(studentId), {
        revalidate: false,
      }).then(
        () => true,
        () => false,
      );
      if (!requestsOk) {
        // The request WAS created server-side, but the reload that would
        // surface it failed. Propagate so the modal stays open and says so.
        // A retry is safe: the backend treats an identical resubmit
        // idempotently (#1845 review).
        throw new ChildCareRefreshError();
      }
      return (status_days ?? []).length > 0
        ? ("partly_pending" as const)
        : ("pending" as const);
    },
    [
      reloadExceptions,
      reloadExcused,
      reloadPickupRequests,
      reloadSchedule,
      reloadSick,
      studentId,
    ],
  );

  const saveCareException = useCallback(
    async (params: PickupChangeSubmitParams) => {
      const saved = await submitCareException(studentId, params);
      if (currentStudentIdRef.current !== studentId) return;
      void reloadPickupRequests(
        (prev) => [
          saved,
          ...(prev ?? []).filter((request) => request.id !== saved.id),
        ],
        { revalidate: false },
      );
      return saved.id;
    },
    [reloadPickupRequests, studentId],
  );

  const removeCareException = useCallback(
    async (date: string) => {
      await deleteCareException(studentId, date);
      if (currentStudentIdRef.current !== studentId) return;
      void reloadExceptions(
        (prev) => (prev ?? []).filter((e) => e.date !== date),
        {
          revalidate: false,
        },
      );
    },
    [reloadExceptions, studentId],
  );

  const plan = schedule.data;
  const careExceptions = exceptions.data ?? NO_CARE_EXCEPTION_LIST;
  const todayPickup = useMemo(
    () =>
      resolveTodayPickup({
        weekdays: plan?.weekdays ?? [],
        // The week-plan signal (base plan AND today_absent) is only valid for
        // the day the server resolved it for. Across midnight the tile shows
        // "unknown" instead of a stale absence or pickup (#1725 review). An
        // older backend omits today_date.
        weekPlanLoaded:
          !!plan && !schedule.error && (plan.today_date ?? today) === today,
        todayAbsent: plan?.today_absent ?? false,
        careExceptions,
        careExceptionsLoaded,
        today,
      }),
    [plan, schedule.error, careExceptions, careExceptionsLoaded, today],
  );

  return {
    sickDays: sick.data ?? NO_STATUS_DAY_LIST,
    excusedRequests: excused.data ?? NO_EXCUSED_REQUEST_LIST,
    careExceptions,
    pickupChangeRequests: pickupRequests.data ?? EMPTY_PICKUP_CHANGE_REQUESTS,
    careExceptionsLoaded,
    pickupChangeRequestsLoaded,
    reloadPickupRequests: () => revalidateOrThrow(pickupRequests),
    reloadExcusedRequests: () => revalidateOrThrow(excused),
    todayPickup,
    features: featureState.features ?? DEFAULT_FEATURES,
    loading:
      listsLoading ||
      (!withoutCarePlace && schedule.data === undefined && !schedule.error) ||
      featureState.loading,
    loadError: featureFailure ?? listFailure ?? null,
    reportSick,
    saveCareException,
    removeCareException,
    refresh: retryChildCare,
  };
}

// --- sick-note modal ---

/**
 * The failures the absence dialog explains itself: the report went through
 * but the list did not reload, the request overlaps an open one, and the
 * school already excused the child from a time on one of the days. Every
 * other failure goes through the shared error path.
 */
function knownSickErrorKey(err: unknown): string | null {
  if (err instanceof ChildCareRefreshError) {
    return "sick.submittedButRefreshFailed";
  }
  if (err instanceof ApiError && err.code === "care.excused_request_overlap") {
    return "sick.overlapError";
  }
  if (err instanceof ApiError && err.code === "care.care_exception_conflict") {
    return "sick.schoolPartialConflict";
  }
  return null;
}

const NO_CARE_EXCEPTIONS: readonly parentMeContract.CareExceptionResponse[] =
  [];
const NO_STATUS_DAYS: readonly parentMeContract.StatusDayResponse[] = [];
/** A day the school already holds: from a time, or (`time` null) sick. */
type SchoolDay = { readonly date: string; readonly time: string | null };
// "Mittwoch, 11.11.2026": parents plan absences by weekday.
const SCHOOL_DAY_FORMAT = {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
} as const;

const SICK_REASON_FIELD = "absence-reason";

export function SickNoteModal({
  studentId,
  onClose,
  onSubmit,
  sickRequiresApproval,
  excusedRequiresApproval,
  sickEnabled = true,
  excusedEnabled = true,
  reasonRequired = true,
  careExceptions = NO_CARE_EXCEPTIONS,
  sickDays = NO_STATUS_DAYS,
  withoutCarePlace = false,
}: Readonly<{
  studentId?: string;
  onClose: () => void;
  onSubmit: (
    dates: string[],
    reason: string,
    status: StudentStatusKind,
    recipientGuardianProfileIds?: string[],
  ) => Promise<AbsenceSubmissionOutcome | void>;
  sickEnabled?: boolean;
  excusedEnabled?: boolean;
  sickRequiresApproval?: boolean;
  excusedRequiresApproval?: boolean;
  /** Ob die OGS einen Grund verlangt (requiresGuardianReason). */
  reasonRequired?: boolean;
  /**
   * Die Tagesänderungen des Kindes. Für Tage mit einer Teil-Abwesenheit der
   * OGS (`excused_from`) geht die Meldung als Anfrage an die OGS (#5698).
   */
  careExceptions?: readonly parentMeContract.CareExceptionResponse[];
  /**
   * Die Abwesenheiten, die Eltern sehen. Eine Krankmeldung der OGS
   * (`source` nicht `parent`) ist ein Schuleintrag wie eine Teil-Abwesenheit.
   */
  sickDays?: readonly parentMeContract.StatusDayResponse[];
  /**
   * Das Kind hat keinen Platz in der OGS (#4803): die Meldung geht an die
   * Schule, die Texte nennen darum keine OGS.
   */
  withoutCarePlace?: boolean;
}>) {
  const t = useCareTermTranslations("parentChildCare");
  const locale = useLocale();
  const datePicker = useLocalizedDatePicker();
  const initial = berlinTodayISO();
  const [from, setFrom] = useState(initial);
  const [to, setTo] = useState(initial);
  const [selectedStatus, setStatus] = useState<StudentStatusKind>("sick");
  const status =
    selectedStatus === "sick" && !sickEnabled
      ? "excused"
      : selectedStatus === "excused" && !excusedEnabled
        ? "sick"
        : selectedStatus;
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<
    Exclude<AbsenceSubmissionOutcome, "applied"> | false
  >(false);
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  // Fehler aus dem offenen Dialog stehen im Dialog: ein Toast läge
  // unsichtbar unter ihm.
  const form = useApiFormError();
  const latestSubmitRef = useRef<() => void>(() => undefined);
  const errorId = useId();
  const reasonError = form.fieldError(SICK_REASON_FIELD);
  const dates = useMemo(() => enumerateDates(from, to), [from, to]);
  // Entries read for exactly the chosen days after the server refused one:
  // the school may have entered it after the page loaded, or beyond the
  // window the page reads.
  const [reloadedExceptions, setReloadedExceptions] =
    useState<readonly parentMeContract.CareExceptionResponse[]>(
      NO_CARE_EXCEPTIONS,
    );
  // Only a manual partial absence is a school entry; the backend ignores
  // automatic excusals from a pulled-forward pickup time, and so does the
  // read that fills excused_from. Such days go to the school as a request.
  const schoolExcusedFrom = useMemo(
    () =>
      new Map(
        [...careExceptions, ...reloadedExceptions].flatMap((day) =>
          day.excused_from ? [[day.date, day.excused_from] as const] : [],
        ),
      ),
    [careExceptions, reloadedExceptions],
  );
  const schoolSickDates = useMemo(
    () =>
      new Set(
        sickDays
          .filter((day) => day.source !== "parent")
          .map((day) => day.date),
      ),
    [sickDays],
  );
  const schoolDays = dates.flatMap((date): SchoolDay[] => {
    const time = schoolExcusedFrom.get(date);
    if (time) return [{ date, time }];
    return schoolSickDates.has(date) ? [{ date, time: null }] : [];
  });
  const freeDayCount = dates.length - schoolDays.length;
  const noteMissing = reason.trim() === "";
  const requiresApproval =
    status === "sick" ? sickRequiresApproval : excusedRequiresApproval;
  const kindHint =
    status === "sick"
      ? requiresApproval === false
        ? withoutCarePlace
          ? "sick.kindHintSickWithoutCarePlace"
          : "sick.kindHintSick"
        : withoutCarePlace
          ? "sick.kindHintSickUnknownWithoutCarePlace"
          : "sick.kindHintSickUnknown"
      : requiresApproval === false
        ? "sick.kindHintExcused"
        : "sick.kindHintExcusedUnknown";
  const dayCopy =
    schoolDays.length > 0 && requiresApproval === false
      ? freeDayCount === 0
        ? null
        : t("sick.freeDaysCount", {
            count: freeDayCount,
            total: dates.length,
          })
      : requiresApproval === undefined
        ? t("sick.unknownDaysCount", { count: dates.length })
        : requiresApproval
          ? t("sick.requestDaysCount")
          : t("sick.daysCount", { count: dates.length });

  const handleSubmit = async () => {
    if (!sickEnabled && !excusedEnabled) return;
    if (dates.length === 0) {
      form.invalid(t("sick.invalidDate"));
      return;
    }
    if (reasonRequired && noteMissing) {
      const message = withoutCarePlace
        ? t("sick.reasonRequiredErrorWithoutCarePlace")
        : t("sick.reasonRequiredError");
      form.invalid(message, { [SICK_REASON_FIELD]: message });
      return;
    }
    setSubmitting(true);
    form.clear();
    try {
      const outcome = await onSubmit(dates, reason, status, recipientIds);
      if (outcome === "pending" || outcome === "partly_pending")
        setSubmitted(outcome);
      else onClose();
    } catch (err) {
      const known = knownSickErrorKey(err);
      if (known === "sick.schoolPartialConflict" && studentId) {
        form.invalid(t(known));
        // The school entered a day while the dialog was open. Once the
        // notice names it, sending again turns that day into a request.
        const reloaded = await listCareExceptions(studentId, {
          from: dates[0]!,
          to: dates[dates.length - 1]!,
        }).catch(() => NO_CARE_EXCEPTIONS);
        setReloadedExceptions(reloaded);
        if (
          reloaded.some((day) => day.excused_from && dates.includes(day.date))
        )
          form.clear();
      } else if (known) {
        form.invalid(t(known));
      } else {
        // Wiederholen sendet die Angaben, die jetzt im Dialog stehen.
        void form.show(err, {
          object: t("sick.errorObject"),
          retry: () => latestSubmitRef.current(),
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  useLayoutEffect(() => {
    latestSubmitRef.current = () => void handleSubmit();
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={
        submitted === "partly_pending"
          ? t("sick.requestSentPartlyTitle")
          : submitted
            ? t("sick.requestSentTitle")
            : t("sick.title")
      }
      closeLabel={t("close")}
      mobileSheet
      footer={
        submitted ? undefined : (
          <>
            <Button
              type="button"
              variant="outline"
              size="md"
              className="hidden sm:inline-flex"
              noTooltip="Schließt den Dialog, ohne etwas zu melden."
              onClick={onClose}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              size="md"
              className="w-full sm:w-auto"
              onClick={() => void handleSubmit()}
              disabled={submitting || (!sickEnabled && !excusedEnabled)}
              tooltip={t(
                withoutCarePlace
                  ? requiresApproval === true
                    ? "sick.submitRequestTooltipWithoutCarePlace"
                    : "sick.submitTooltipWithoutCarePlace"
                  : requiresApproval === true
                    ? "sick.submitRequestTooltip"
                    : requiresApproval === false && schoolDays.length === 0
                      ? "sick.submitDirectTooltip"
                      : "sick.submitTooltip",
              )}
              disabledReason={
                !sickEnabled && !excusedEnabled
                  ? t(
                      withoutCarePlace
                        ? "sick.submitBlockedWithoutCarePlace"
                        : "sick.submitBlocked",
                    )
                  : undefined
              }
              isLoading={submitting}
              loadingText={t("sick.submitting")}
            >
              {withoutCarePlace
                ? status === "sick"
                  ? t("sick.submitSickWithoutCarePlace")
                  : t("sick.submitExcusedWithoutCarePlace")
                : status === "sick"
                  ? t("sick.submitSick")
                  : t("sick.submitExcused")}
            </Button>
          </>
        )
      }
    >
      {submitted ? (
        <p role="status" className="text-sm leading-6 text-gray-700">
          {submitted === "partly_pending"
            ? t(
                withoutCarePlace
                  ? "sick.requestSentPartlyBodyWithoutCarePlace"
                  : "sick.requestSentPartlyBody",
              )
            : requiresApproval === false
              ? t(
                  withoutCarePlace
                    ? "sick.requestSentSchoolBodyWithoutCarePlace"
                    : "sick.requestSentSchoolBody",
                )
              : withoutCarePlace
                ? t("sick.requestSentBodyWithoutCarePlace")
                : t("sick.requestSentBody")}
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-gray-700">
            {withoutCarePlace
              ? t("sick.introWithoutCarePlace")
              : t("sick.intro")}
          </p>
          <CustomSelect
            label={t("sick.kindLabel")}
            value={status}
            onChange={(value) => {
              setStatus(value as StudentStatusKind);
              form.clear();
            }}
            options={[
              ...(sickEnabled
                ? [{ value: "sick", label: t("sick.kindSick") }]
                : []),
              ...(excusedEnabled
                ? [{ value: "excused", label: t("sick.kindExcused") }]
                : []),
            ]}
          />
          <InsetPanel as="p" framed className="text-sm leading-5 text-gray-600">
            {t(kindHint)}
          </InsetPanel>
          <fieldset className="space-y-2">
            <SectionLabel as="legend">{t("sick.periodLabel")}</SectionLabel>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ISODatePicker
                {...datePicker}
                id={`${errorId}-from`}
                label={t("sick.from")}
                ariaLabel={t("sick.from")}
                value={from}
                min={initial}
                onChange={(next) => {
                  setFrom(next);
                  if (next > to) setTo(next);
                }}
                calendarLayout="popover"
                hideClearButton
              />
              <ISODatePicker
                {...datePicker}
                id={`${errorId}-to`}
                label={t("sick.to")}
                ariaLabel={t("sick.to")}
                value={to}
                min={from}
                onChange={setTo}
                calendarLayout="popover"
                hideClearButton
              />
            </div>
          </fieldset>
          {schoolDays.length > 0 && requiresApproval !== true && (
            <Alert
              type="info"
              title={t("sick.schoolPartialTitle", {
                count: schoolDays.length,
              })}
              message={
                <ul className="space-y-0.5 tabular-nums">
                  {schoolDays.map((day) => (
                    <li key={day.date}>
                      {day.time
                        ? t("sick.schoolPartialDay", {
                            date: formatCalendarDate(
                              day.date,
                              locale,
                              SCHOOL_DAY_FORMAT,
                            ),
                            time: day.time,
                          })
                        : t(
                            withoutCarePlace
                              ? "sick.schoolSickDayWithoutCarePlace"
                              : "sick.schoolSickDay",
                            {
                              date: formatCalendarDate(
                                day.date,
                                locale,
                                SCHOOL_DAY_FORMAT,
                              ),
                            },
                          )}
                    </li>
                  ))}
                </ul>
              }
              details={
                <p className="mt-2">
                  {t("sick.schoolPartialRequest", {
                    count: schoolDays.length,
                  })}
                </p>
              }
            />
          )}
          {dayCopy && <p className="text-sm text-gray-600">{dayCopy}</p>}
          <Textarea
            label={
              withoutCarePlace
                ? t("sick.reasonLabelWithoutCarePlace")
                : t("sick.reasonLabelRequired")
            }
            value={reason}
            maxLength={MAX_NOTE_LEN}
            onChange={(event) => {
              setReason(event.target.value);
              if (form.error) form.clear();
            }}
            name={SICK_REASON_FIELD}
            autoComplete="off"
            required={reasonRequired}
            rows={3}
            placeholder={t("sick.reasonPlaceholder")}
            aria-invalid={Boolean(reasonError)}
            aria-describedby={reasonError ? errorId : undefined}
            className="min-h-20 text-base"
          />
          {requiresApproval === true && studentId && (
            <RequestSharingSelector
              studentId={studentId}
              selected={recipientIds}
              onChange={setRecipientIds}
            />
          )}
          <div id={errorId}>
            <FormErrorAlert message={form.error} />
          </div>
        </div>
      )}
    </Modal>
  );
}

// --- pickup-time change modal ---

/** Die Angaben einer Tagesanfrage (#3945, #4780). */
export type PickupChangeSubmitParams = Parameters<
  typeof submitCareException
>[1];

const DAY_SIGNATURE_FIELD = "pickup-day-signature";
const OTHER_PERSON_NAME_FIELD = "pickup-other-person-name";

/**
 * Die Kontaktpersonen des Kindes, die an einem Tag abholen können (#4780):
 * alle eingetragenen Personen außer dem eigenen Konto.
 */
function useDayPickupContacts(
  studentId: string | undefined,
): parentMeContract.childGuardianResponse[] {
  // Without the list only the choice „Wer holt ab?“ is missing; pickup time
  // and mode stay requestable, so a failure stays silent.
  const { data } = useSWRAuth(
    studentId ? parentKeys.guardians(studentId) : null,
    () => listChildGuardians(studentId ?? ""),
    PARENT_RESOURCE_OPTIONS,
  );
  return useMemo(
    () => (data ?? []).filter((row) => !row.is_self && row.can_manage_pickup),
    [data],
  );
}

/** What a pickup request sends; `signature` signs the day's declaration. */
interface PickupDraft {
  readonly pickupTime: string;
  /** Leer heißt: die Abholart des Tages bleibt, wie sie ist (#3945). */
  readonly departureMode: DayDepartureMode | "";
  readonly reason: string;
  /**
   * Eine Kontaktperson, die das Kind an diesem Tag abholt (#4780), oder
   * {@link OTHER_PICKUP_PERSON} für eine andere Person mit Namen (#8162).
   */
  readonly pickupPersonId: string;
  /** Der Name der anderen Person, wenn sie keine Kontaktperson ist. */
  readonly pickupPersonName: string;
  readonly signature: SignatureValue | null;
}

/** Auswahlwert für eine Person, die keine Kontaktperson ist (#8162). */
const OTHER_PICKUP_PERSON = "other";
/** So lang darf der Name einer anderen Person sein (wie im Backend). */
const PICKUP_PERSON_NAME_MAX = 120;

/** Der Name ohne doppelte Leerzeichen, wie das Backend ihn speichert. */
function normalizedPersonName(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).join(" ");
}

const EMPTY_PICKUP_DRAFT: PickupDraft = {
  pickupTime: "",
  departureMode: "",
  reason: "",
  pickupPersonId: "",
  pickupPersonName: "",
  signature: null,
};

/** The fields of an open request, with the day's saved values beneath. */
function requestPickupDraft(
  request: parentMeContract.PickupChangeRequestResponse,
  existing: parentMeContract.CareExceptionResponse | undefined,
): PickupDraft {
  return {
    pickupTime: request.pickup_time ?? existing?.pickup_time ?? "",
    departureMode:
      knownEnum(
        REQUESTABLE_DAY_DEPARTURE_MODES,
        request.departure_mode ?? undefined,
      ) ?? "",
    reason: request.reason ?? existing?.reason ?? "",
    ...requestPickupPerson(request),
    signature: null,
  };
}

/** Die Abholperson einer offenen Anfrage für den Dialog. */
function requestPickupPerson(
  request: parentMeContract.PickupChangeRequestResponse | undefined,
): Pick<PickupDraft, "pickupPersonId" | "pickupPersonName"> {
  if (request?.pickup_person_one_time && request.pickup_person) {
    return {
      pickupPersonId: OTHER_PICKUP_PERSON,
      pickupPersonName: request.pickup_person,
    };
  }
  return {
    pickupPersonId: request?.pickup_person_guardian_profile_id ?? "",
    pickupPersonName: "",
  };
}

export function PickupTimeModal({
  studentId,
  careExceptions,
  pickupChangeRequests = EMPTY_PICKUP_CHANGE_REQUESTS,
  careExceptionsLoaded,
  pickupChangeRequestsLoaded = true,
  pickupChangeEnabled,
  departureModeEnabled = false,
  childFirstName,
  today: childToday,
  onClose,
  onSubmit,
  onRemove,
  reasonRequired = true,
  cutoffTime,
  todayClosed = false,
  careDayEnded = false,
  onCutoffPassed,
  reloadRequests,
}: Readonly<{
  studentId?: string;
  careExceptions: parentMeContract.CareExceptionResponse[];
  pickupChangeRequests?: parentMeContract.PickupChangeRequestResponse[];
  careExceptionsLoaded: boolean;
  pickupChangeRequestsLoaded?: boolean;
  pickupChangeEnabled: boolean;
  /** Die Anfrage darf auch die Abholart des Tages ändern (#3945). */
  departureModeEnabled?: boolean;
  childFirstName?: string;
  today?: parentMeContract.TodayStatusResponse;
  onClose: () => void;
  onSubmit: (params: PickupChangeSubmitParams) => Promise<void | string>;
  onRemove: (date: string) => Promise<void>;
  /** Ob die OGS einen Grund verlangt (requiresGuardianReason). */
  reasonRequired?: boolean;
  /** Uhrzeit (HH:MM), bis zu der Eltern heute noch ändern dürfen (#3163). */
  cutoffTime?: string;
  /** Die Frist für heute ist vorbei; heute ist für Eltern gesperrt. */
  todayClosed?: boolean;
  /**
   * Die Betreuung ist für heute zu Ende (Betreuungsende der Schule, #5710);
   * heute ist für Eltern gesperrt, auch wenn das Kind noch im Unterricht ist.
   */
  careDayEnded?: boolean;
  /** Der Server hat die Frist oder das Betreuungsende gemeldet: Daten neu laden. */
  onCutoffPassed?: () => void;
  /**
   * Liest die Anfragen nach einer Ablehnung neu und lehnt ab, wenn das
   * scheitert (ADR 0311): `useChildCare().reloadPickupRequests`.
   */
  reloadRequests: () => Promise<unknown>;
}>) {
  const t = useCareTermTranslations("parentChildCare");
  const tModes = useCareTermTranslations("parentMasterData");
  const tTimePicker = useTranslations("datePicker.timePicker");
  const locale = useLocale();
  const datePicker = useLocalizedDatePicker();
  const today = berlinTodayISO();
  // Meldet der Server die Frist, bevor die Merkmale neu geladen sind, sperrt
  // der Dialog heute sofort, statt dieselbe Absage noch einmal zu zeigen.
  const [cutoffReported, setCutoffReported] = useState(false);
  // Dasselbe für das Betreuungsende (#5710).
  const [careDayEndReported, setCareDayEndReported] = useState(false);
  // Ist das Aendern abgeschaltet, oeffnet der Dialog auf dem einzigen Tag, den
  // die Eltern noch bearbeiten koennen. Ein offener Antrag geht dabei vor: er
  // ist der Tag mit dem Zuruecknehmen-Knopf, und ohne diese Vorauswahl stuende
  // der Dialog auf heute, wo es zu dem Antrag nichts zu sehen gibt.
  const initial = useMemo(() => {
    if (pickupChangeEnabled) return today;
    const pendingRequest = pickupChangeRequests.find(
      (request) => request.status === "pending",
    );
    if (pendingRequest) return pendingRequest.date;
    return (
      careExceptions.find((entry) => entry.pickup_source === "guardian")
        ?.date ?? today
    );
  }, [careExceptions, pickupChangeEnabled, pickupChangeRequests, today]);
  // Two calendar months ahead — mirrors the backend cap in SubmitCareException
  // and the parent-portal list window, so the picker can't offer a date the
  // server would reject.
  const maxSelectable = (() => {
    const d = parseISODate(today);
    d.setMonth(d.getMonth() + 2);
    return toISODate(d);
  })();
  const [date, setDate] = useState(initial);
  // The fields of a new request; an edit of an open one has its own draft
  // (`edit` below).
  const [created, setCreated] = useState<PickupDraft>(EMPTY_PICKUP_DRAFT);
  const contacts = useDayPickupContacts(studentId);
  const tPermission = useCareTermTranslations("parentPickupPermission");
  const [submitting, setSubmitting] = useState(false);
  // Fehler aus dem offenen Dialog stehen im Dialog: ein Toast läge
  // unsichtbar unter ihm. Die Rückfrage zum Zurücknehmen hat ihren eigenen.
  const form = useApiFormError();
  const resetForm = useApiFormError();
  const { clear: clearForm } = form;
  const latestActionsRef = useRef<
    Record<"submit" | "saveEdit" | "remove", () => void>
  >({
    submit: () => undefined,
    saveEdit: () => undefined,
    remove: () => undefined,
  });
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const editing = editingRequestId !== null;
  // „Änderung zurücknehmen“ löscht die eigene Abholzeit des Tages: der Klick
  // im Footer öffnet erst die Rückfrage, entfernt wird im Dialog (#3109).
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [invalidField, setInvalidField] = useState<
    "pickupTime" | "reason" | null
  >(null);
  const pickupTimeRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const errorId = useId();

  const existing = useMemo(
    () => careExceptions.find((e) => e.date === date),
    [careExceptions, date],
  );
  const request = useMemo(
    () =>
      pickupChangeRequests.find((entry) =>
        editingRequestId ? entry.id === editingRequestId : entry.date === date,
      ),
    [date, editingRequestId, pickupChangeRequests],
  );
  const pending = request?.status === "pending";
  const invalidateFamily = useInvalidateFamily();
  // The edit of an open request (ADR 0311): filled from the request, a
  // newer read refills it only while the parent has not changed it, and the
  // save sends the version it was filled from. After a refusal it shows the
  // stored request once it is read; nothing is sent until then.
  const edit = useDraftOn<
    parentMeContract.PickupChangeRequestResponse,
    PickupDraft,
    string
  >(
    {
      opening: editing && request ? editingRequestId : null,
      data: editing ? request : undefined,
      reload: async () => {
        const list = await reloadRequests();
        return Array.isArray(list)
          ? (list as parentMeContract.PickupChangeRequestResponse[]).find(
              (entry) => entry.id === editingRequestId,
            )
          : undefined;
      },
    },
    {
      token: (read) => read.version ?? "",
      toDraft: (read) => requestPickupDraft(read, existing),
      // The dialog closes after the save; the list reloads then.
      answer: (_saved, shown) => shown,
    },
  );
  const { setDraft: setEditDraft } = edit;
  // A newer read refilled the untouched edit: an error about the replaced
  // input no longer applies. After a refusal its message stays.
  const editToken = editing ? edit.token : undefined;
  const lastEditRef = useRef({ token: editToken, status: edit.status });
  useEffect(() => {
    const last = lastEditRef.current;
    lastEditRef.current = { token: editToken, status: edit.status };
    if (
      last.token === undefined ||
      editToken === undefined ||
      last.token === editToken ||
      last.status !== "ready"
    ) {
      return;
    }
    clearForm();
    setInvalidField(null);
  }, [clearForm, edit.status, editToken]);
  const fields = editing && edit.draft ? edit.draft : created;
  const {
    pickupTime,
    departureMode,
    pickupPersonId,
    pickupPersonName,
    signature,
    reason,
  } = fields;
  const setFields = (patch: Partial<PickupDraft>) => {
    if (editing) setEditDraft((current) => ({ ...current, ...patch }));
    else setCreated((current) => ({ ...current, ...patch }));
  };
  const staffOwned = existing?.pickup_source === "staff";
  // Eine Abholart, die die OGS für den Tag eingetragen hat, ändern Eltern
  // nicht per Anfrage; die Abholzeit bleibt trotzdem anfragbar (#3945).
  const staffMode = existing?.departure_mode;
  const modeField = departureModeEnabled && !staffMode;
  const modeLabel = (mode: string) => tModes(`departureModes.${mode}`);
  // Eine Abholperson passt nur, wenn das Kind abgeholt wird (#4780).
  // Eine andere Person mit Namen geht auch ohne Kontakte (#8162).
  const effectiveDepartureMode = staffMode ?? departureMode;
  const personField =
    effectiveDepartureMode === "" || effectiveDepartureMode === "pickup";
  const pickupPerson = personField
    ? contacts.find((contact) => contact.guardian_profile_id === pickupPersonId)
    : undefined;
  const otherPerson = personField && pickupPersonId === OTHER_PICKUP_PERSON;
  const otherPersonName = otherPerson
    ? normalizedPersonName(pickupPersonName)
    : "";
  // Der Wortlaut lädt erst, wenn der Name eine Weile steht.
  const statementPersonName = useDebounce(otherPersonName, 400);
  const personNamed = Boolean(pickupPerson) || otherPersonName !== "";
  const needsDaySignature =
    personNamed || (modeField && departureMode === "alone");
  const statementPerson = pickupPerson
    ? `${pickupPerson.first_name} ${pickupPerson.last_name}`.trim()
    : statementPersonName;
  const daySignatureStatement = usePickupSignatureStatement(
    studentId,
    statementPerson !== ""
      ? { kind: "day_pickup", personName: statementPerson, date, departureMode }
      : modeField && departureMode === "alone"
        ? { kind: "day_pickup", date, departureMode }
        : null,
  );
  // Ein Wortlaut zu einem älteren Namen gilt nicht: die Unterschrift muss
  // den Namen tragen, der gesendet wird.
  const dayStatement =
    !otherPerson || statementPersonName === otherPersonName
      ? daySignatureStatement.statement
      : null;
  const alreadyHome = date === today && childToday?.state === "left";
  // Nach der Frist ist heute für Eltern ganz zu: nicht anfragen, nicht
  // bearbeiten, nicht zurücknehmen. Spätere Tage bleiben offen (#3163).
  // Ab Betreuungsende ist heute ebenso zu (#5710); der Server entscheidet das.
  const todayCareDayEnded =
    date === today && (careDayEnded || careDayEndReported);
  const todayLocked =
    todayCareDayEnded || (date === today && (todayClosed || cutoffReported));
  // Gründe für gesperrte Knöpfe, in der Reihenfolge der Sperren (#6756).
  // Kurz und anders als die Hinweise im Dialog, die die Lage ausführen.
  // Ein Grund sperrt „Anfrage senden“, ohne Grund bleibt der Knopf frei.
  const alreadyHomeText = t("pickup.alreadyHomeBlocked");
  const cutoffClosedText = t("pickup.cutoffBlocked");
  const submitBlockedReason = alreadyHome
    ? alreadyHomeText
    : todayLocked
      ? cutoffClosedText
      : staffOwned
        ? t("pickup.staffSetBlocked")
        : !pickupChangeEnabled
          ? t("pickup.disabledBlocked")
          : !careExceptionsLoaded || !pickupChangeRequestsLoaded
            ? t("pickup.loadBlocked")
            : undefined;
  // Eine offene eigene Anfrage wird geändert, nicht zurückgezogen (#2267).
  const canEditRequest =
    pending && studentId !== undefined && request?.is_self !== false;
  const editedAt = useRequestEditedAt(
    studentId ?? "",
    "pickup_change",
    request?.id ?? "",
    canEditRequest === true,
  );
  // After a refusal the stored request is read again (`edit`).
  const reloadingEdit =
    edit.status === "refused" || edit.status === "reloading";
  const storedReadFailed = editing && edit.status === "loadFailed";

  // The pickup rules this dialog explains with its own context (the child's
  // name, the school's cutoff time). Every other failure goes through the
  // shared error path, which never shows the backend's sentence.
  const knownPickupError = (err: unknown): string | null => {
    if (err instanceof ApiError) {
      switch (err.code) {
        case "care.pickup_change_disabled":
          return t("pickup.errorDisabled");
        case "care.care_exception_conflict":
          return t(
            departureModeEnabled
              ? "pickup.errorStaffConflictGeneric"
              : "pickup.errorStaffConflict",
          );
        case "care.care_exception_already_left":
          return childFirstName
            ? t("pickup.alreadyHome", { name: childFirstName })
            : t("pickup.alreadyHomeGeneric");
        case "care.care_exception_past_date":
          return t("pickup.errorPastDate");
        case "care.care_exception_too_far":
          return t("pickup.errorTooFar");
        case "care.care_exception_no_time":
          return t("pickup.noTime");
        case "care.care_exception_reason_required":
          return t("pickup.reasonRequired");
        case "care.care_exception_reason_too_long":
          return t("pickup.reasonTooLong");
        case "care.care_request_already_pending":
          return t("pickup.statusPending");
        case "care.pickup_change_care_day_ended":
          setCareDayEndReported(true);
          onCutoffPassed?.();
          return t("pickup.careDayEnded");
        case "care.pickup_change_cutoff_passed":
          setCutoffReported(true);
          onCutoffPassed?.();
          return cutoffTime
            ? t("pickup.cutoffClosed", { time: cutoffTime })
            : t("pickup.cutoffClosedGeneric");
      }
    }
    return null;
  };

  const reportError = (
    target: typeof form,
    err: unknown,
    retry: () => void,
  ) => {
    const known = knownPickupError(err);
    if (known) {
      target.invalid(known);
      return;
    }
    // Wiederholen sendet die Angaben, die jetzt im Dialog stehen.
    void target.show(err, { object: t("pickup.errorObject"), retry });
  };

  // A new request starts from the day's saved values; empty days keep the
  // current fields. Refetches replace record objects even when their values
  // have not changed. An edit of an open request has its own draft.
  const prefillDate = request || existing ? date : "";
  const prefillTime = request?.pickup_time ?? existing?.pickup_time ?? "";
  const prefillMode =
    knownEnum(
      REQUESTABLE_DAY_DEPARTURE_MODES,
      request?.departure_mode ?? undefined,
    ) ?? "";
  const prefillReason = request?.reason ?? existing?.reason ?? "";
  const {
    pickupPersonId: prefillPersonId,
    pickupPersonName: prefillPersonName,
  } = requestPickupPerson(request);
  const prefillVersion = request?.version ?? "";
  useEffect(() => {
    if (editing) return;
    setCreated({
      pickupTime: prefillTime,
      departureMode: prefillMode,
      reason: prefillReason,
      pickupPersonId: prefillPersonId,
      pickupPersonName: prefillPersonName,
      signature: null,
    });
    clearForm();
    setInvalidField(null);
  }, [
    clearForm,
    editing,
    prefillDate,
    prefillTime,
    prefillMode,
    prefillReason,
    prefillPersonId,
    prefillPersonName,
    prefillVersion,
  ]);

  // The date remains part of the signed declaration while editing an existing
  // request, when prefill deliberately leaves the draft untouched.
  useEffect(() => {
    setCreated((current) => ({ ...current, signature: null }));
    setEditDraft((current) => ({ ...current, signature: null }));
  }, [date, setEditDraft]);

  // Fehlt die Unterschrift für eine Abholperson oder den Heimweg allein,
  // bleibt der Dialog offen und nennt das Feld (#4780).
  // „Andere Person“ ohne Namen bleibt offen und nennt das Feld (#8162).
  const otherPersonNameMissing = (): boolean => {
    if (!otherPerson || otherPersonName !== "") return false;
    form.invalid(tPermission("pickupPerson.otherNameMissing"), {
      [OTHER_PERSON_NAME_FIELD]: tPermission("pickupPerson.otherNameMissing"),
    });
    return true;
  };
  const signatureMissing = (): boolean => {
    if (!needsDaySignature || (dayStatement && signature)) return false;
    form.invalid(tPermission("signature.missing"), {
      [DAY_SIGNATURE_FIELD]: tPermission("signature.missing"),
    });
    return true;
  };
  // Eine Unterschrift gehört zur Erklärung, unabhängig davon, ob diese eine
  // Abholperson oder den Heimweg allein betrifft (#4780).
  const dayPickup = {
    ...(pickupPerson
      ? { pickupPersonGuardianProfileId: pickupPerson.guardian_profile_id }
      : {}),
    ...(otherPersonName !== "" ? { pickupPersonName: otherPersonName } : {}),
    ...(signature && dayStatement
      ? { signature, signatureStatement: dayStatement }
      : {}),
  };

  const handleSubmit = async () => {
    // Guard: if the existing overrides never loaded we can't trust the
    // prefilled fields, and a save would send the empty leg as an authoritative
    // clear. Block until the list is known (the page must be reloaded).
    if (!careExceptionsLoaded || !pickupChangeRequestsLoaded) {
      form.invalid(t("pickup.loadError"));
      return;
    }
    if (otherPersonNameMissing()) return;
    if (!pickupTime && !(modeField && departureMode) && !personNamed) {
      form.invalid(t(modeField ? "pickup.noTimeOrMode" : "pickup.noTime"));
      setInvalidField("pickupTime");
      pickupTimeRef.current?.focus();
      return;
    }
    if (reasonRequired && !reason.trim()) {
      form.invalid(
        t(modeField ? "pickup.reasonRequiredGeneric" : "pickup.reasonRequired"),
      );
      setInvalidField("reason");
      reasonRef.current?.focus();
      return;
    }
    if (signatureMissing()) return;
    setSubmitting(true);
    form.clear();
    setInvalidField(null);
    try {
      await onSubmit({
        date,
        pickupTime,
        ...(modeField ? { departureMode } : {}),
        reason: reason.trim(),
        recipientGuardianProfileIds: recipientIds,
        ...dayPickup,
      });
      onClose();
    } catch (err) {
      reportError(form, err, () => latestActionsRef.current.submit());
    } finally {
      setSubmitting(false);
    }
  };

  // Ändern einer noch offenen eigenen Anfrage. Die Empfänger bleiben, wie sie
  // beim Senden festgelegt wurden; sie werden über "Anfrage teilen" geändert.
  const handleSaveEdit = async () => {
    if (!studentId || !request || !edit.canSubmit) return;
    // An existing collector may only be retained after the current contact
    // list confirmed it. Omitting its ID would silently clear the collector.
    if (
      request.pickup_person_guardian_profile_id !== undefined &&
      !pickupPerson &&
      !otherPerson
    ) {
      form.invalid(t("pickup.loadError"));
      return;
    }
    if (otherPersonNameMissing()) return;
    if (!pickupTime && !(modeField && departureMode) && !personNamed) {
      form.invalid(t(modeField ? "pickup.noTimeOrMode" : "pickup.noTime"));
      setInvalidField("pickupTime");
      pickupTimeRef.current?.focus();
      return;
    }
    if (reasonRequired && !reason.trim()) {
      form.invalid(
        t(modeField ? "pickup.reasonRequiredGeneric" : "pickup.reasonRequired"),
      );
      setInvalidField("reason");
      reasonRef.current?.focus();
      return;
    }
    if (signatureMissing()) return;
    setSubmitting(true);
    form.clear();
    setInvalidField(null);
    const result = await edit.submit((expectedVersion, draft) =>
      updatePickupChangeRequest(studentId, request.id, {
        date,
        pickupTime: draft.pickupTime,
        ...(modeField ? { departureMode: draft.departureMode } : {}),
        reason: draft.reason.trim(),
        expectedVersion,
        ...dayPickup,
      }),
    );
    setSubmitting(false);
    if (result.ok) {
      // The list carries the version of the next edit: without its reload
      // a second edit would send the version this save just replaced.
      void invalidateFamily(parentKeys.pickupChangeRequestsFamily(studentId));
      void invalidateFamily(parentKeys.requestEventsFamily(studentId));
      onClose();
      return;
    }
    if (result.skipped) return;
    if (result.refused) {
      // Sending the same version again would be refused again: the message
      // waits for the stored request, which the dialog then shows. A failed
      // read says so and keeps saving locked until a read succeeds.
      void form.show(result.error, {
        object: t("pickup.errorObject"),
        reload: result.reload,
      });
      return;
    }
    reportError(form, result.error, () => latestActionsRef.current.saveEdit());
  };

  const handleRemove = async () => {
    setSubmitting(true);
    resetForm.clear();
    try {
      await onRemove(date);
      onClose();
    } catch (err) {
      reportError(resetForm, err, () => latestActionsRef.current.remove());
    } finally {
      setSubmitting(false);
    }
  };

  useLayoutEffect(() => {
    latestActionsRef.current = {
      submit: () => void handleSubmit(),
      saveEdit: () => void handleSaveEdit(),
      remove: () => void handleRemove(),
    };
  });

  if (confirmingReset) {
    return (
      <ConfirmDeleteModal
        isOpen
        title={t("pickup.resetTitle")}
        description={t("pickup.resetDescription", {
          date: formatLocaleDate(date, locale),
        })}
        gate={{ mode: "twoStep", firstStepLabel: t("pickup.resetFirstStep") }}
        confirmLabel={t("pickup.resetConfirm")}
        loadingLabel={t("pickup.resetLoading")}
        cancelLabel={t("cancel")}
        closeLabel={t("close")}
        backdropLabel={t("close")}
        mobileSheet
        loading={submitting}
        error={resetForm.error}
        onConfirm={() => void handleRemove()}
        onClose={() => {
          setConfirmingReset(false);
          resetForm.clear();
        }}
      />
    );
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t(departureModeEnabled ? "pickup.titleWithMode" : "pickup.title")}
      closeLabel={t("close")}
      mobileSheet
      footer={
        <>
          {!pending &&
            !todayLocked &&
            existing?.pickup_source === "guardian" && (
              <Button
                type="button"
                variant="ghost"
                size="md"
                className="w-full gap-2 whitespace-nowrap sm:w-auto"
                onClick={() => {
                  resetForm.clear();
                  setConfirmingReset(true);
                }}
                disabled={submitting || alreadyHome}
                tooltip={t("pickup.resetTooltip")}
                disabledReason={alreadyHome ? alreadyHomeText : undefined}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {t("pickup.reset")}
              </Button>
            )}
          <Button
            type="button"
            variant="outline"
            size="md"
            className="hidden whitespace-nowrap sm:inline-flex"
            noTooltip="Schließt den Dialog, ohne etwas zu senden."
            onClick={onClose}
          >
            {t("cancel")}
          </Button>
          {editing ? (
            <Button
              type="button"
              size="md"
              className="w-full whitespace-nowrap sm:w-auto"
              onClick={() => void handleSaveEdit()}
              disabled={submitting || todayLocked || storedReadFailed}
              tooltip={t("pickup.saveEditTooltip")}
              disabledReason={
                todayLocked
                  ? cutoffClosedText
                  : storedReadFailed
                    ? t("pickup.reloadFirst")
                    : undefined
              }
              // After a refusal the refused version would go out again
              // until the stored request has arrived.
              isLoading={submitting || reloadingEdit}
              loadingText={
                reloadingEdit
                  ? t("pickup.reloadingEdit")
                  : t("pickup.savingEdit")
              }
            >
              {t("pickup.saveEdit")}
            </Button>
          ) : pending ? null : (
            <Button
              type="button"
              size="md"
              className="w-full whitespace-nowrap sm:w-auto"
              onClick={() => void handleSubmit()}
              disabled={submitting || submitBlockedReason !== undefined}
              tooltip={t("pickup.submitTooltip")}
              disabledReason={submitBlockedReason}
              isLoading={submitting}
              loadingText={t("pickup.submitting")}
            >
              {t("pickup.submit")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-gray-700">
          {t(departureModeEnabled ? "pickup.introWithMode" : "pickup.intro")}
        </p>
        {(!careExceptionsLoaded || !pickupChangeRequestsLoaded) && (
          <InsetPanel as="p" framed className="text-sm text-gray-600">
            {t("pickup.loadError")}
          </InsetPanel>
        )}
        <ISODatePicker
          {...datePicker}
          id={`${errorId}-date`}
          label={t("pickup.dateLabel")}
          ariaLabel={t("pickup.dateLabel")}
          value={date}
          min={today}
          max={maxSelectable}
          onChange={setDate}
          calendarLayout="popover"
          hideClearButton
        />

        {/* Der Hinweis nennt eine noch offene Möglichkeit; nach der Frist
            würde er an einem anderen Tag falsch klingen. */}
        {date === today && cutoffTime && !todayLocked && (
          <p className="text-sm text-gray-600">
            {t("pickup.cutoffHint", { time: cutoffTime })}
          </p>
        )}
        {todayLocked && (
          <InsetPanel
            as="p"
            role="status"
            framed
            className="text-sm text-gray-600"
          >
            {todayCareDayEnded
              ? t("pickup.careDayEnded")
              : cutoffTime
                ? t("pickup.cutoffClosed", { time: cutoffTime })
                : t("pickup.cutoffClosedGeneric")}
          </InsetPanel>
        )}

        {pending && (
          <InsetPanel
            tone="warning"
            padding="compact"
            className="text-moto-orange-strong space-y-2"
          >
            {request.pickup_time && (
              <p className="text-base font-semibold tabular-nums">
                {request.previous_pickup_time
                  ? t("pickup.pendingChange", {
                      from: request.previous_pickup_time,
                      to: request.pickup_time,
                    })
                  : t("pickup.pendingRequested", {
                      to: request.pickup_time,
                    })}
              </p>
            )}
            {request.departure_mode && (
              <p className="text-base font-semibold">
                {request.previous_departure_modes?.length
                  ? `${request.previous_departure_modes
                      .map(modeLabel)
                      .join(" / ")} → ${modeLabel(request.departure_mode)}`
                  : t("pickup.pendingMode", {
                      to: modeLabel(request.departure_mode),
                    })}
              </p>
            )}
            {request.pickup_person && (
              <p className="text-base font-semibold">
                {tPermission("pickupPerson.label")} {request.pickup_person}
              </p>
            )}
            <p className="mt-0.5 text-sm">{t("pickup.statusPending")}</p>
            {editedAt && (
              <p className="text-sm">
                {t("pickup.editedAt", {
                  date: formatLocaleDate(editedAt.slice(0, 10), locale),
                })}
              </p>
            )}
            {canEditRequest && !editing && !todayLocked && (
              <Button
                type="button"
                variant="outline"
                size="md"
                tooltip={t("requestEditTooltip")}
                onClick={() => request && setEditingRequestId(request.id)}
              >
                {t("pickup.edit")}
              </Button>
            )}
            {studentId && request && (
              <RequestSharingControl
                studentId={studentId}
                requestType="pickup_change"
                requestId={request.id}
                isSelf={request.is_self === true}
              />
            )}
          </InsetPanel>
        )}
        {request?.status === "approved" && (
          <InsetPanel as="p" framed className="text-sm text-gray-600">
            {t(
              request.departure_mode
                ? "pickup.statusApprovedChange"
                : "pickup.statusApproved",
            )}
            {request.pickup_person
              ? ` ${tPermission("pickupPerson.label")} ${request.pickup_person}`
              : ""}
          </InsetPanel>
        )}
        {studentId && request?.signed && request.is_self !== false && (
          <PickupProofButton
            studentId={studentId}
            requestId={request.id}
            onError={(err) =>
              void form.show(err, { object: tPermission("errorObjectProof") })
            }
          />
        )}
        {request?.status === "rejected" && (
          <p className="bg-parent-red-soft text-parent-red-strong rounded-lg px-3 py-2 text-sm">
            {t("pickup.statusRejected", {
              reason: request.decision_reason ?? t("pickup.noDecisionReason"),
            })}
          </p>
        )}

        {(pending && !editing) || todayLocked ? null : alreadyHome &&
          childFirstName ? (
          <InsetPanel as="p" framed className="text-sm text-gray-600">
            {t("pickup.alreadyHome", { name: childFirstName })}
          </InsetPanel>
        ) : staffOwned ? (
          <InsetPanel as="p" framed className="text-sm text-gray-600">
            {t("pickup.staffSet", {
              pickup: existing?.pickup_time ?? "–",
            })}
          </InsetPanel>
        ) : (
          <div className="space-y-4">
            {modeField && (
              <CustomSelect
                label={t("pickup.modeLabel")}
                value={departureMode}
                options={[
                  { value: "", label: t("pickup.modeUnchanged") },
                  ...REQUESTABLE_DAY_DEPARTURE_MODES.map((mode) => ({
                    value: mode,
                    label: modeLabel(mode),
                  })),
                ]}
                onChange={(next) => {
                  setFields({
                    departureMode: next as DayDepartureMode | "",
                    signature: null,
                    ...(next !== "" && next !== "pickup"
                      ? { pickupPersonId: "" }
                      : {}),
                  });
                  if (invalidField === "pickupTime") {
                    setInvalidField(null);
                    form.clear();
                  }
                }}
              />
            )}
            {departureModeEnabled && staffMode && (
              <InsetPanel as="p" framed className="text-sm text-gray-600">
                {t("pickup.modeStaffSet", { mode: modeLabel(staffMode) })}
              </InsetPanel>
            )}
            {personField && (
              <CustomSelect
                label={tPermission("pickupPerson.label")}
                hint={tPermission("pickupPerson.hint")}
                value={pickupPersonId}
                options={[
                  { value: "", label: tPermission("pickupPerson.none") },
                  ...contacts.map((contact) => ({
                    value: contact.guardian_profile_id,
                    label: `${contact.first_name} ${contact.last_name}`.trim(),
                  })),
                  {
                    value: OTHER_PICKUP_PERSON,
                    label: tPermission("pickupPerson.other"),
                  },
                ]}
                onChange={(next) => {
                  setFields({ pickupPersonId: next, signature: null });
                  if (invalidField === "pickupTime") {
                    setInvalidField(null);
                    form.clear();
                  }
                }}
              />
            )}
            {otherPerson && (
              <Input
                id={OTHER_PERSON_NAME_FIELD}
                label={tPermission("pickupPerson.otherNameLabel")}
                hint={tPermission("pickupPerson.otherNameHint")}
                value={pickupPersonName}
                maxLength={PICKUP_PERSON_NAME_MAX}
                autoComplete="off"
                required
                error={form.fieldError(OTHER_PERSON_NAME_FIELD)}
                onChange={(e) => {
                  setFields({
                    pickupPersonName: e.target.value,
                    signature: null,
                  });
                }}
              />
            )}
            <TimeField
              inputRef={pickupTimeRef}
              value={pickupTime}
              onChange={(next) => {
                setFields({ pickupTime: next });
                if (invalidField === "pickupTime") {
                  setInvalidField(null);
                  form.clear();
                }
              }}
              label={t("pickup.pickupLabel")}
              hint={
                modeField || personNamed
                  ? `${t("pickup.pickupOptionalHint")} ${t("timeFormatHint")}`
                  : t("timeFormatHint")
              }
              timePickerLabels={{
                selectTime: tTimePicker("selectTime"),
                hour: tTimePicker("hour"),
                minute: tTimePicker("minute"),
                minimum: (time) => tTimePicker("minimum", { time }),
              }}
              placeholder={t("timeExample")}
              // Mit einer Abholperson darf die Uhrzeit gleich bleiben (#4780).
              required={!modeField && !personNamed}
              invalid={invalidField === "pickupTime"}
              describedBy={invalidField === "pickupTime" ? errorId : undefined}
            />
            <Textarea
              label={t("pickup.reasonLabel")}
              ref={reasonRef}
              value={reason}
              onChange={(e) => {
                setFields({ reason: e.target.value });
                if (invalidField === "reason") {
                  setInvalidField(null);
                  form.clear();
                }
              }}
              maxLength={255}
              required={reasonRequired}
              rows={3}
              placeholder={t("pickup.reasonPlaceholder")}
              aria-invalid={invalidField === "reason"}
              aria-describedby={invalidField === "reason" ? errorId : undefined}
              className="min-h-20 resize-y text-base"
            />
            {dayStatement && (
              <PickupSignatureField
                id={DAY_SIGNATURE_FIELD}
                statement={dayStatement}
                value={signature}
                onChange={(next) => {
                  setFields({ signature: next });
                  if (next) form.clear();
                }}
                disabled={submitting}
                error={form.fieldError(DAY_SIGNATURE_FIELD)}
              />
            )}
            <PickupSignatureStatementLoadError
              error={daySignatureStatement.error}
              retry={daySignatureStatement.retry}
            />
            {studentId && !editing && (
              <RequestSharingSelector
                studentId={studentId}
                selected={recipientIds}
                onChange={setRecipientIds}
              />
            )}
          </div>
        )}

        {existing?.pickup_source === "guardian" && !todayLocked && (
          <p className="text-sm text-gray-500">
            {t("pickup.existingHint", {
              date: formatLocaleDate(date, locale),
            })}
          </p>
        )}

        {!todayLocked && (
          <div id={errorId}>
            <FormErrorAlert message={form.error} />
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Lädt den Nachweis einer unterschriebenen Tagesanfrage als PDF (#4780).
 */
function PickupProofButton({
  studentId,
  requestId,
  onError,
}: Readonly<{
  studentId: string;
  requestId: string;
  /** Der Fehler steht im offenen Dialog, nicht in einem Toast darunter. */
  onError: (err: unknown) => void;
}>) {
  const tPermission = useCareTermTranslations("parentPickupPermission");
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="md"
      disabled={busy}
      tooltip={tPermission("proofPdfTooltip")}
      onClick={() => {
        setBusy(true);
        downloadPickupRequestProofPdf(studentId, requestId)
          .catch((err: unknown) => {
            logger.error("pickup_proof_download_failed", {
              error: err instanceof Error ? err.message : String(err),
            });
            onError(err);
          })
          .finally(() => setBusy(false));
      }}
    >
      {tPermission("proofPdf")}
    </Button>
  );
}

// --- read-only lists for the page body ---

export function SickStatusSummary({
  studentId,
  sickDays,
  excusedRequests = EMPTY_EXCUSED_REQUESTS,
  canEdit = false,
  reasonRequired = true,
  onEdited,
}: Readonly<{
  studentId?: string;
  sickDays: parentMeContract.StatusDayResponse[];
  // Absence requests behind an OGS approval gate. Pending ones show as
  // "Freigabe ausstehend" and can still be changed by their author; rejected
  // ones show the decision reason. Confirmed (approved) requests arrive as
  // StatusDays instead.
  excusedRequests?: readonly parentMeContract.ParentExcusedRequestResponse[];
  /** Ob die Person Abwesenheiten melden darf und eigene offene Anfragen damit
   * ändern kann (features.absence_request_edit_enabled, #4603). */
  canEdit?: boolean;
  /** Ob die OGS einen Grund verlangt (requiresGuardianReason). */
  reasonRequired?: boolean;
  /**
   * Nach einer geänderten oder abgelehnten Anfrage: die Liste neu laden.
   * Lehnt ab, wenn das Lesen scheitert (ADR 0311).
   */
  onEdited?: () => Promise<unknown>;
}>) {
  const t = useCareTermTranslations("parentChildCare");
  const locale = useLocale();
  // The edit follows the row of the current list, so a reload after a
  // refused save hands the dialog the stored version (ADR 0311).
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing =
    excusedRequests.find((request) => request.id === editingId) ?? null;

  // Collapse to a "first – last" range ONLY when the days are actually
  // contiguous; otherwise list them comma-separated. The request endpoint accepts
  // an arbitrary date list, so a Mon+Wed request must never render as "Mon – Wed"
  // (which would wrongly imply Tuesday is included), matching the staff list
  // (#1845 review).
  const rangeLabel = (dates: readonly string[]): string => {
    const sorted = [...dates].sort((a, b) => a.localeCompare(b));
    if (sorted.length === 0) return "";
    if (sorted.length === 1) return formatLocaleDate(sorted[0]!, locale);
    const contiguous = sorted.every(
      (d, i) => i === 0 || isNextDayISO(sorted[i - 1]!, d),
    );
    if (contiguous) {
      return `${formatLocaleDate(sorted[0]!, locale)} – ${formatLocaleDate(sorted.at(-1)!, locale)}`;
    }
    return sorted.map((d) => formatLocaleDate(d, locale)).join(", ");
  };

  const sickDates = sickDays
    .filter((d) => d.status === "sick")
    .map((d) => d.date);
  const excusedConfirmedDates = sickDays
    .filter((d) => d.status === "excused")
    .map((d) => d.date);
  const pending = excusedRequests.filter((r) => r.status === "pending");
  const rejected = excusedRequests.filter((r) => r.status === "rejected");
  const requestLabel = (
    request: parentMeContract.ParentExcusedRequestResponse,
  ) =>
    request.absence_status === "sick"
      ? t("summary.sickLabel")
      : t("summary.excusedLabel");
  // Approved requests normally surface as status days above, but the
  // status-day fetch is windowed (today..+2 months, matching the backend's
  // listSickDays range). An approval for a past date (delayed decision) or one
  // more than two months ahead has NO status day here, so it would silently
  // vanish once it left the pending list — surface those from the approved
  // request instead.
  //
  // Critically, only surface dates that are genuinely OUTSIDE the fetched window.
  // A within-window date with no matching status day was NOT dropped for being
  // out of range — it was superseded or cleared. Inside the window the status
  // days are authoritative; approved requests only fill gaps outside it.
  const windowStart = berlinTodayISO();
  const windowEnd = (() => {
    const d = parseISODate(windowStart);
    d.setMonth(d.getMonth() + 2);
    return toISODate(d);
  })();
  const shownDatesByStatus = {
    sick: new Set(sickDates),
    excused: new Set(excusedConfirmedDates),
  };
  const isOutOfWindow = (d: string) => d < windowStart || d > windowEnd;
  const approvedOutOfWindow = excusedRequests
    .filter((r) => r.status === "approved")
    .map((r) => ({
      id: r.id,
      label: requestLabel(r),
      dates: (r.dates ?? []).filter(
        (d) =>
          isOutOfWindow(d) &&
          !(
            r.absence_status === "sick"
              ? shownDatesByStatus.sick
              : shownDatesByStatus.excused
          ).has(d),
      ),
    }))
    .filter((r) => r.dates.length > 0);

  const hasAny =
    sickDates.length > 0 ||
    excusedConfirmedDates.length > 0 ||
    approvedOutOfWindow.length > 0 ||
    pending.length > 0 ||
    rejected.length > 0;
  if (!hasAny) {
    return <span className="text-sm text-gray-600">{t("summary.none")}</span>;
  }

  return (
    <div className="space-y-1.5">
      {sickDates.length > 0 && (
        <p className="text-sm font-semibold text-gray-900">
          {t("summary.sickLabel")}: {rangeLabel(sickDates)}
        </p>
      )}
      {excusedConfirmedDates.length > 0 && (
        <p className="text-sm font-semibold text-gray-900">
          {t("summary.excusedLabel")}: {rangeLabel(excusedConfirmedDates)}
        </p>
      )}
      {approvedOutOfWindow.map((r) => (
        <p key={r.id} className="text-sm font-semibold text-gray-900">
          {r.label}: {rangeLabel(r.dates)}
        </p>
      ))}
      {pending.map((r) => (
        <div key={r.id} className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-semibold text-gray-900">
              {requestLabel(r)}: {rangeLabel(r.dates ?? [])}
            </p>
            <StatusColorBadge
              color={LOCATION_COLORS.WARNING}
              compact
              label={t("summary.pendingLabel")}
            />
            {studentId && canEdit && r.is_self && (
              <Button
                type="button"
                variant="outline"
                size="md"
                tooltip={t("requestEditTooltip")}
                onClick={() => setEditingId(r.id)}
              >
                {t("summary.edit")}
              </Button>
            )}
          </div>
          {studentId && (
            <RequestSharingControl
              studentId={studentId}
              requestType="excused"
              requestId={r.id}
              isSelf={r.is_self}
            />
          )}
        </div>
      ))}
      {rejected.map((r) => (
        <div key={r.id} className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-x-2">
            <p className="text-sm font-semibold text-gray-900">
              {requestLabel(r)}: {rangeLabel(r.dates ?? [])}
            </p>
            <StatusBadge
              tone="red"
              compact
              label={t("summary.rejectedLabel")}
            />
          </div>
          {r.decision_reason && (
            <p className="text-xs text-gray-500">
              {t("summary.reasonPrefix")}: {r.decision_reason}
            </p>
          )}
          {studentId && (
            <RequestSharingControl
              studentId={studentId}
              requestType="excused"
              requestId={r.id}
              isSelf={r.is_self}
            />
          )}
        </div>
      ))}
      {studentId && editing && (
        <RequestEditModal
          studentId={studentId}
          reasonRequired={reasonRequired}
          request={{
            type: "excused",
            id: editing.id,
            version: editing.version,
            dates: [...(editing.dates ?? [])],
            note: editing.note,
          }}
          onClose={() => setEditingId(null)}
          onReload={() => onEdited?.() ?? Promise.resolve()}
        />
      )}
    </div>
  );
}

// --- OGS quick actions (parent self-service) -------------------------------
//
// The care-schedule change request FORM now lives in ./care-schedule-request-
// modal and is owned entirely by the Stammdaten page (#1803) — it is no longer
// reachable from the chat. Only the sick-note and one-day pickup-change actions
// remain here as quick-action pills above the composer.

export type OgsActionKey = "sick" | "pickup";

// A single parent self-service action available from the OGS chat. Whether it
// takes effect immediately or needs OGS confirmation depends on the action and
// the school's settings.
export interface OgsAction {
  readonly key: OgsActionKey;
  readonly concept: MotoConcept;
  readonly enabled: boolean;
}

// The SINGLE source of truth for the actions a parent can take from the OGS
// chat. Consumed by the always-visible quick-action chips above the composer
// (OgsConversation) — keep it here so the chips and any future menu can never
// drift apart. The actions are gated on the school's feature flags. Display
// strings (label / shortLabel / hint) are NOT carried here — this function is
// not a hook, so consumers localize each key via
// t(`actions.${key}.{label,shortLabel,hint}`) in the "parentChildCare"
// namespace (mirrors the child-detail action pattern).
export function getOgsActions(
  features: parentMeContract.ChildFeaturesResponse,
): OgsAction[] {
  return [
    {
      key: "sick",
      concept: sickConcept,
      enabled:
        features.sick_note_enabled ||
        (features.excused_note_enabled ?? features.sick_note_enabled),
    },
    {
      key: "pickup",
      concept: pickupConcept,
      enabled: features.pickup_change_enabled,
    },
  ];
}
