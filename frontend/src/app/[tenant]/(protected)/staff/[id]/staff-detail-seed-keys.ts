import type { AbsenceType } from "~/lib/absence-type-api";
import { parseISODate } from "~/lib/date-helpers";
import {
  fourWeekStaffPreview,
  staffAccountWindow,
  staffWeek,
} from "~/lib/staff-detail-windows";
import { timeTrackingKeys } from "~/lib/swr/portal-keys";
import {
  staffAbsenceKeys,
  staffAccessKeys,
  staffKeys,
  staffMonthSummaryKeys,
  staffQualificationKeys,
  staffTimeKeys,
} from "~/lib/swr/staff-keys";
import {
  initialStaffTab,
  initialStaffTrackingDate,
  type staffDetailAccess,
} from "./staff-detail-tabs";

export interface StaffDetailOpening {
  readonly id: string;
  readonly today: string;
  readonly requestedTab: string | null;
  readonly requestedDate: string | null;
}

export function staffOverviewReads(
  id: string,
  today: string,
  accountStartDate: string,
) {
  const { from, to, historyFrom, adjustmentTo } = staffAccountWindow(
    parseISODate(today),
    accountStartDate,
  );
  return {
    from,
    to,
    historyFrom,
    adjustmentTo,
    history: staffTimeKeys.historyAccount(id, historyFrom, to),
    absences: staffAbsenceKeys.accountList(id, from, to),
    adjustments: staffTimeKeys.balanceAdjustments(id, from, adjustmentTo),
    targets: staffTimeKeys.scheduleTargetsAccount(id, from, to),
  };
}

export function staffAllowanceTypes(types: readonly AbsenceType[]) {
  return types.filter((type) => type.allowanceEnabled);
}

export function staffAllowancesKey(
  id: string,
  year: number,
  types: readonly AbsenceType[],
) {
  return staffAbsenceKeys.allowances(
    id,
    year,
    types.map((type) => type.id),
  );
}

export function staffTabOpening(
  opening: StaffDetailOpening,
  access: ReturnType<typeof staffDetailAccess>,
) {
  const { id, requestedTab, requestedDate, today } = opening;
  const tab = initialStaffTab(access.tabs, requestedTab);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const monthKey = staffMonthSummaryKeys.month(id, year, month);
  const configKey = timeTrackingKeys.config();
  switch (tab) {
    case "uebersicht":
      return {
        tab,
        year,
        month,
        configKey,
        monthKey,
        claims: [configKey, monthKey],
      };
    case "zeiterfassung": {
      const current = staffWeek(today);
      const visible = staffWeek(
        initialStaffTrackingDate(requestedTab, requestedDate) ?? today,
      );
      const keys = {
        schedule: staffTimeKeys.schedule(id),
        config: configKey,
        month: monthKey,
        history: staffTimeKeys.history(id, visible.historyFrom, visible.to),
        absences: staffAbsenceKeys.list(id, visible.from, visible.to),
        shifts: staffTimeKeys.shiftsVisible(id, visible.from, visible.to),
        holidays: timeTrackingKeys.holidays(visible.from, visible.to),
        closingDays: timeTrackingKeys.closingDays(visible.from, visible.to),
        targets: staffTimeKeys.scheduleTargets(id, visible.from, visible.to),
        currentTargets: staffTimeKeys.scheduleTargets(
          id,
          current.from,
          current.to,
        ),
      };
      return {
        tab,
        year,
        month,
        visible,
        current,
        keys,
        claims: Object.values(keys),
      };
    }
    case "arbeitszeitmodell": {
      const preview = fourWeekStaffPreview(parseISODate(today));
      const keys = {
        schedule: staffTimeKeys.schedule(id),
        month: monthKey,
        overrides: staffTimeKeys.targetOverrides(id),
        preview: staffTimeKeys.scheduleTargetsPreview(
          id,
          preview.from,
          preview.to,
        ),
      };
      return { tab, year, month, preview, keys, claims: Object.values(keys) };
    }
    case "abwesenheiten": {
      const range = { from: `${year}-01-01`, to: `${year}-12-31` };
      const keys = {
        quota: staffAbsenceKeys.vacationQuota(id, year),
        absences: staffAbsenceKeys.list(id, range.from, range.to),
        types: staffAbsenceKeys.types(),
      };
      return { tab, year, range, keys, claims: Object.values(keys) };
    }
    case "stammdaten": {
      const keys = {
        payroll: access.manageTimeTracking ? staffKeys.payrollNumber(id) : null,
        proofs: access.viewSections ? staffQualificationKeys.traeger(id) : null,
      };
      return { tab, keys, claims: Object.values(keys) };
    }
    case "klassen": {
      const key = staffAccessKeys.schoolClasses(id);
      return { tab, key, claims: [key] };
    }
    case "dokumente":
    case "konto":
      return { tab, claims: [] };
  }
}
