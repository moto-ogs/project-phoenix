import {
  encodeMultiValueParam,
  normalizeMultiValues,
  parseMultiValueParam,
} from "~/lib/multi-value-param";
import { berlinTodayISO } from "~/lib/date-helpers";
import { mayWritePersonalStorage } from "~/lib/personal-storage";
import {
  FILTER_QUERY_PARAMS,
  SEARCH_QUERY_PARAM,
  readFilterParam,
  studentSearchUrl,
  validQueryValue,
  type SearchParamReader,
} from "~/lib/student-search-url";
import {
  GROUP_OPTIONS,
  SORT_OPTIONS,
  STATUS_FILTER_OPTIONS,
  type BooleanFilter,
  type DayStatusFilter,
  type GroupMode,
  type PickupStatusFilter,
  type SortMode,
  type StatusFilter,
} from "./search-filter-options";
import { parseTrackingFilter, type TrackingFilter } from "./tracking-filter";

type FilterQueryParam = (typeof FILTER_QUERY_PARAMS)[number];
type PersistedSearchFilters = Partial<Record<FilterQueryParam, string>>;
const STUDENT_SEARCH_FILTER_STORAGE_PREFIX = "student-search:last-filters";

// The shared filter kit hands a multi-select its values as an array and a
// single-select as a string; normalize before it reaches the state setters. An
// array arrives as the raw selected labels — never re-encoded, or a class named
// "A,B" would be split apart on its way into the state (#2218 review).
export function asFilterValues(value: string | string[]): string[] {
  return Array.isArray(value)
    ? normalizeMultiValues(value)
    : parseMultiValueParam(value);
}

export function parsePickupTimeParam(value: string | null): string[] {
  return parseMultiValueParam(value).filter((time) => time !== "all");
}

export function searchParamsHavePersistedFilters(
  searchParams: SearchParamReader,
) {
  return (
    searchParams.has(SEARCH_QUERY_PARAM) ||
    FILTER_QUERY_PARAMS.some((key) => searchParams.has(key))
  );
}

export function persistedFiltersToSearchParams(
  filters: PersistedSearchFilters,
) {
  const params = new URLSearchParams();
  for (const key of FILTER_QUERY_PARAMS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  return params;
}

export function filtersFromSearchParams(
  searchParams: SearchParamReader,
): PersistedSearchFilters {
  const filters: PersistedSearchFilters = {};
  for (const key of FILTER_QUERY_PARAMS) {
    const value = readFilterParam(searchParams, key);
    if (value) filters[key] = value;
  }
  return filters;
}

/** Every filter of the page as the URL and the stored view name it. */
export interface SearchPageFilters {
  groupIds: string[];
  schoolClasses: string[];
  years: string[];
  roomId: string;
  roomName: string;
  bus: BooleanFilter;
  photoConsent: BooleanFilter;
  pickupStatus: PickupStatusFilter;
  pickupTimes: string[];
  arrivalTime: string;
  enrollmentAnswer: string;
  dayStatus: DayStatusFilter;
  attendance: StatusFilter;
  tracking: TrackingFilter;
  sort: SortMode;
  view: GroupMode;
}

/**
 * The one reading of the filter parameters: first render, stored view and
 * reset all take their values from here. An unknown value is the filter's
 * neutral one.
 */
export function readSearchPageFilters(
  params: SearchParamReader,
  today: string,
): SearchPageFilters {
  const shared = studentSearchUrl(params, today);
  const tracking = params.get("tracking") ?? "all";
  return {
    groupIds: shared.groupIds,
    schoolClasses: shared.schoolClasses,
    years: shared.years,
    roomId: shared.roomId,
    roomName: params.get("room_name") ?? "",
    bus: shared.bus,
    photoConsent: shared.photoConsent,
    pickupStatus: shared.pickupStatus,
    pickupTimes: parsePickupTimeParam(readFilterParam(params, "pickup_time")),
    arrivalTime: params.get("arrival_time") ?? "all",
    enrollmentAnswer: shared.enrollmentAnswer,
    dayStatus: shared.dayStatus,
    attendance: validQueryValue(
      params.get("status"),
      STATUS_FILTER_OPTIONS.map((option) => option.value),
      "all",
    ),
    tracking:
      parseTrackingFilter(tracking).kind === "invalid"
        ? "all"
        : (tracking as TrackingFilter),
    sort: validQueryValue(
      params.get("sort"),
      SORT_OPTIONS.map((option) => option.value),
      "name",
    ),
    view: validQueryValue(
      params.get("view"),
      GROUP_OPTIONS.map((option) => option.value),
      "none",
    ),
  };
}

function unlessNeutral(value: string, neutral: string): string {
  return value === neutral ? "" : value;
}

/** The parameters of these filters; a neutral filter is the empty string. */
export function searchPageFilterParams(
  filters: SearchPageFilters,
): Record<FilterQueryParam, string> {
  return {
    year: encodeMultiValueParam(filters.years),
    school_class: encodeMultiValueParam(filters.schoolClasses),
    group_id: encodeMultiValueParam(filters.groupIds),
    room_id: filters.roomId,
    room_name: filters.roomId ? filters.roomName : "",
    bus: unlessNeutral(filters.bus, "all"),
    photo_consent: unlessNeutral(filters.photoConsent, "all"),
    pickup_status: unlessNeutral(filters.pickupStatus, "all"),
    pickup_time: encodeMultiValueParam(filters.pickupTimes),
    arrival_time: unlessNeutral(filters.arrivalTime, "all"),
    enrollment_answer: filters.enrollmentAnswer,
    day_status: unlessNeutral(filters.dayStatus, "all"),
    status: unlessNeutral(filters.attendance, "all"),
    tracking: unlessNeutral(filters.tracking, "all"),
    sort: unlessNeutral(filters.sort, "name"),
    view: unlessNeutral(filters.view, "none"),
  };
}

function normalizeStoredFilters(
  filters: PersistedSearchFilters,
): PersistedSearchFilters {
  return searchPageFilterParams(
    readSearchPageFilters(
      persistedFiltersToSearchParams(filters),
      berlinTodayISO(),
    ),
  );
}

function compactStoredFilters(filters: PersistedSearchFilters) {
  return Object.fromEntries(
    Object.entries(filters).filter(
      (entry): entry is [FilterQueryParam, string] => Boolean(entry[1]),
    ),
  ) as PersistedSearchFilters;
}

function safelyRemoveStoredFilters(storageKey: string) {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Storage can be fully blocked by browser/privacy settings.
  }
}

export function readStoredFilters(storageKey: string | null) {
  if (!storageKey || typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      safelyRemoveStoredFilters(storageKey);
      return null;
    }
    return compactStoredFilters(
      normalizeStoredFilters(parsed as PersistedSearchFilters),
    );
  } catch {
    // Bewusst still: ein kaputter oder gesperrter Speicher startet die Suche
    // ohne gemerkte Filter, die Adresse trägt sie weiter.
    safelyRemoveStoredFilters(storageKey);
    return null;
  }
}

export function writeStoredFilters(
  storageKey: string | null,
  owner: string | null,
  filters: PersistedSearchFilters,
) {
  if (!storageKey || typeof window === "undefined") return;
  // The filters belong to this account. After a logout or an account switch,
  // also in another tab, they must not come back (#5000).
  if (!mayWritePersonalStorage(owner)) return;

  const compacted = compactStoredFilters(normalizeStoredFilters(filters));
  try {
    if (Object.keys(compacted).length === 0) {
      safelyRemoveStoredFilters(storageKey);
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(compacted));
  } catch {
    // localStorage can fail in private mode or when quota is exceeded. URL
    // persistence still works, so ignore storage failures.
  }
}

export function removeStoredFilters(storageKey: string | null) {
  if (!storageKey || typeof window === "undefined") return;
  safelyRemoveStoredFilters(storageKey);
}

export function buildSearchFilterStorageKey(
  user:
    | {
        id?: string | null;
        email?: string | null;
        tenantId?: string | null;
      }
    | undefined,
) {
  if (typeof window === "undefined") return null;

  const tenantKey =
    user?.tenantId !== undefined && user.tenantId !== null
      ? `tenant-${user.tenantId}`
      : `host-${window.location.host}`;
  const accountKey = user?.id ?? user?.email ?? "anonymous";
  return `${STUDENT_SEARCH_FILTER_STORAGE_PREFIX}:${tenantKey}:${accountKey}`;
}
