import type { ApiError } from "~/lib/api-error";
import type * as contract from "~/lib/contract/parent-me.generated";
import { isValidISODate } from "~/lib/date-helpers";

export const UNKNOWN_CHILD_TODAY: contract.TodayStatusResponse = {
  at_ogs: null,
  state: "unknown",
};

export interface ParentFamily {
  day: string;
  needsDayReconciliation: boolean;
  dayExpiry: { at: number; remainingMs: number };
  children: contract.ChildResponse[];
  features: Record<string, contract.ChildFeaturesResponse>;
  today: Record<string, contract.TodayStatusResponse>;
  featureErrors: Record<string, FamilyFieldFailure>;
  todayErrors: Record<string, FamilyFieldFailure>;
  // Browser-only deadlines for failed targeted reads, including newly signalled IDs.
  retryNotBefore: Record<string, number>;
  confirmedToday: Record<string, boolean>;
  accessVersions: Record<string, string>;
}

// This marker can cross the Server Component boundary. Transport errors on
// a later browser refresh keep their full ApiError.
export const FAMILY_FIELD_UNAVAILABLE = {
  status: 503,
  code: "general.unavailable",
} as const;
export type FamilyFieldFailure = typeof FAMILY_FIELD_UNAVAILABLE | ApiError;

export function applyCards(
  previous: ParentFamily | undefined,
  response: ReturnType<typeof familyCards>,
  studentId?: string,
): ParentFamily {
  const { day, cards } = response;
  const roster = studentId ? previous : undefined;
  const narrowed = roster?.day === day ? roster : undefined;
  const family: ParentFamily = {
    day,
    dayExpiry: response.dayExpiry,
    needsDayReconciliation:
      !!roster && (roster.day !== day || roster.needsDayReconciliation),
    children: roster ? [...roster.children] : [],
    features: { ...narrowed?.features },
    today: { ...narrowed?.today },
    featureErrors: { ...narrowed?.featureErrors },
    todayErrors: { ...narrowed?.todayErrors },
    retryNotBefore: { ...narrowed?.retryNotBefore },
    confirmedToday: { ...narrowed?.confirmedToday },
    accessVersions: { ...roster?.accessVersions },
  };
  if (studentId) {
    delete family.features[studentId];
    delete family.today[studentId];
    delete family.featureErrors[studentId];
    delete family.todayErrors[studentId];
    delete family.retryNotBefore[studentId];
    delete family.confirmedToday[studentId];
    delete family.accessVersions[studentId];
    if (!cards.length)
      family.children = family.children.filter(
        (c) => c.student_id !== studentId,
      );
  }
  for (const card of cards) {
    const child = card.child;
    const id = child.student_id;
    const index = studentId
      ? family.children.findIndex((c) => c.student_id === id)
      : -1;
    if (index < 0) family.children.push(child);
    else family.children[index] = child;
    const accessVersion = [
      child.tenant_id,
      child.care_ended,
      child.without_care_place,
      card.access_version,
    ].join(":");
    const known =
      previous?.day === day && previous.accessVersions[id] === accessVersion
        ? previous
        : undefined;
    family.accessVersions[id] = accessVersion;
    const flags = card.features ?? known?.features[id];
    if (flags) family.features[id] = flags;
    family.today[id] = card.today ?? known?.today[id] ?? UNKNOWN_CHILD_TODAY;
    if (!card.features) family.featureErrors[id] = FAMILY_FIELD_UNAVAILABLE;
    if (!card.today) family.todayErrors[id] = FAMILY_FIELD_UNAVAILABLE;
    family.confirmedToday[id] = Boolean(
      card.today || known?.confirmedToday[id],
    );
  }
  return family;
}

export function familyCards(result: contract.FamilyStartResponse, id?: string) {
  if (!result.day || !isValidISODate(result.day))
    throw new Error("Missing or invalid family start day");
  if (
    !Number.isInteger(result.day_remaining_seconds) ||
    result.day_remaining_seconds <= 0
  )
    throw new Error("Invalid family start day lifetime");
  if (!result.cards) throw new Error("Missing family start cards");
  if (id && result.cards.some((card) => card.child.student_id !== id))
    throw new Error("Unexpected family start child");
  const remainingMs = result.day_remaining_seconds * 1000;
  return {
    day: result.day,
    cards: result.cards,
    dayExpiry: { at: Date.now() + remainingMs, remainingMs },
  };
}
