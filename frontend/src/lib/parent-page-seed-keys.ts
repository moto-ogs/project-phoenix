import type { ChildResponse } from "~/lib/contract/parent-me.generated";
import {
  mondayISOFromOffset,
  weekOffsetFromParam,
} from "~/lib/parent-meal-plan-window";
import { parentInboxKeys } from "~/lib/swr/parent-inbox-keys";
import { parentKeys } from "~/lib/swr/parent-keys";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";

export const PARENT_START_CALENDAR_DAYS = 90;
export const PARENT_CALENDAR_DAYS = 91;

export type ParentSeedPage =
  | { kind: "start" | "children" | "calendar" | "enrollment" }
  | { kind: "holiday" | "messages" | "groupThread" | "news" }
  | { kind: "child" | "conference" | "conversation"; studentId: string }
  | { kind: "proof"; announcementId: string; studentId: string }
  | { kind: "meal"; week?: string; school?: string }
  | { kind: "settings"; section: "notifications" | "signIn" };

export const parentShellSeedKeys = [
  parentKeys.shellChildren(),
  parentKeys.profile(),
  parentKeys.messagesUnreadCount(),
  parentKeys.newsUnreadCount(),
  parentKeys.notificationFeed.unreadCount(),
] as const;

export function parentPageUsesChildren(page: ParentSeedPage): boolean {
  return [
    "start",
    "children",
    "child",
    "conference",
    "meal",
    "messages",
    "conversation",
    "groupThread",
    "proof",
  ].includes(page.kind);
}

export function parentPageSeedKeys(
  page: ParentSeedPage,
  day: string,
): readonly string[] {
  switch (page.kind) {
    case "start":
      return [
        parentKeys.holidayOffers(),
        parentKeys.holidayRegistrationEntries(),
        parentKeys.announcements(),
        parentKeys.messages(),
        parentKeys.calendar(day, PARENT_START_CALENDAR_DAYS),
      ];
    case "calendar":
      return [parentKeys.calendar(day, PARENT_CALENDAR_DAYS)];
    case "enrollment":
      return [parentInboxKeys.enrollableSchools()];
    case "holiday":
      return [parentKeys.holidayRegistrationEntries()];
    case "messages":
      return [parentKeys.messages(), parentKeys.groupThreads()];
    case "news":
      return [parentKeys.announcements()];
    case "conversation":
      // The side-effecting conversation opens immediately. Only its display
      // keys with known parameters wait for the pending server answer.
      return [
        parentInboxKeys.childThreads(page.studentId),
        ...Object.values(parentChildCareKeys(page.studentId, day)),
      ];
    case "settings":
      return page.section === "notifications"
        ? [tenantAdminKeys.notificationPreferences("parent")]
        : [
            tenantAdminKeys.emailCodeFactor(),
            tenantAdminKeys.trustedDevices("parent"),
          ];
    default:
      return [];
  }
}

/** The selector route opens the actual profile only for a single child. */
export function initialParentChild(
  children: readonly ChildResponse[],
  studentId?: string,
): ChildResponse | undefined {
  return studentId === undefined
    ? children.length === 1
      ? children[0]
      : undefined
    : children.find((child) => child.student_id === studentId);
}

export function parentInitialMealMonday(day: string, week?: string): string {
  return mondayISOFromOffset(day, weekOffsetFromParam(day, week));
}

export function parentChildCareKeys(studentId: string, day: string) {
  return {
    sick: parentKeys.sickDays(studentId, day),
    excused: parentKeys.excusedRequests(studentId, day),
    exceptions: parentKeys.careExceptions(studentId, day),
    pickup: parentKeys.pickupChangeRequests(studentId, day),
    schedule: parentKeys.careSchedule(studentId, day),
  };
}

/** Claim dependent keys on soft navigation, when the child list is warm. */
export function parentPageChildSeedKeys(
  page: ParentSeedPage,
  day: string,
  children: readonly ChildResponse[],
): readonly string[] {
  if (page.kind === "meal") {
    const monday = parentInitialMealMonday(day, page.week);
    // The features read decides which of these is eligible. Only the key
    // actually requested by the view waits for its value; no read fans out.
    return children.map((child) =>
      parentInboxKeys.mealPlan(child.student_id, monday),
    );
  }
  if (page.kind === "messages") {
    const withCarePlace = children.filter(
      (child) => child.without_care_place !== true,
    );
    const child = withCarePlace.length === 1 ? withCarePlace[0] : undefined;
    if (!child) return [];
    const id = child.student_id;
    return [
      parentKeys.features(withCarePlace, day),
      parentKeys.today(children, day),
      parentInboxKeys.childThreads(id),
      ...Object.values(parentChildCareKeys(id, day)),
    ];
  }
  if (!("studentId" in page) && page.kind !== "children") return [];
  const child = initialParentChild(
    children,
    "studentId" in page ? page.studentId : undefined,
  );
  if (!child) return [];

  const id = child.student_id;
  if (page.kind === "conference") return [parentKeys.conferences(id)];
  if (page.kind === "proof")
    return [parentInboxKeys.declarationProof(page.announcementId, id)];
  if (page.kind === "conversation") return [];

  const { sick, excused, exceptions, pickup, schedule } = parentChildCareKeys(
    id,
    day,
  );
  const common = [sick, excused, parentKeys.conferences(id)];
  return child.without_care_place === true
    ? common
    : [
        ...common,
        exceptions,
        pickup,
        schedule,
        parentKeys.careOfferings(id),
        parentKeys.courses(id),
      ];
}
