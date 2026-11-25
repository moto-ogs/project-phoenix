import type { Session } from "next-auth";
import { hasEffectiveAdminScope, hasPermission } from "~/lib/auth-utils";
import { isValidISODate } from "~/lib/date-helpers";
import { isScopeBooked, STAFF_TAB_MODULES } from "~/lib/module-register";
import type { ModuleKey } from "~/lib/modules";

export function staffDetailAccess(
  session: Session | null,
  bookedModules: readonly ModuleKey[],
) {
  const admin = hasEffectiveAdminScope(session);
  const manageTimeTracking = hasPermission(session, "time_tracking:manage");
  const viewTimeTracking = admin || manageTimeTracking;
  const editStammdaten = hasPermission(session, "staff:stammdaten");
  const viewSections = viewTimeTracking || editStammdaten;
  const financial = hasPermission(session, "staff:financial");
  const documents =
    admin ||
    financial ||
    hasPermission(session, "staff:documents") ||
    hasPermission(session, "staff_documents:health");
  const manageAbsences =
    viewTimeTracking || hasPermission(session, "vacation:approve");
  const viewClasses = admin || hasPermission(session, "users:read");
  const viewRecord =
    viewSections || viewClasses || hasPermission(session, "staff:manage");
  const limitedProfile =
    financial && !viewSections
      ? "financial"
      : documents && !viewSections
        ? "document"
        : null;
  const booked = (tab: string) =>
    isScopeBooked(STAFF_TAB_MODULES[tab], bookedModules);

  return {
    admin,
    documents,
    editStammdaten,
    financial,
    limitedProfile,
    manageAbsences,
    manageTimeTracking,
    viewRecord,
    viewSections,
    viewTimeTracking,
    tabs: {
      uebersicht: viewTimeTracking && booked("uebersicht"),
      zeiterfassung: viewTimeTracking && booked("zeiterfassung"),
      arbeitszeitmodell: admin && booked("arbeitszeitmodell"),
      abwesenheiten: manageAbsences && booked("abwesenheiten"),
      stammdaten: (viewSections || financial) && booked("stammdaten"),
      dokumente: documents && booked("dokumente"),
      klassen: viewClasses,
      konto: viewRecord,
    },
  } as const;
}

type StaffTabs = ReturnType<typeof staffDetailAccess>["tabs"];
type StaffTab = keyof StaffTabs;

export function isVisibleStaffTab(
  tabs: StaffTabs,
  tab: string | null,
): tab is StaffTab {
  return tab !== null && Object.hasOwn(tabs, tab) && tabs[tab as StaffTab];
}

export function initialStaffTab(
  tabs: StaffTabs,
  requested: string | null,
): StaffTab {
  if (isVisibleStaffTab(tabs, requested)) return requested;
  if (tabs.uebersicht) return "uebersicht";
  if (tabs.stammdaten) return "stammdaten";
  if (tabs.dokumente) return "dokumente";
  if (tabs.konto) return "konto";
  return tabs.abwesenheiten ? "abwesenheiten" : "konto";
}

export function initialStaffTrackingDate(
  tab: string | null,
  date: string | null,
): string | undefined {
  return tab === "zeiterfassung" && date !== null && isValidISODate(date)
    ? date
    : undefined;
}
