// Tenant-wide time-tracking views for the /staff dashboard
// (#1417 Tranche 2a). Two endpoints with deliberately different permissions:
//
//   /api/staff/dashboard-summary        users:read           aggregated KPIs
//   /api/staff/time-tracking/overview   time_tracking:manage per-person rows
//
// Callers must gate the second one on the permission (see hasPermission in
// ~/lib/auth-utils); it is not a fallback path but a different audience.

import { bffJson } from "./bff-fetch";
import type {
  DashboardSummary as DashboardSummaryWire,
  TimeTrackingOverviewRow,
} from "./contract/staff.generated";

// ─── Frontend shapes (camelCase, string ids) ─────────────────────────────────

export type DashboardPeriod = "week" | "month";

export interface DashboardSummary {
  activeStaffCount: number;
  sickToday: number;
  vacationToday: number;
  currentlyClockedIn: number;
  expectedClockedIn: number;
  sollMinutes: number;
  istMinutes: number;
  /**
   * NOT ist − soll. It is the sum of the per-staff month balances
   * (Ist + Gutschriften + Buchungen − Soll bis heute): sick and vacation days
   * are credited with the day's target, which is the whole premise of the
   * Stundenkonto. Any label must say so, or the school leadership reads a
   * different number than the Monatskarte shows.
   */
  deltaMinutes: number;
  /**
   * Account balance, not a period quantity — identical for week and month.
   * Never render it inside the period row.
   */
  saldoSchoolTotalMinutes: number;
  pendingRequestsCount: number;
}

export interface TimeAccountRow {
  staffId: string;
  firstName: string;
  lastName: string;
  name: string;
  employmentType: string;
  sollMinutes: number;
  /** False when no Soll is maintained for the month (#6887). */
  hasTarget: boolean;
  istMinutes: number;
  balanceMinutes: number;
  remainingVacationDays: number;
  /** Tage im Monat mit Hinweis zu Pause oder Tageslimit (#4804). */
  laborHintDays: number;
}

export interface TimeAccountOverview {
  year: number;
  month: number;
  rows: TimeAccountRow[];
}

export function mapDashboardSummary(
  data: DashboardSummaryWire,
): DashboardSummary {
  return {
    activeStaffCount: data.active_staff_count,
    sickToday: data.sick_today,
    vacationToday: data.vacation_today,
    currentlyClockedIn: data.currently_clocked_in,
    expectedClockedIn: data.expected_clocked_in,
    sollMinutes: data.period.soll_minutes,
    istMinutes: data.period.ist_minutes,
    deltaMinutes: data.period.delta_minutes,
    saldoSchoolTotalMinutes: data.saldo_school_total_minutes,
    pendingRequestsCount: data.pending_requests_count,
  };
}

export function mapTimeAccountRow(
  data: TimeTrackingOverviewRow,
): TimeAccountRow {
  return {
    staffId: data.staff_id,
    firstName: data.first_name,
    lastName: data.last_name,
    name: data.name,
    employmentType: data.employment_type,
    sollMinutes: data.soll_minutes,
    hasTarget: data.has_target,
    istMinutes: data.ist_minutes,
    balanceMinutes: data.balance_minutes,
    remainingVacationDays: data.remaining_vacation_days,
    laborHintDays: data.labor_hint_days,
  };
}

// ─── Fetchers ────────────────────────────────────────────────────────────────

export interface TimeAccountQuery {
  /** Both or neither — a bare month is rejected by the backend. */
  year?: number;
  month?: number;
  employmentType?: string;
  /** Inclusive bounds in minutes; negative values are normal. */
  saldoMin?: number;
  saldoMax?: number;
}

export const staffOverviewService = {
  async getDashboardSummary(
    period: DashboardPeriod,
  ): Promise<DashboardSummary> {
    return mapDashboardSummary(
      await bffJson("tenant", "GET /api/staff/dashboard-summary", {
        query: { period },
        errorMessage: "Einrichtungs-Übersicht konnte nicht geladen werden",
      }),
    );
  },

  /**
   * Requires time_tracking:manage. Sorting is deliberately NOT requested from
   * the backend: the table sorts client-side, so clicking a column header
   * costs no round trip. The server-side `sort`/`order` parameters stay
   * available for future paginated callers.
   */
  async getTimeAccounts(
    query: TimeAccountQuery = {},
  ): Promise<TimeAccountOverview> {
    const hasYear = query.year !== undefined;
    const hasMonth = query.month !== undefined;
    if (hasYear !== hasMonth) {
      throw new Error("Jahr und Monat müssen gemeinsam angegeben werden");
    }

    const data = await bffJson(
      "tenant",
      "GET /api/staff/time-tracking/overview",
      {
        query: {
          year: query.year,
          month: query.month,
          employment_type: query.employmentType || undefined,
          saldo_min: query.saldoMin,
          saldo_max: query.saldoMax,
        },
        errorMessage: "Zeitkonten konnten nicht geladen werden",
      },
    );
    return {
      year: data.year,
      month: data.month,
      rows: (data.rows ?? []).map(mapTimeAccountRow),
    };
  },
};
