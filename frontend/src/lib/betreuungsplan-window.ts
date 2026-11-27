/**
 * What the Betreuungsplan loads for its URL (#8077): view, Berlin school day,
 * filters and the fetch windows of the grid and the gap check. The view and
 * the server seed both derive their keys here, so a server value reaches the
 * reader only under the key the reader asks for.
 */

import {
  careWeekDayCount,
  isValidISODate,
  parseISODate,
} from "~/lib/date-helpers";
import { parsePlanFilterId, type PlanFilter } from "~/lib/plan-filter";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import {
  careDayISO,
  getMonthRange,
  getWeekRange,
  getWeekdays,
  toISODate,
  type TimetableView,
} from "~/lib/timetable-helpers";

/** The URL parameters the window depends on. */
export interface PlanWindowParams {
  readonly d: string | null;
  readonly view: string | null;
  readonly group: string | null;
  readonly staff: string | null;
  readonly room: string | null;
}

export interface PlanWindowInput {
  readonly params: PlanWindowParams;
  /** The Berlin calendar day. */
  readonly todayISO: string;
  /** The school cares on weekends by the Friday plan (#3921). */
  readonly weekendOpen: boolean;
  /** schedules:manage: month and series view, gap check. */
  readonly canManageSchedules: boolean;
  /** groups:read: the group filter. */
  readonly canFilterByGroup: boolean;
  /** rooms:read: the room filter. */
  readonly canFilterByRoom: boolean;
}

export interface PlanWindow {
  /** `d` when valid, else today. */
  readonly requestedDayISO: string;
  readonly view: TimetableView;
  /** The anchor day: weekend days snap to Monday in week and day view. */
  readonly dayISO: string;
  /** Today's care day (a weekend day snaps to Monday). */
  readonly todayTargetISO: string;
  readonly groupFilterId: string | null;
  readonly staffFilterId: string | null;
  readonly roomFilterId: string | null;
  readonly fetchFromISO: string;
  readonly fetchToISO: string;
  /** Gaps are forward-looking: the window starts at the care day of today. */
  readonly gapsFromISO: string;
  readonly shouldLoadInstances: boolean;
  /** Only planners load gaps, only in the week view, only for a coming week. */
  readonly shouldLoadGaps: boolean;
}

/**
 * The `view` URL value as the internal view. Invalid values fall back to the
 * week; the year view is not linkable.
 */
function parsePlanViewParam(raw: string | null): TimetableView {
  if (raw === "tag") return "day";
  if (raw === "monat") return "month";
  if (raw === "serien") return "series";
  return "week";
}

export function resolvePlanWindow(input: PlanWindowInput): PlanWindow {
  const { params, todayISO, weekendOpen } = input;
  const rawDay = params.d;
  const requestedDayISO =
    rawDay !== null && isValidISODate(rawDay) ? rawDay : todayISO;
  // Read view (#2283, #2621): without schedules:manage only day and week;
  // a month or series deep link falls back to the week.
  const requestedView = parsePlanViewParam(params.view);
  const view: TimetableView =
    input.canManageSchedules || requestedView === "day"
      ? requestedView
      : "week";
  // Month and series keep the requested calendar date; only the workweek
  // and the single school day snap weekend anchors to Monday.
  const dayISO =
    view === "week" || view === "day"
      ? careDayISO(requestedDayISO, weekendOpen, todayISO)
      : requestedDayISO;
  const todayTargetISO = careDayISO(todayISO, weekendOpen, todayISO);

  const visibleDate = parseISODate(dayISO);
  const weekFrom = getWeekRange(visibleDate, 0).from;
  const fromISO = toISODate(weekFrom);
  // Mo–Fr, plus the weekend when the school cares by the Friday plan and the
  // week holds today's Saturday or Sunday (#3921, #5028).
  const weekDays = getWeekdays(weekFrom).slice(
    0,
    careWeekDayCount(fromISO, weekendOpen, todayISO),
  );
  const workweekToISO = toISODate(weekDays[weekDays.length - 1]!);
  const monthRange = getMonthRange(visibleDate);
  // The day view loads exactly its day.
  const fetchFromISO =
    view === "month"
      ? toISODate(monthRange.from)
      : view === "day"
        ? dayISO
        : fromISO;
  const fetchToISO =
    view === "month"
      ? toISODate(monthRange.to)
      : view === "day"
        ? dayISO
        : workweekToISO;

  return {
    requestedDayISO,
    view,
    dayISO,
    todayTargetISO,
    // Without the group or room list there is no choice, hence no invisible
    // filter from a shared link either (#4766, #4768).
    groupFilterId: input.canFilterByGroup
      ? parsePlanFilterId(params.group)
      : null,
    staffFilterId: parsePlanFilterId(params.staff),
    roomFilterId: input.canFilterByRoom ? parsePlanFilterId(params.room) : null,
    fetchFromISO,
    fetchToISO,
    // GET /gaps rejects a past `date` and caps the window at 14 days: start
    // at today's care day, and only the week view loads gaps (the month
    // window would be refused, an empty count there would be wrong).
    gapsFromISO: fetchFromISO < todayTargetISO ? todayTargetISO : fetchFromISO,
    shouldLoadInstances: view !== "series",
    shouldLoadGaps:
      input.canManageSchedules &&
      view === "week" &&
      fetchToISO >= todayTargetISO,
  };
}

/** The grid key (slim answer) of a window and its filter. */
export function planInstancesKey(
  window: PlanWindow,
  filter: PlanFilter,
): string {
  return tenantDailyKeys.planInstances(
    window.view,
    window.fetchFromISO,
    window.fetchToISO,
    filter,
  );
}

/** The gap check key of a window. */
export function planGapsKey(window: PlanWindow): string {
  return tenantDailyKeys.planGaps(window.gapsFromISO, window.fetchToISO);
}

/** The filter of a window. */
export function planWindowFilter(window: PlanWindow): PlanFilter {
  return {
    groupId: window.groupFilterId,
    staffId: window.staffFilterId,
    roomId: window.roomFilterId,
  };
}
