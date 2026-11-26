import { isValidISODate, parseISODate, toISODate } from "~/lib/date-helpers";
import {
  normalizeMultiValues,
  parseMultiValueParam,
} from "~/lib/multi-value-param";
import {
  SCHOOL_YEAR_FILTER_OPTIONS,
  type EnrollmentAnswerFilter,
} from "~/lib/student-helpers";
import type { StudentSearchFilterInput } from "~/lib/student-search-resource";
import { normalizeSearchStudentsGroupId } from "~/lib/swr/search-students-key";
import { sameSetMembers } from "~/lib/utils";

export const DATE_QUERY_PARAM = "date";
export const SEARCH_QUERY_PARAM = "search";
export const STUDENT_SEARCH_YEAR_OPTIONS = SCHOOL_YEAR_FILTER_OPTIONS.filter(
  ({ value }) => value !== "all",
);
const STUDENT_SEARCH_YEARS = STUDENT_SEARCH_YEAR_OPTIONS.map(
  ({ value }) => value,
);
const NO_RESTRICTION: readonly string[] = [];

/** A full selection and no selection both mean "all" (#6734). */
export function searchSelection(
  selected: readonly string[],
  options: readonly string[],
): readonly string[] {
  return selected.length > 0 && !sameSetMembers(selected, options)
    ? selected
    : NO_RESTRICTION;
}

export function searchYearSelection(
  selected: readonly string[],
): readonly string[] {
  return searchSelection(selected, STUDENT_SEARCH_YEARS);
}
export const FILTER_QUERY_PARAMS = [
  "year",
  "school_class",
  "group_id",
  "room_id",
  "room_name",
  "bus",
  "photo_consent",
  "pickup_status",
  "pickup_time",
  "arrival_time",
  "enrollment_answer",
  "day_status",
  "status",
  "tracking",
  "sort",
  "view",
] as const;

type FilterQueryParam = (typeof FILTER_QUERY_PARAMS)[number];
export type SearchParamReader = Pick<URLSearchParams, "get" | "getAll" | "has">;
const MULTI_VALUE_FILTER_PARAMS = new Set<FilterQueryParam>([
  "year",
  "school_class",
  "group_id",
  "pickup_time",
]);

export const BOOLEAN_FILTER_VALUES = ["all", "yes", "no"] as const;
export const PICKUP_STATUS_FILTER_VALUES = [
  "all",
  "self",
  "pickedUp",
  "none",
] as const;
const DAY_STATUS_FILTER_VALUES = [
  "all",
  "comes_today",
  "not_coming_today",
] as const;

/** Read every occurrence of a multi-value filter without escaping its commas again. */
export function readFilterParam(
  searchParams: SearchParamReader,
  key: FilterQueryParam,
): string | null {
  if (!MULTI_VALUE_FILTER_PARAMS.has(key)) return searchParams.get(key);
  const values = searchParams.getAll(key).filter((value) => value !== "");
  return values.length > 0 ? values.join(",") : null;
}

export function validQueryValue<T extends string>(
  value: string | null,
  validValues: readonly T[],
  fallback: T,
): T {
  return validValues.find((valid) => valid === value) ?? fallback;
}

export function keepOfferedYears(values: readonly string[]): string[] {
  return normalizeMultiValues(values).filter((year) =>
    STUDENT_SEARCH_YEAR_OPTIONS.some(({ value }) => value === year),
  );
}

export function parseYearParam(value: string | null | undefined): string[] {
  return keepOfferedYears(parseMultiValueParam(value));
}

export function keepValidGroupIds(values: readonly string[]): string[] {
  return normalizeMultiValues(values)
    .map(normalizeSearchStudentsGroupId)
    .filter((groupId) => groupId !== "");
}

export function parseGroupIdsParam(value: string | null | undefined): string[] {
  return keepValidGroupIds(parseMultiValueParam(value));
}

/** The Sunday closing the current calendar week, matching the Go planning horizon. */
export function maxPlanningIso(todayIso: string): string {
  const day = parseISODate(todayIso);
  day.setDate(day.getDate() + ((7 - day.getDay()) % 7));
  return toISODate(day);
}

function initialPlanningDate(value: string | null, today: string) {
  return value &&
    isValidISODate(value) &&
    value > today &&
    value <= maxPlanningIso(today)
    ? value
    : null;
}

/** Only URL filters reach the first render. Browser-local preferences apply after hydration. */
export function studentSearchUrl(params: SearchParamReader, today: string) {
  const explicitDate = initialPlanningDate(params.get(DATE_QUERY_PARAM), today);
  return {
    groupIds: parseGroupIdsParam(readFilterParam(params, "group_id")),
    search: params.get(SEARCH_QUERY_PARAM) ?? "",
    schoolClasses: parseMultiValueParam(
      readFilterParam(params, "school_class"),
    ),
    roomId: params.get("room_id") ?? "",
    dayStatus: validQueryValue(
      params.get("day_status"),
      DAY_STATUS_FILTER_VALUES,
      "all",
    ),
    bus: validQueryValue(params.get("bus"), BOOLEAN_FILTER_VALUES, "all"),
    photoConsent: validQueryValue(
      params.get("photo_consent"),
      BOOLEAN_FILTER_VALUES,
      "all",
    ),
    companions: params.get("view") === "companions",
    years: parseYearParam(readFilterParam(params, "year")),
    pickupStatus: validQueryValue(
      params.get("pickup_status"),
      PICKUP_STATUS_FILTER_VALUES,
      "all",
    ),
    enrollmentAnswer: params.get("enrollment_answer") ?? "",
    explicitDate,
  };
}

export function initialStudentSearch(
  params: SearchParamReader,
  today: string,
  photosEnabled: boolean,
  enrollmentAnswer = "",
): StudentSearchFilterInput & { photoState: string } {
  const { explicitDate, ...filters } = studentSearchUrl(params, today);
  return {
    ...filters,
    // The list is read without the term; the browser applies it.
    search: "",
    years: searchYearSelection(filters.years),
    date: explicitDate ?? today,
    isToday: explicitDate === null,
    roomId: explicitDate ? "" : filters.roomId,
    photoConsent: photosEnabled ? filters.photoConsent : "all",
    photoState: photosEnabled ? "photos-enabled" : "photos-disabled",
    enrollmentAnswer,
  };
}

export function enrollmentAnswerValue(
  question: EnrollmentAnswerFilter,
  option: EnrollmentAnswerFilter["options"][number],
): string {
  return `${question.key}=${option.value}`;
}

/** The listed child IDs, or null when the saved answer is no longer offered. */
export function enrollmentAnswerChildrenOf(
  questions: readonly EnrollmentAnswerFilter[],
  answer: string,
): ReadonlySet<string> | null {
  if (!answer) return null;
  for (const question of questions) {
    const option = question.options.find(
      (option) => enrollmentAnswerValue(question, option) === answer,
    );
    if (option) return new Set(option.studentIds);
  }
  return null;
}
