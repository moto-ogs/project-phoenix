"use client";

import { ParentAttentionList } from "~/components/students/parent-attention-badge";
import { useHasDeepScrollPosition } from "~/components/ui/navigation-scroll-position";
import { StatusBadge } from "~/components/ui/status-badge";
import {
  buildStudentSearchFilters,
  fetchStudentSearch,
  studentNameSearch,
  type StudentSearchFilterInput,
} from "~/lib/student-search-resource";
import {
  DATE_QUERY_PARAM,
  FILTER_QUERY_PARAMS,
  SEARCH_QUERY_PARAM,
  enrollmentAnswerChildrenOf,
  enrollmentAnswerValue,
  keepOfferedYears,
  keepValidGroupIds,
  maxPlanningIso,
  searchSelection,
  searchYearSelection,
  studentSearchUrl,
} from "~/lib/student-search-url";
import { studentKeys } from "~/lib/swr/portal-keys";
import { rooms as roomKeys } from "~/lib/swr/rooms";
import { groups as groupKeys } from "~/lib/swr/groups";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import {
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CalendarRange,
  Download,
  FileText,
  ListChecks,
  Search,
} from "lucide-react";
// SSE is handled globally by TenantAuthWrapper - real-time updates work automatically
import { useSession } from "next-auth/react";
import { hasSessionAccess } from "~/lib/session-access";
import { useSearchParams } from "next/navigation";
import { useTenantRouter } from "~/lib/tenant-router";
import { useSetBreadcrumb } from "~/lib/breadcrumb-context";
import { HELP_TOPICS } from "~/lib/help-topics";
import { CollectionGrid } from "~/components/ui/collection-grid";
import { Alert } from "~/components/ui/alert";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { Modal } from "~/components/ui/modal";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { ForbiddenPage } from "~/components/ui/forbidden-page";
import { errorAlertActions } from "~/components/ui/form-error-alert";
import { useApiLoadError } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { SectionCard } from "~/components/ui/section-card";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import {
  isMultiSelectRestricting,
  restrictingFilterIds,
  type FilterConfig,
  type FilterOption,
  type ActiveFilter,
  type FilterSection,
  type OverflowMenuEntry,
} from "~/components/ui/page-header/types";
import { DetailIcons } from "~/components/ui/detail-modal-components";
import {
  fetchEnrollmentAnswerFilters,
  fetchSchoolClasses,
} from "~/lib/student-api";
import type { EnrollmentAnswerFilter } from "~/lib/student-helpers";
import { answerQuestionLabel } from "~/lib/school-search";
import { hasPermission } from "~/lib/auth-utils";
import type { Student } from "~/lib/student-helpers";
import type { Group, Room } from "~/lib/api";
import { CalendarBlankIcon } from "@phosphor-icons/react";
import { Button } from "~/components/ui/button";
import { MotoDuotoneIcon } from "~/components/ui/moto-duotone-icon";
import { DatePicker } from "~/components/ui/date-picker";
import {
  berlinTodayISO,
  formatDate,
  parseISODate,
  toISODate,
} from "~/lib/date-helpers";
import { useOptionalSupervision } from "~/lib/supervision-context";
import { schoolClassesLabel } from "~/lib/school-class-label";
import { useHolidayGuestLabels } from "~/lib/hooks/use-holiday-guest-labels";
import {
  LOCATION_STATUSES,
  parseLocation,
  isNotCheckedInLocation,
  isPresentLocation,
  isSchoolyardLocation,
  isTransitLocation,
} from "~/lib/location-helper";
import { countedDayStatus } from "~/lib/presence-status";
import { useMinuteClock } from "~/lib/pickup-helpers";
import { useLatest } from "~/lib/hooks/use-latest";
import { useInitialPaintViewport } from "~/lib/hooks/use-after-initial-paint";
import {
  SearchStudentCard,
  SearchStudentStatusBadge,
  dailyDepartureLabelForStudent,
  searchStudentDay,
} from "~/components/students/search-student-card";
import {
  StudentTable,
  arrivalColumn,
  classColumn,
  columnDefaults,
  compactColumns,
  departureColumn,
  groupColumn,
  nameColumn,
  pickupColumn,
  statusColumn,
  trackingColumn,
} from "~/components/students/student-table";
import { StudentSelectionScope } from "~/components/students/student-selection-scope";
import { StudentListApp } from "~/components/students/student-list-app";
import { ActionBar } from "~/components/ui/action-bar";
import { useDeviceContext } from "~/lib/device-context";
import {
  CollectionViewSwitch,
  columnMenuEntries,
  phoneDetailMenuEntries,
} from "~/components/ui/collection-view-switch";
import { useCollectionView } from "~/lib/hooks/use-collection-view";
import { BELOW_MD, useMediaQuery } from "~/lib/hooks/use-media-query";
import { useStudentPhotosEnabled } from "~/lib/hooks/use-student-photos-enabled";
import { StudentCardClockProvider } from "~/components/students/student-card-clock";
import { StudentExportModal } from "~/components/students/student-export-modal";
import { useBulkCheckinActions } from "~/components/students/use-bulk-checkin-actions";
import { StudentCardGridSkeleton } from "~/components/students/student-card-skeleton";
import { SchoolCheckinFab } from "~/components/students/school-checkin-fab";
import { SchoolCheckinModeMobile } from "~/components/students/school-checkin-mode-mobile";
import {
  canCheckInChildren,
  canCheckInToRooms,
  canExportStudents,
} from "~/lib/student-access";
import { useParentAnnouncementsAvailable } from "~/lib/hooks/use-parent-announcements-available";
import {
  announcementPrefillPath,
  stashAnnouncementStudents,
} from "~/lib/announcement-prefill";
import { personalStorageOwner } from "~/lib/personal-storage";
import { KIND_PARAM } from "~/components/announcements/announcement-meta";
import { SchoolCheckinSelectionBar } from "~/components/students/school-checkin-selection-bar";
import { SchoolCheckinTargetPicker } from "~/components/students/school-checkin-target-picker";
import { useCheckinTarget } from "~/lib/hooks/use-checkin-target";
import type { SchoolCheckinAction } from "~/lib/student-api";
import {
  SchoolCheckinMissingHint,
  type MissingCheckinStudent,
} from "~/components/students/school-checkin-missing-hint";
import {
  isLeftOutOfSelectAll,
  planSelectAll,
  type SelectAllControl,
} from "~/components/students/school-checkin-select-all";
import {
  checkoutConfirmationRoom,
  deriveCheckinState,
  useSchoolCheckinMode,
} from "~/lib/hooks/use-school-checkin-mode";
import {
  CHECKOUT_HINTS,
  useEarlyCheckoutDialog,
} from "~/components/students/early-checkout-note";
import { StudentSearchTransitCard } from "~/components/students/student-search-transit-card";
import {
  useAttendanceWebEnabled,
  useTenantSlugSafe,
} from "~/lib/tenant-context";
import { useSWRAuth, useImmutableSWR } from "~/lib/swr";
import { tenantListKeys } from "~/lib/swr/tenant-list-keys";
import { tenantStudentKeys } from "~/lib/swr/tenant-student-keys";
import {
  encodeMultiValueParam,
  normalizeMultiValues,
} from "~/lib/multi-value-param";
import { activeService } from "~/lib/active-api";
import type { TrackingIndicatorsResponse } from "~/lib/active-helpers";
import {
  getStudentDayTimes,
  getStudentTimeStatus,
  getTimeStatusSortRank,
} from "~/lib/student-time-status";
import {
  matchesTrackingFilter,
  resolveTrackingFilterAfterLabelChange,
  trackingFilterChipLabel,
  type TrackingFilter,
} from "./tracking-filter";
import { StudentSearchPageSkeleton } from "./page-skeleton";
import {
  BUS_FILTER_OPTIONS,
  DAY_STATUS_FILTER_OPTIONS,
  DAY_STATUS_FILTER_OPTIONS_OTHER_DAY,
  GROUP_OPTIONS,
  LIVE_STATUS_FILTER_OPTIONS,
  PHOTO_CONSENT_FILTER_OPTIONS,
  PICKUP_STATUS_FILTER_OPTIONS,
  PLANNED_ABSENCE_STATUS_FILTER_OPTIONS,
  SCHOOL_YEAR_MULTI_OPTIONS,
  SORT_OPTIONS,
  STATUS_FILTER_LABELS,
  isPlannedAbsenceStatusFilter,
  type BooleanFilter,
  type DayStatusFilter,
  type GroupMode,
  type PickupStatusFilter,
  type SortMode,
  type StatusFilter,
} from "./search-filter-options";
import {
  asFilterValues,
  buildSearchFilterStorageKey,
  filtersFromSearchParams,
  readSearchPageFilters,
  readStoredFilters,
  removeStoredFilters,
  searchPageFilterParams,
  searchParamsHavePersistedFilters,
  writeStoredFilters,
  type SearchPageFilters,
} from "./search-filter-storage";
import {
  compareByName,
  compareByPickupTime,
  groupStudents,
  orderedRooms,
  statusLabelForStudent,
} from "./student-list-grouping";
import { useSamePageLinkClick } from "./use-same-page-link-click";
import { useChildScopeTabs } from "./use-child-scope-tabs";
import { childrenConcept } from "~/lib/concepts/children";

const EMPTY_STUDENT_ARRAY: Student[] = [];
const NO_GROUPS: Group[] = [];
const NO_ROOMS: Room[] = [];
const NO_VALUES: string[] = [];
const NO_FILTERS = readSearchPageFilters(new URLSearchParams(), "");

const NO_ENROLLMENT_ANSWER_QUESTIONS: readonly EnrollmentAnswerFilter[] = [];

/**
 * Whether the server lets this account filter by registration answers. Any
 * failure other than a refusal says nothing about the access: an active
 * filter keeps working and its chip; only the choice lacks its questions.
 */
function enrollmentAnswerAccessOf(
  sessionLoading: boolean,
  mayAsk: boolean,
  options: { data?: unknown; error?: unknown },
): "pending" | "granted" | "denied" {
  if (sessionLoading) return "pending";
  if (!mayAsk) return "denied";
  if (options.error instanceof ApiError && options.error.status === 403)
    return "denied";
  if (options.data !== undefined) return "granted";
  return options.error ? "granted" : "pending";
}

// The card skeleton has no end of its own: a request that never answers (weak
// school Wi-Fi) or a session without a token keeps it up for good, with nothing
// on screen saying why or what to do. After this long the page says so and
// offers a reload instead (#3374).
const LOADING_STALL_MS = 10_000;

// Tag-Knöpfe im Filter: am Handy dieselben Chips wie die Reiter der App
// (gewählt = `aria-pressed`), am Desktop wie heute Knopf und Umrandung.
function dayChoice(selected: boolean, app: boolean) {
  return app
    ? ({ variant: "chip", size: "md", "aria-pressed": selected } as const)
    : ({ variant: selected ? "primary" : "outline", size: "compact" } as const);
}
function SearchPageContent() {
  const router = useTenantRouter();
  // Use required: true to auto-redirect unauthenticated users (same pattern as /active-supervisions)
  const {
    data: session,
    status,
    update: updateSession,
  } = useSession({
    required: true,
    onUnauthenticated() {
      router.push("/");
    },
  });
  const searchParams = useSearchParams();
  useSetBreadcrumb({ helpTopic: HELP_TOPICS.studentSearch });
  const storageKey = useMemo(
    () => buildSearchFilterStorageKey(session?.user),
    [session?.user],
  );
  const storageOwner = personalStorageOwner(session?.user);
  const hasUrlFilterParams = searchParamsHavePersistedFilters(searchParams);
  // Initial state comes from the URL only, so refreshes, history and copied
  // links restore the same view. The stored view is unavailable on the server, so
  // reading it during render made the first client render differ from the
  // server HTML (hydration mismatch, Sentry FRONTEND-17). The mount effect
  // below restores stored filters when the URL carries none.
  const initialToday = berlinTodayISO();
  const initial = studentSearchUrl(searchParams, initialToday);
  const initialFilters = readSearchPageFilters(searchParams, initialToday);

  // The search field keeps an immediate local draft and reports the term
  // after its debounce. The term then narrows the loaded list in the browser,
  // as a transition: a key typed while the list renders is shown first.
  const [searchTerm, setSearchTerm] = useState(initial.search);
  // Only a list too long to load in full sends the term to the server.
  // Key of the list (read without a name) that the page cap cut short.
  const [partialListKey, setPartialListKey] = useState<string | null>(null);
  const [searchResetKey, setSearchResetKey] = useState(0);
  const [selectedGroupIds, setSelectedGroupIds] = useState(
    initialFilters.groupIds,
  );
  const [selectedSchoolClasses, setSelectedSchoolClasses] = useState(
    initialFilters.schoolClasses,
  );
  const [selectedYears, setSelectedYears] = useState(initialFilters.years);
  const [attendanceFilter, setAttendanceFilter] = useState<StatusFilter>(
    initialFilters.attendance,
  );
  const [busFilter, setBusFilter] = useState<BooleanFilter>(initialFilters.bus);
  const [photoConsentFilter, setPhotoConsentFilter] = useState<BooleanFilter>(
    initialFilters.photoConsent,
  );
  const [pickupStatusFilter, setPickupStatusFilter] =
    useState<PickupStatusFilter>(initialFilters.pickupStatus);
  const [dayStatusFilter, setDayStatusFilter] = useState<DayStatusFilter>(
    initialFilters.dayStatus,
  );
  const [pickupTimeFilter, setPickupTimeFilter] = useState(
    initialFilters.pickupTimes,
  );
  const [arrivalTimeFilter, setArrivalTimeFilter] = useState(
    initialFilters.arrivalTime,
  );
  // An answer to a question of the registration form, "<key>=<value>"
  // (#6954). Empty = off.
  const [enrollmentAnswerFilter, setEnrollmentAnswerFilter] = useState(
    initialFilters.enrollmentAnswer,
  );
  const [trackingFilter, setTrackingFilter] = useState<TrackingFilter>(
    initialFilters.tracking,
  );
  const [sortMode, setSortMode] = useState<SortMode>(initialFilters.sort);
  const [groupMode, setGroupMode] = useState<GroupMode>(initialFilters.view);
  const [selectedRoomId, setSelectedRoomId] = useState(initialFilters.roomId);
  const [selectedRoomName, setSelectedRoomName] = useState(
    initialFilters.roomName,
  );
  const [isExportOpen, setIsExportOpen] = useState(false);

  // Planning date (#1939). Always read from the real URL, never from the
  // stored-filter fallback. null = "follow the school-local today": the
  // default view tracks the Berlin day as it advances past midnight, while an
  // explicitly chosen date stays fixed. Only a strictly-future URL date within
  // the planning horizon is kept explicit: a date naming today collapses to the
  // implicit default, a past date (bookmarked or hand-edited URL) is rejected
  // because planning is future-only, and a date beyond the horizon is rejected
  // because the backend would answer it with 400 (see maxPlanningIso).
  const [explicitDate, setExplicitDate] = useState(initial.explicitDate);

  const updateUrlParams = useCallback(
    (
      patch: Partial<
        Record<
          | (typeof FILTER_QUERY_PARAMS)[number]
          | typeof DATE_QUERY_PARAM
          | typeof SEARCH_QUERY_PARAM,
          string
        >
      >,
    ) => {
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === "") {
          url.searchParams.delete(key);
        } else {
          url.searchParams.set(key, value);
        }
      }
      window.history.replaceState(
        window.history.state ?? null,
        "",
        url.toString(),
      );
      writeStoredFilters(
        storageKey,
        storageOwner,
        filtersFromSearchParams(url.searchParams),
      );
    },
    [storageKey, storageOwner],
  );

  const updateSearchTerm = useCallback(
    (value: string) => {
      startTransition(() => setSearchTerm(value));
      updateUrlParams({ [SEARCH_QUERY_PARAM]: value });
    },
    [updateUrlParams],
  );

  const applyFilters = useCallback((filters: SearchPageFilters) => {
    setSelectedGroupIds(filters.groupIds);
    setSelectedSchoolClasses(filters.schoolClasses);
    setSelectedYears(filters.years);
    setAttendanceFilter(filters.attendance);
    setBusFilter(filters.bus);
    setPhotoConsentFilter(filters.photoConsent);
    setPickupStatusFilter(filters.pickupStatus);
    setPickupTimeFilter(filters.pickupTimes);
    setArrivalTimeFilter(filters.arrivalTime);
    setEnrollmentAnswerFilter(filters.enrollmentAnswer);
    setDayStatusFilter(filters.dayStatus);
    setTrackingFilter(filters.tracking);
    setSortMode(filters.sort);
    setGroupMode(filters.view);
    setSelectedRoomId(filters.roomId);
    setSelectedRoomName(filters.roomName);
  }, []);

  useEffect(() => {
    if (!storageKey) return;

    if (hasUrlFilterParams) {
      writeStoredFilters(
        storageKey,
        storageOwner,
        filtersFromSearchParams(searchParams),
      );
      return;
    }

    const storedFilters = readStoredFilters(storageKey);
    if (!storedFilters) return;

    applyFilters(storedFilters);
    updateUrlParams(searchPageFilterParams(storedFilters));
  }, [
    applyFilters,
    hasUrlFilterParams,
    searchParams,
    storageKey,
    storageOwner,
    updateUrlParams,
  ]);

  useEffect(() => {
    const searchPathname = window.location.pathname;
    const restorePickupTimes = () => {
      if (window.location.pathname !== searchPathname) return;
      const params = new URLSearchParams(window.location.search);
      setPickupTimeFilter(
        readSearchPageFilters(params, berlinTodayISO()).pickupTimes,
      );
      writeStoredFilters(
        storageKey,
        storageOwner,
        filtersFromSearchParams(params),
      );
    };
    window.addEventListener("popstate", restorePickupTimes);
    return () => window.removeEventListener("popstate", restorePickupTimes);
  }, [storageKey, storageOwner]);

  // Current time for pickup urgency calculation (updates every minute)
  const now = useMinuteClock();

  // Planning-date context (#1939). todayIso derives from the minute clock so
  // the "Heute" anchor rolls over at midnight without a reload — and it is
  // the SCHOOL-local (Berlin) day, matching the backend's default, not the
  // browser's timezone.
  const todayIso = berlinTodayISO(now);
  // An explicitly selected future date can age into the past if this tab stays
  // open across the selected day and the following midnight: todayIso rolls
  // forward on the minute clock while explicitDate stays frozen. Planning is
  // future-only, so once the stored date has fallen behind the Berlin day,
  // ignore it and follow "Heute" again — never send a past date to the backend
  // or render yesterday's planning. The effect below reconciles the persisted
  // state and URL so the picker stops showing the stale day too (#1939).
  const selectedDate =
    explicitDate && explicitDate >= todayIso ? explicitDate : todayIso;
  const isToday = selectedDate === todayIso;
  const tomorrowIso = useMemo(() => {
    const tomorrow = parseISODate(todayIso);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return toISODate(tomorrow);
  }, [todayIso]);
  // The horizon end only ever moves forward as todayIso advances, so an
  // explicit date that was valid once can never age out at the far end — no
  // reconciliation effect needed beyond the past-date one below.
  const maxDateIso = useMemo(() => maxPlanningIso(todayIso), [todayIso]);
  // Urgency coloring and time-status sorting compare against "now". For a
  // non-today date every planned time is neutral, so compare against that
  // day's local midnight instead of the current clock.
  const planningNow = useMemo(
    () => (isToday ? now : parseISODate(selectedDate)),
    [isToday, now, selectedDate],
  );

  const updateSelectedDate = useCallback(
    (value: string) => {
      // Planning is future-only and horizon-bounded: never store a day the
      // backend rejects. The picker already disables out-of-range dates, so
      // this only guards a stray caller — clamp into [today, maxDateIso].
      const bounded = value > maxDateIso ? maxDateIso : value;
      const clamped = bounded < todayIso ? todayIso : bounded;
      // Picking the current Berlin day means "follow today", not a fixed date.
      // Compare against the same clock-derived todayIso the buttons pass, NOT a
      // fresh berlinTodayISO(): near Berlin midnight the minute clock can still
      // read yesterday for up to 60s, and mixing the two days would store
      // yesterday as an explicit date and pin the page there when the user taps
      // "Heute" (#1939).
      const explicit = clamped === todayIso ? null : clamped;
      setExplicitDate(explicit);
      updateUrlParams({ date: explicit ?? "" });
    },
    [todayIso, maxDateIso, updateUrlParams],
  );

  // The explicitDate initializer rejects a URL `date` that is malformed, past,
  // or names today (planning is future-only), collapsing it to null. When it
  // does, the raw query param is still sitting in the address bar, so a copied
  // link or the URL-state contract would keep advertising a date the page no
  // longer uses. Reconcile the URL once on mount to what was actually accepted.
  // The aging effect below only covers a date that ages out *after* mount
  // (explicitDate is non-null there); this covers the already-rejected case.
  useEffect(() => {
    const rawDate = searchParams.get(DATE_QUERY_PARAM);
    if (rawDate !== null && rawDate !== (explicitDate ?? "")) {
      updateUrlParams({ date: explicitDate ?? "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once an explicitly selected date has aged past the Berlin day (tab left
  // open across midnight), drop it so the picker, URL, and stored filters stop
  // carrying a past planning date. selectedDate above already ignores it; this
  // reconciles the persisted state (#1939).
  useEffect(() => {
    if (explicitDate && explicitDate < todayIso) {
      setExplicitDate(null);
      updateUrlParams({ date: "" });
    }
  }, [explicitDate, todayIso, updateUrlParams]);

  const dayStatusFilterOptions = isToday
    ? DAY_STATUS_FILTER_OPTIONS
    : DAY_STATUS_FILTER_OPTIONS_OTHER_DAY;

  // Live presence data describes today. For any other planning date the
  // realtime filters are neutralized and hidden so current whereabouts are
  // never read as (or filtered like) a plan for that day. The absence statuses
  // are the exception: they come from the status days recorded for the selected
  // date, not from the live location, so planning by them is the whole point
  // ("wer ist am Freitag krank gemeldet") and they stay selectable (#1939).
  const effectiveAttendanceFilter: StatusFilter =
    isToday || isPlannedAbsenceStatusFilter(attendanceFilter)
      ? attendanceFilter
      : "all";
  const effectiveTrackingFilter: TrackingFilter = isToday
    ? trackingFilter
    : "all";
  const effectiveRoomId = isToday ? selectedRoomId : "";
  const effectiveGroupMode: GroupMode =
    isToday || (groupMode !== "status" && groupMode !== "room")
      ? groupMode
      : "none";

  const {
    ownGroupIds: myGroups,
    ownGroupRoomNames: myGroupRooms,
    ownSessionRoomNames: mySupervisedRooms,
  } = useOptionalSupervision();

  // Page-level school check-in/out mode. When active, clicking a card toggles
  // the student's attendance instead of navigating to the detail page.
  //
  // Available in BOTH presence modes since #2220: the endpoint behind it
  // (POST /api/students/{id}/school-checkin) is mode-agnostic and, in detailed
  // mode, a checkout ends the open room visit in the same transaction — so
  // attendance and room state can't drift apart. The remaining gates are the
  // planning date (check-in always writes today's attendance) and the
  // "Anwesenheit über Web-App erfassen" setting. The trigger components check
  // the setting themselves too; gating here as well keeps their layout
  // wrappers (mobile spacing, the grid's bottom padding) out of the tree when
  // the school has web attendance switched off.
  const attendanceWebEnabled = useAttendanceWebEnabled();
  // Ohne users:checkin (etwa als Gast, ADR 0091) scheiterte jeder Tipp.
  const checkinModeAvailable =
    isToday && attendanceWebEnabled && canCheckInChildren(session);
  // „Anmelden in“ (#6953): binary schools and sessions without the move
  // right see no target; a check-in then stays „Anwesend (ohne Raum)“.
  const checkinTarget = useCheckinTarget(
    checkinModeAvailable && canCheckInToRooms(session),
  );
  const refreshCheckinTargets = checkinTarget.refresh;
  const schoolCheckin = useSchoolCheckinMode({
    target: checkinTarget.target,
    onTargetRefused: () => void refreshCheckinTargets(),
  });
  // A checkout well before today's pickup time asks for an optional reason
  // (#3324); every other checkout keeps its current behaviour.
  const earlyCheckout = useEarlyCheckoutDialog((studentId, note, reason) => {
    void schoolCheckin.toggle(studentId, "anwesend", note, reason);
  });
  const requestEarlyCheckout = earlyCheckout.request;
  // Checkout of a student who is currently in a room asks first and names the
  // room; every roomless state stays a single tap (#2220).
  const [pendingRoomCheckout, setPendingRoomCheckout] = useState<{
    studentId: string;
    studentName: string;
    room: string;
  } | null>(null);
  const {
    enabled: studentPhotosEnabled,
    isLoading: studentPhotosSettingLoading,
  } = useStudentPhotosEnabled();

  // Fetch groups with SWR (immutable - only fetched once)
  const {
    data: loadedGroups,
    error: groupsError,
    isLoading: groupsLoading,
    mutate: reloadGroups,
  } = useImmutableSWR<Group[]>(groupKeys.key(), groupKeys.fetcher);
  const groups = loadedGroups ?? NO_GROUPS;
  const {
    data: loadedRooms,
    error: roomsError,
    mutate: reloadRooms,
  } = useSWRAuth<Room[]>(roomKeys.key({ page: 1, pageSize: 1000 }), () =>
    roomKeys.fetcher({ page: 1, pageSize: 1000 }),
  );
  const rooms = loadedRooms ?? NO_ROOMS;

  const {
    data: schoolClassOptionsData,
    error: schoolClassesError,
    isLoading: schoolClassesLoading,
    mutate: reloadSchoolClasses,
  } = useSWRAuth<unknown>(studentKeys.schoolClasses(), fetchSchoolClasses, {
    revalidateOnFocus: false,
  });
  // Ohne Gruppen, Räume oder Klassen fehlten Filter und Raumnamen, als gäbe
  // es sie nicht (#2353): ein Fehler steht über der Liste.
  const filterOptionsLoad = useSwrResourceLoadError(
    [
      { data: loadedGroups, error: groupsError },
      { data: loadedRooms, error: roomsError },
      { data: schoolClassOptionsData, error: schoolClassesError },
    ],
    "die Filterauswahl",
    () => Promise.all([reloadGroups(), reloadRooms(), reloadSchoolClasses()]),
  );
  const schoolClassOptions = useMemo(
    () =>
      Array.isArray(schoolClassOptionsData)
        ? schoolClassOptionsData.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    [schoolClassOptionsData],
  );

  // A multi-select with every option chosen means "alle", as the head shows
  // (#6734): list and export then get no selection, so nothing is narrowed
  // that the page does not show as a filter. A chosen value outside the
  // options (a class or group not loaded) still narrows.
  const queryYears = searchYearSelection(selectedYears);
  const querySchoolClasses = searchSelection(
    selectedSchoolClasses,
    schoolClassOptions,
  );
  const queryGroupIds = searchSelection(
    selectedGroupIds,
    groups.map((group) => group.id),
  );

  // Generate SWR cache key for students (changes when filters change → SWR auto-cancels old requests)
  // Note: User context is only for badge styling, not for fetching students
  const photoConsentFeatureAvailable = studentPhotosSettingLoading
    ? true
    : studentPhotosEnabled;
  const photoConsentFeatureState = studentPhotosSettingLoading
    ? "photos-loading"
    : studentPhotosEnabled
      ? "photos-enabled"
      : "photos-disabled";
  const requestedPhotoConsentFilter = photoConsentFeatureAvailable
    ? photoConsentFilter
    : "all";
  // bus / photo_consent / pickup_status are now real backend filters (#1492),
  // applied server-side in the same in-memory pass as day_status, so the
  // backend returns correctly-filtered and correctly-counted pages. The cache
  // key just has to vary with every filter value so SWR refetches on change.
  // Companion links are fetched only for the Laufgemeinschaft grouping — they
  // cost an extra backend query, and no other view reads them. Part of the
  // cache key so switching into that grouping triggers exactly one refetch.
  // Sits BEFORE pickup_status on purpose: that filter must stay the key's last
  // segment (asserted by the #1492 cache-key test).
  const wantsCompanions = groupMode === "companions";
  // The key carries selectedDate AND the today/non-today mode: when an
  // explicitly selected future date becomes today at midnight, selectedDate
  // is unchanged but the request semantics flip (date omitted, live
  // attendance included) — without the mode in the key SWR would keep
  // serving the stale future-planning response under live controls (#1939).
  //
  // The registration answer filter (#6954) has the gate of the answers on the
  // child's page: users:read and a staff record of the school, or an
  // administrator. Only the server knows the staff record, so its answer to
  // the options decides: the list and the export carry the filter only after
  // the server granted it, and a refused (403) account loses a filter from a
  // saved link or state instead of a whole list refused for it.
  const mayAskEnrollmentAnswers = hasPermission(session, "users:read");
  // The answers name the children in care on the list's planning day
  // (#7645). A new day waits for its own answers: the previous day's would
  // filter and count the new day's children. The key names today's date too,
  // so a tab open across midnight reads the new day's answers.
  const enrollmentAnswerDay = isToday ? undefined : selectedDate;
  const fetchEnrollmentAnswersOfDay = useCallback(
    () => fetchEnrollmentAnswerFilters(enrollmentAnswerDay),
    [enrollmentAnswerDay],
  );
  // A session that is still loading names no permissions yet: deciding now
  // would refuse the account and drop its saved filter.
  const enrollmentAnswerFilters = useSWRAuth(
    status !== "loading" && mayAskEnrollmentAnswers
      ? tenantListKeys.enrollmentAnswerFilters(enrollmentAnswerDay ?? todayIso)
      : null,
    fetchEnrollmentAnswersOfDay,
  );
  const enrollmentAnswerAccess = enrollmentAnswerAccessOf(
    status === "loading",
    mayAskEnrollmentAnswers,
    enrollmentAnswerFilters,
  );
  const enrollmentAnswerQuestions: readonly EnrollmentAnswerFilter[] =
    (enrollmentAnswerAccess === "granted" && enrollmentAnswerFilters.data) ||
    NO_ENROLLMENT_ANSWER_QUESTIONS;
  const effectiveEnrollmentAnswer =
    enrollmentAnswerAccess === "granted" ? enrollmentAnswerFilter : "";
  // The page narrows the loaded list by an offered answer itself, with the
  // children the answer names (#7645). Counted against the list's other
  // filters, the number beside an answer is then what choosing it shows, and
  // switching answers needs no new request. An answer the server no longer
  // offers (a saved link) still reaches the list as its own filter.
  const activeEnrollmentAnswerChildren = useMemo(
    () =>
      enrollmentAnswerChildrenOf(
        enrollmentAnswerQuestions,
        effectiveEnrollmentAnswer,
      ),
    [enrollmentAnswerQuestions, effectiveEnrollmentAnswer],
  );
  const serverEnrollmentAnswer = activeEnrollmentAnswerChildren
    ? ""
    : effectiveEnrollmentAnswer;
  // A saved filter waits for the server's answer. Loaded before it, the list
  // would come once without the filter and again with it, and an export in
  // between would carry every child. The list and the export start when the
  // access is known; without a saved filter nothing waits.
  // A complete option selection is also an unfiltered search. Wait for the
  // options only when they decide the query; after a failure the explicit
  // selection still restricts the list.
  const awaitsSearchFilters =
    (enrollmentAnswerAccess === "pending" && enrollmentAnswerFilter !== "") ||
    (selectedSchoolClasses.length > 0 &&
      schoolClassesLoading &&
      schoolClassOptionsData === undefined &&
      !schoolClassesError) ||
    (selectedGroupIds.length > 0 &&
      hasPermission(session, "groups:read") &&
      groupsLoading &&
      loadedGroups === undefined &&
      !groupsError);

  // The group filter leads the key as a fixed `g{id}`/`gall` scope segment
  // (#2097) so the SSE flush can read it back and skip a refetch when a
  // check-in event names a group this view does not show. It has to sit BEFORE
  // the free-text term: the term may contain dashes ("Anna-Lena"), so no
  // segment after it can be located positionally. See lib/swr/search-students-key.
  const wholeListParams = {
    groupIds: queryGroupIds,
    search: "",
    schoolClasses: querySchoolClasses,
    roomId: effectiveRoomId,
    dayStatus: dayStatusFilter,
    date: selectedDate,
    isToday,
    photoState: photoConsentFeatureState,
    bus: busFilter,
    photoConsent: requestedPhotoConsentFilter,
    companions: wantsCompanions,
    years: queryYears,
    pickupStatus: pickupStatusFilter,
    enrollmentAnswer: serverEnrollmentAnswer,
  } satisfies StudentSearchFilterInput & { photoState: string };
  const wholeListKey = studentKeys.search(wholeListParams);
  const listIsPartial = partialListKey === wholeListKey;
  const serverSearchTerm = listIsPartial ? searchTerm : "";
  const studentSearchParams = { ...wholeListParams, search: serverSearchTerm };
  const studentsCacheKey = studentKeys.search(studentSearchParams);

  // Any change to the result query — the server-side cache key or one of the
  // client-only filters — replaces the visual context a selection was made
  // in. Clearing keeps the invariant that a marked card is always on screen:
  // a selection hidden by a new filter must never survive into a later bulk
  // run (review #2372). Data revalidation after a bulk run does NOT change
  // this signature, so retained failure marks survive their retry window.
  // A scope change WHILE a batch is in flight is safe too: the hook defers
  // this clear until the run has been processed against the selection it
  // started from, then applies it while KEEPING the run's failed students —
  // the failure dialog promises them a one-tap retry (review #2372). The
  // new scope may HIDE those retained marks, so the selection bar (which
  // counts visible cards only) cannot be the retry surface then; the
  // failure dialog therefore carries its own retry that executes its named
  // snapshot regardless of what the current filters show (review #2372).
  const selectionScopeSignature = `${studentsCacheKey}|${searchTerm}|${effectiveEnrollmentAnswer}|${effectiveAttendanceFilter}|${encodeMultiValueParam(pickupTimeFilter)}|${arrivalTimeFilter}|${effectiveTrackingFilter}`;
  const clearCheckinSelection = schoolCheckin.clearSelection;
  useEffect(() => {
    clearCheckinSelection();
  }, [selectionScopeSignature, clearCheckinSelection]);

  // Fetch students with SWR (automatic deduplication, cancellation, and revalidation)
  const {
    data: studentsData,
    isLoading: isSearching,
    isValidating: isSearchResultValidating,
    error: studentsError,
    mutate: mutateStudents,
  } = useSWRAuth<{
    students: Student[];
    requestDate: string;
    requestIsToday: boolean;
    /**
     * Number of matching children the backend counted when the page walk could
     * not load them all, otherwise null. Never silently dropped: the list, the
     * count badge and the export scope all read the loaded rows, so a partial
     * result has to say so on screen (#2218 review).
     */
    truncatedTotal: number | null;
  }>(
    awaitsSearchFilters ? null : studentsCacheKey,
    async () => {
      const filters = buildStudentSearchFilters(studentSearchParams);

      return fetchStudentSearch(filters, selectedDate, isToday);
    },
    {
      // Keep previous data while fetching (prevents loading flash)
      keepPreviousData: true,
    },
  );

  // Whether these filters' list fits is known from its answer read without a
  // term. While that read is loading or has failed, the rows may be kept from
  // other filters and say nothing about it.
  if (
    !awaitsSearchFilters &&
    !isSearching &&
    !studentsError &&
    studentsData &&
    serverSearchTerm === ""
  ) {
    const answerIsPartial = (studentsData.truncatedTotal ?? null) !== null;
    if (answerIsPartial !== listIsPartial) {
      setPartialListKey(answerIsPartial ? wholeListKey : null);
    }
  }

  // Keep room state and room_id/room_name query params in sync without a
  // Next.js navigation, which would discard SWR data and flash the loading
  // skeleton. Merge into the existing state object instead of replacing it.
  // App Router stashes routing metadata (scroll restoration, RSC cache keys)
  // on window.history.state, and clobbering it with `{}` can degrade browser
  // back/forward into a hard reload for this entry.
  const updateRoomFilter = useCallback(
    (roomId: string, roomName: string) => {
      setSelectedRoomId(roomId);
      setSelectedRoomName(roomName);
      updateUrlParams({
        room_id: roomId,
        room_name: roomId ? roomName : "",
      });
    },
    [updateUrlParams],
  );

  const clearRoomFilter = useCallback(() => {
    updateRoomFilter("", "");
  }, [updateRoomFilter]);

  // The three multi-selects share one shape: an empty selection clears the
  // query parameter, which is what "alle" means on each of them. The dropdown
  // hands over the selected values themselves, so they are validated as a list
  // and only encoded on the way into the URL — routing them through the
  // parameter grammar first would tear a class named "A,B" in two.
  const updateSelectedYears = useCallback(
    (values: string[]) => {
      const years = keepOfferedYears(values);
      setSelectedYears(years);
      updateUrlParams({ year: encodeMultiValueParam(years) });
    },
    [updateUrlParams],
  );

  const updateSelectedSchoolClasses = useCallback(
    (values: string[]) => {
      const classes = normalizeMultiValues(values);
      setSelectedSchoolClasses(classes);
      updateUrlParams({ school_class: encodeMultiValueParam(classes) });
    },
    [updateUrlParams],
  );

  const updateSelectedGroupIds = useCallback(
    (values: string[]) => {
      const groupIds = keepValidGroupIds(values);
      setSelectedGroupIds(groupIds);
      updateUrlParams({ group_id: encodeMultiValueParam(groupIds) });
    },
    [updateUrlParams],
  );

  // Meine Gruppe und Aktuelle Aufsicht als Reiter, wenn die Schule Kinder nur
  // hier finden lässt (#1321). Ohne die Einstellung bleibt beides leer.
  const childScope = useChildScopeTabs({
    selectedGroupIds,
    roomId: effectiveRoomId,
    isToday,
    setGroupIds: updateSelectedGroupIds,
    setRoom: updateRoomFilter,
    clearRoom: clearRoomFilter,
  });

  const updateAttendanceFilter = useCallback(
    (value: StatusFilter) => {
      setAttendanceFilter(value);
      updateUrlParams({ status: value === "all" ? "" : value });
    },
    [updateUrlParams],
  );

  const updateBusFilter = useCallback(
    (value: BooleanFilter) => {
      setBusFilter(value);
      updateUrlParams({ bus: value === "all" ? "" : value });
    },
    [updateUrlParams],
  );

  const updatePhotoConsentFilter = useCallback(
    (value: BooleanFilter) => {
      setPhotoConsentFilter(value);
      updateUrlParams({ photo_consent: value === "all" ? "" : value });
    },
    [updateUrlParams],
  );

  const updateEnrollmentAnswerFilter = useCallback(
    (value: string) => {
      const next = value === "all" ? "" : value;
      setEnrollmentAnswerFilter(next);
      updateUrlParams({ enrollment_answer: next });
    },
    [updateUrlParams],
  );

  // A filter the server refused leaves the address and the saved state.
  useEffect(() => {
    if (enrollmentAnswerAccess === "denied" && enrollmentAnswerFilter) {
      updateEnrollmentAnswerFilter("");
    }
  }, [
    enrollmentAnswerAccess,
    enrollmentAnswerFilter,
    updateEnrollmentAnswerFilter,
  ]);

  const updatePickupStatusFilter = useCallback(
    (value: PickupStatusFilter) => {
      setPickupStatusFilter(value);
      updateUrlParams({ pickup_status: value === "all" ? "" : value });
    },
    [updateUrlParams],
  );

  const updatePickupTimeFilter = useCallback(
    (values: string[]) => {
      const times = normalizeMultiValues(values).filter(
        (time) => time !== "all",
      );
      setPickupTimeFilter(times);
      updateUrlParams({ pickup_time: encodeMultiValueParam(times) });
    },
    [updateUrlParams],
  );

  const updateArrivalTimeFilter = useCallback(
    (value: string) => {
      setArrivalTimeFilter(value);
      updateUrlParams({ arrival_time: value === "all" ? "" : value });
    },
    [updateUrlParams],
  );

  const updateDayStatusFilter = useCallback(
    (value: DayStatusFilter) => {
      setDayStatusFilter(value);
      updateUrlParams({ day_status: value === "all" ? "" : value });
    },
    [updateUrlParams],
  );

  const updateTrackingFilter = useCallback(
    (value: TrackingFilter) => {
      setTrackingFilter(value);
      updateUrlParams({ tracking: value === "all" ? "" : value });
    },
    [updateUrlParams],
  );

  const updateSortMode = useCallback(
    (value: SortMode) => {
      setSortMode(value);
      updateUrlParams({ sort: value === "name" ? "" : value });
    },
    [updateUrlParams],
  );

  const updateGroupMode = useCallback(
    (value: GroupMode) => {
      setGroupMode(value);
      updateUrlParams({ view: value === "none" ? "" : value });
    },
    [updateUrlParams],
  );

  const clearAllFilters = useCallback(() => {
    setSearchTerm("");
    setSearchResetKey((key) => key + 1);
    applyFilters(NO_FILTERS);
    setExplicitDate(null);
    updateUrlParams({
      ...searchPageFilterParams(NO_FILTERS),
      [DATE_QUERY_PARAM]: "",
      [SEARCH_QUERY_PARAM]: "",
    });
    removeStoredFilters(storageKey);
  }, [applyFilters, storageKey, updateUrlParams]);

  // A reload the person asked for. The counter also restarts the stall timer
  // below, so a retry gets the full waiting time again.
  const [reloadCount, setReloadCount] = useState(0);
  const reloadRequestKeyRef = useRef<string | null>(null);
  const requestReload = useCallback(() => {
    reloadRequestKeyRef.current = studentsCacheKey;
    setReloadCount((count) => count + 1);
  }, [studentsCacheKey]);
  useEffect(() => {
    if (reloadCount === 0) return;
    // A reset that changed the request key is already being fetched by SWR;
    // only the unchanged key needs a forced revalidation. mutate() bypasses
    // deduplication, so it also replaces a request that never answered.
    if (reloadRequestKeyRef.current === studentsCacheKey) {
      void mutateStudents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per requested reload; the key is read at that moment
  }, [reloadCount]);

  // Clicking "Alle Kinder" in the navigation while already here means "start
  // over": drop search, filters and date and load the list fresh (#3374). The
  // page is not remounted for that click, so without this nothing happens and
  // the stored filters are even written back into the URL.
  useSamePageLinkClick(
    useCallback(() => {
      clearAllFilters();
      requestReload();
    }, [clearAllFilters, requestReload]),
  );

  // keepPreviousData holds the previous request's rows until the new request
  // resolves. Gate every date-sensitive derivation on the response's own
  // requestDate AND today/planning mode so prior statuses, counts, and filter
  // options are never presented under the newly selected date/mode (#1939).
  // Non-date filter changes keep both tags equal, so only date OR mode switches
  // gate. The mode tag is what catches the midnight rollover: selectedDate is
  // unchanged when a future date becomes today, but requestIsToday flips, so a
  // held planning response is still recognized as stale. An untagged response
  // (requestDate absent, e.g. under test mocks) is treated as current, so this
  // never gates a real fetch — only an in-flight date/mode transition.
  const isDateTransition =
    studentsData?.requestDate !== undefined &&
    (studentsData.requestDate !== selectedDate ||
      studentsData.requestIsToday !== isToday);
  const loadedStudents = useMemo(
    () =>
      studentsData === undefined || isDateTransition
        ? EMPTY_STUDENT_ARRAY
        : studentsData.students,
    [studentsData, isDateTransition],
  );
  // The children of the list's server filters and the registration answer:
  // what every count, card and bulk action below works on, as when the server
  // applied the answer.
  const nameMatchedStudents = useMemo(() => {
    const browserTerm = serverSearchTerm ? "" : searchTerm;
    return browserTerm
      ? loadedStudents.filter(studentNameSearch(browserTerm))
      : loadedStudents;
  }, [loadedStudents, searchTerm, serverSearchTerm]);
  const students = useMemo(
    () =>
      activeEnrollmentAnswerChildren
        ? nameMatchedStudents.filter((student) =>
            activeEnrollmentAnswerChildren.has(student.id),
          )
        : nameMatchedStudents,
    [nameMatchedStudents, activeEnrollmentAnswerChildren],
  );

  // The pickup times of the loaded children. A chosen time no child has (from
  // a link, or while the list loads) stays selectable so it can be lifted, but
  // counts as outside the options: it still narrows (#6734).
  const pickupTimeOptions = useMemo<FilterOption[]>(() => {
    const loadedTimes = new Set(
      students.map((s) => s.pickup_time).filter((t): t is string => !!t),
    );
    const times = new Set([
      ...loadedTimes,
      ...pickupTimeFilter.filter((time) => time !== "none"),
    ]);
    return [
      ...Array.from(times)
        .sort((a, b) => a.localeCompare(b))
        .map((time) => ({
          value: time,
          label: `${time} Uhr`,
          ...(loadedTimes.has(time) ? {} : { outsideOptions: true }),
        })),
      { value: "none", label: "Keine Gehzeit" },
    ];
  }, [students, pickupTimeFilter]);
  // Every pickup time chosen is "alle" (#6734): no child is left out, also
  // not one without full access or with an exception.
  const queryPickupTimes = isMultiSelectRestricting(
    pickupTimeFilter,
    pickupTimeOptions,
  )
    ? pickupTimeFilter
    : NO_VALUES;

  // Gated on the same staleness check as the rows themselves: a held response
  // from the previous date must not warn about the new one.
  const truncatedTotal =
    studentsData === undefined || isDateTransition
      ? null
      : (studentsData.truncatedTotal ?? null);
  const photoConsentDataAvailable =
    photoConsentFeatureAvailable &&
    (students.length === 0 ||
      students.some(
        (student) =>
          student.has_full_access !== false &&
          student.photo_consent_given !== undefined,
      ));
  const canUsePhotoConsentFilter =
    studentPhotosSettingLoading || photoConsentDataAvailable;
  const effectivePhotoConsentFilter = canUsePhotoConsentFilter
    ? photoConsentFilter
    : "all";

  useEffect(() => {
    if (!canUsePhotoConsentFilter && photoConsentFilter !== "all") {
      updatePhotoConsentFilter("all");
    }
  }, [canUsePhotoConsentFilter, photoConsentFilter, updatePhotoConsentFilter]);

  // Tracking indicators for student cards
  // Every loaded child, not only the answer's: the answer counts apply the
  // tracking filter to the others too (#7645).
  const trackingStudentIds = useMemo(
    () => loadedStudents.map((s) => s.id),
    [loadedStudents],
  );
  const trackingStudentIdsKey = useMemo(
    () => trackingStudentIds.join(","),
    [trackingStudentIds],
  );
  // Tracking indicators (Mensa/HA) describe TODAY's activity participation.
  // Every consumer below is already gated on isToday — the filter is
  // neutralized (effectiveTrackingFilter), its option is dropped from the
  // filter set, and the card badges are not rendered — so on a planning date
  // the request is pure waste. Skip it entirely (#1939).
  const { data: trackingData } = useSWRAuth<TrackingIndicatorsResponse>(
    isToday && trackingStudentIds.length > 0
      ? tenantStudentKeys.trackingIndicators(trackingStudentIdsKey)
      : null,
    async () => activeService.getTrackingIndicators(trackingStudentIds),
    { keepPreviousData: true, revalidateOnFocus: false },
  );

  // Reset tracking filter if labels vanish or the selected label index becomes stale.
  // Without this, the active-filter chip (guarded by trackingData.labels) can hide
  // while trackingFilter remains set, leaving an invisible filter applied.
  const trackingLabels = trackingData?.labels;
  useEffect(() => {
    const next = resolveTrackingFilterAfterLabelChange(
      trackingFilter,
      trackingData,
    );
    if (next !== trackingFilter) updateTrackingFilter(next);
  }, [trackingData, trackingFilter, updateTrackingFilter]);

  // Ein Ladefehler kommt über den gemeinsamen Fehlerweg (#2513): Text aus dem
  // Katalog nach Code und Klasse, Vorgangskennung bei Serverfehlern, eine
  // abgelaufene Sitzung führt zur Anmeldung. Fehlende Rechte erkennt die
  // Seite am Status, nie am Meldungstext.
  const load = useApiLoadError();
  const showLoadError = load.show;
  const clearLoadError = load.clear;
  const reloadStudentsRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (studentsError) {
      void showLoadError(studentsError, {
        object: "die Liste der Kinder",
        retry: () => reloadStudentsRef.current(),
      });
    } else {
      clearLoadError();
    }
  }, [studentsError, showLoadError, clearLoadError]);
  const isPermissionError =
    studentsError instanceof ApiError && studentsError.status === 403;
  const hasLoadError = studentsError !== undefined && studentsError !== null;

  // Fix P1: Detect when auth prevents fetching (user can't fetch but no error from SWR)
  const canFetch = status === "authenticated" && hasSessionAccess(session);
  const isAuthError = !canFetch && !studentsError && status !== "loading";

  // Fix P2: Track initialization state to prevent empty state flash
  // Only wait for session - user context loads in parallel (for badge styling only)
  const isInitializing = status === "loading";
  const hasFetchedOnce =
    studentsData !== undefined || studentsError !== undefined;
  // Zähler gibt es nur aus Zeilen, die für das gewählte Datum geladen sind:
  // hasFetchedOnce ist auch nach einem Fehler wahr (#2517).
  const rowsLoaded = studentsData !== undefined && !isDateTransition;

  // Show the skeleton while the session is still resolving, while the first
  // fetch is in progress (not yet hasFetchedOnce), or while a date switch is in
  // flight: keepPreviousData still holds the previous day's rows, so show the
  // skeleton instead of presenting them under the newly selected date (#1939).
  // A fetch error wins, though: when the new date's request fails,
  // keepPreviousData keeps the stale response so isDateTransition stays true.
  // Without this guard the page would show the skeleton indefinitely instead
  // of the error and its recovery guidance (#1939).
  const showGridSkeleton =
    isInitializing ||
    isAuthError ||
    awaitsSearchFilters ||
    (!hasLoadError && ((isSearching && !hasFetchedOnce) || isDateTransition));

  // The stall is tied to the request it was measured for, so a new key or a
  // requested reload starts over without resetting state from an effect.
  const loadAttemptSignature = `${studentsCacheKey}|${reloadCount}`;
  const [stalledAttempt, setStalledAttempt] = useState<string | null>(null);
  // useSWRAuth disables its key until the session is resolved, so there is no
  // student request to measure during initialization. A resolved session
  // without a token remains covered by the recovery path in reloadStudents.
  const shouldMeasureLoadStall = showGridSkeleton && !isInitializing;
  useEffect(() => {
    if (!shouldMeasureLoadStall) return;
    const timeout = setTimeout(
      () => setStalledAttempt(loadAttemptSignature),
      LOADING_STALL_MS,
    );
    return () => clearTimeout(timeout);
  }, [shouldMeasureLoadStall, loadAttemptSignature]);
  const loadingStalled =
    shouldMeasureLoadStall && stalledAttempt === loadAttemptSignature;

  const reloadStudents = useCallback(() => {
    // Without a token no student request can start; ask for the session again
    // so the list can load once it is back.
    if (isAuthError) void updateSession();
    requestReload();
  }, [isAuthError, requestReload, updateSession]);
  useLayoutEffect(() => {
    reloadStudentsRef.current = reloadStudents;
  });
  const reloadAction = (
    <Button
      type="button"
      variant="outline"
      size="md"
      onClick={reloadStudents}
      tooltip="Versucht noch einmal, die Liste der Kinder zu laden."
    >
      Erneut laden
    </Button>
  );

  // SSE is handled globally by TenantAuthWrapper - no page-level setup needed.
  // When student_checkin/checkout events occur, global SSE invalidates "student*" caches,
  // which triggers SWR refetch for search-students-* keys automatically.

  // Prepare filter configurations for the TenantPage search row
  const orderedRoomOptions = useMemo(
    () => orderedRooms(rooms, myGroupRooms, mySupervisedRooms),
    [rooms, myGroupRooms, mySupervisedRooms],
  );

  // These filters are applied after the backend result. The transit card uses
  // the unfiltered loaded result because its target cannot apply these
  // client-side filters.
  const matchesNonStatusClientFilters = useCallback(
    (student: Student) => {
      if (
        dayStatusFilter !== "all" &&
        student.day_planning_status !== dayStatusFilter
      ) {
        return false;
      }

      // The school year (#2218), like bus / photo_consent / pickup_status below,
      // is filtered server-side now, so the fetched page is already the filtered
      // set and re-filtering here would only risk the two grammars drifting.

      // bus / photo_consent / pickup_status (#1492) are filtered server-side now
      // (see api/students applyAdministrativeFilters), so the page no longer
      // re-filters them here. The fetched page is already the filtered set.

      // Apply pickup time filter. For redacted students, missing pickup_time
      // due to has_full_access=false is not the same as "no schedule")
      if (queryPickupTimes.length > 0) {
        if (student.has_full_access === false) return false;
        const matchesPickupTime = queryPickupTimes.some((time) =>
          time === "none"
            ? !student.pickup_time && !student.pickup_is_exception
            : student.pickup_time === time,
        );
        if (!matchesPickupTime) return false;
      }

      if (arrivalTimeFilter !== "all") {
        if (student.has_full_access === false) return false;
        if (arrivalTimeFilter === "none") {
          if (student.arrival_time || student.arrival_is_exception)
            return false;
        } else if (student.arrival_time !== arrivalTimeFilter) {
          return false;
        }
      }

      if (
        !matchesTrackingFilter(student, effectiveTrackingFilter, trackingData)
      ) {
        return false;
      }

      return true;
    },
    [
      dayStatusFilter,
      queryPickupTimes,
      arrivalTimeFilter,
      effectiveTrackingFilter,
      trackingData,
    ],
  );

  // Apply additional client-side filtering for attendance statuses and year.
  const matchesClientFilters = useCallback(
    (student: Student) => {
      // Apply attendance filter (neutralized for non-today planning dates)
      if (effectiveAttendanceFilter !== "all") {
        const isOnSite =
          isPresentLocation(student.current_location) ||
          isTransitLocation(student.current_location) ||
          isSchoolyardLocation(student.current_location);

        // Ein Ort, den keine andere Statusgruppe kennt, zählt wie in
        // statusLabelForStudent als anwesend; sonst fiele das Kind durch jeden
        // Statusfilter (#4588).
        if (
          effectiveAttendanceFilter === "anwesend" &&
          !isOnSite &&
          statusLabelForStudent(student) !== "Anwesend"
        ) {
          return false;
        }

        if (
          effectiveAttendanceFilter !== "anwesend" &&
          (effectiveAttendanceFilter === "entschuldigt-klassenfahrt"
            ? !["Entschuldigt", "Klassenfahrt"].includes(
                statusLabelForStudent(student),
              )
            : statusLabelForStudent(student) !==
              STATUS_FILTER_LABELS[effectiveAttendanceFilter])
        ) {
          return false;
        }
      }

      return matchesNonStatusClientFilters(student);
    },
    [effectiveAttendanceFilter, matchesNonStatusClientFilters],
  );
  const filteredStudents = useMemo(
    () => students.filter(matchesClientFilters),
    [students, matchesClientFilters],
  );

  // The answers of the registration form as one choice each (#6954):
  // "Seepferdchen vorhanden: Ja (12)". The number is the children the list
  // would show with that answer under its other filters (#7645). Until the
  // rows are loaded, or while the server applies an answer it no longer
  // offers, the page cannot count that and shows no number. An active answer
  // the list no longer offers (no child gave it any more) stays selectable so
  // it can be undone.
  const enrollmentAnswerOptions = useMemo(() => {
    const shown =
      rowsLoaded && serverEnrollmentAnswer === ""
        ? new Set(
            nameMatchedStudents
              .filter(matchesClientFilters)
              .map((student) => student.id),
          )
        : null;
    const options = enrollmentAnswerQuestions.flatMap((question) =>
      question.options.map((option) => {
        const answer = `${answerQuestionLabel(question.label)}: ${option.label}`;
        return {
          value: enrollmentAnswerValue(question, option),
          label: shown
            ? `${answer} (${option.studentIds.filter((id) => shown.has(id)).length})`
            : answer,
          chip: answer,
        };
      }),
    );
    if (
      effectiveEnrollmentAnswer &&
      !options.some((option) => option.value === effectiveEnrollmentAnswer)
    ) {
      options.push({
        value: effectiveEnrollmentAnswer,
        label: "Gewählte Angabe aus der Anmeldung",
        chip: "Angabe aus der Anmeldung",
      });
    }
    return options;
  }, [
    enrollmentAnswerQuestions,
    effectiveEnrollmentAnswer,
    rowsLoaded,
    serverEnrollmentAnswer,
    nameMatchedStudents,
    matchesClientFilters,
  ]);

  // Grouping for the quiet filter popover. Lives here, not in the shared
  // panel: which student filters belong together is this page's domain
  // knowledge. Any id not listed falls into a trailing "Weitere" section.
  const filterSections: FilterSection[] = useMemo(
    () => [
      {
        title: "Organisation",
        icon: DetailIcons.building,
        filterIds: ["year", "schoolClass", "group", "room"],
      },
      {
        title: "Anwesenheit",
        icon: DetailIcons.check,
        filterIds: ["planningDate", "dayStatus", "attendance", "tracking"],
      },
      {
        title: "Zeiten & Abholung",
        icon: DetailIcons.bus,
        filterIds: [
          "arrivalTime",
          "pickupTime",
          "pickupStatus",
          "bus",
          "photoConsent",
        ],
      },
      {
        title: "Anmeldung",
        icon: DetailIcons.notes,
        filterIds: ["enrollmentAnswer"],
      },
      {
        title: "Darstellung",
        icon: DetailIcons.document,
        filterIds: ["sort", "groupMode"],
      },
    ],
    [],
  );

  // App (#8070): Kinder als Zeilenliste mit Kind-Blatt. Der An- und
  // Abmeldemodus behält seine Karten; die Ansichtswahl gilt nur am Desktop.
  const device = useDeviceContext();
  const appView = device.resolved && device.isApp;
  const filterConfigs: FilterConfig[] = useMemo(
    () => [
      // Stufe / Klasse / Gruppe are multi-selects (#2218). None of them carries
      // an "Alle …" option any more: an empty selection already means that, and
      // a checkable neutral entry would let a user select "Alle Klassen" AND
      // "3a" at the same time.
      {
        id: "year",
        label: "Stufe",
        type: "dropdown",
        multiSelect: true,
        emptyLabel: "Alle Stufen",
        summaryLabel: (count) => `${count} Stufen`,
        value: selectedYears,
        onChange: (value) => updateSelectedYears(asFilterValues(value)),
        options: SCHOOL_YEAR_MULTI_OPTIONS,
      },
      {
        id: "schoolClass",
        label: "Klasse",
        type: "dropdown",
        multiSelect: true,
        emptyLabel: "Alle Klassen",
        summaryLabel: (count) => `${count} Klassen`,
        value: selectedSchoolClasses,
        onChange: (value) => updateSelectedSchoolClasses(asFilterValues(value)),
        options: [
          ...schoolClassOptions.map((schoolClass) => ({
            value: schoolClass,
            label: schoolClass,
          })),
          // A class restored from a link may not be among today's options (it
          // has no children right now), and none is while the class list
          // loads or failed to load. Keep it selectable so the restriction
          // stays visible and can be lifted; it still counts as one.
          ...selectedSchoolClasses
            .filter((schoolClass) => !schoolClassOptions.includes(schoolClass))
            .map((schoolClass) => ({
              value: schoolClass,
              label: schoolClass,
              outsideOptions: true,
            })),
        ],
      },
      {
        id: "group",
        label: "Gruppe",
        type: "dropdown",
        multiSelect: true,
        emptyLabel: "Alle Gruppen",
        summaryLabel: (count) => `${count} Gruppen`,
        value: selectedGroupIds,
        onChange: (value) => updateSelectedGroupIds(asFilterValues(value)),
        options: groups.map((group) => ({
          value: group.id,
          label: group.name,
        })),
      },
      // The room filter reads current visits — today-only by nature (#1939).
      ...(isToday
        ? [
            {
              id: "room",
              label: "Raum",
              type: "dropdown" as const,
              value: selectedRoomId,
              onChange: (value: string | string[]) => {
                const v = Array.isArray(value) ? value[0] : value;
                if (!v) {
                  clearRoomFilter();
                  return;
                }
                const room = rooms.find((r) => r.id === v);
                updateRoomFilter(
                  v,
                  room?.name ?? (v === selectedRoomId ? selectedRoomName : ""),
                );
              },
              options: [
                { value: "", label: "Alle Räume" },
                ...orderedRoomOptions.map((room) => ({
                  value: room.id,
                  label: room.name,
                })),
                ...(selectedRoomId &&
                !orderedRoomOptions.some((room) => room.id === selectedRoomId)
                  ? [
                      {
                        value: selectedRoomId,
                        label: selectedRoomName || `Raum #${selectedRoomId}`,
                      },
                    ]
                  : []),
              ],
            },
          ]
        : []),
      {
        id: "pickupTime",
        label: "Gehzeit",
        type: "dropdown",
        multiSelect: true,
        emptyLabel: "Alle Gehzeiten",
        summaryLabel: (count) => `${count} Gehzeiten`,
        value: pickupTimeFilter,
        onChange: (value) => updatePickupTimeFilter(asFilterValues(value)),
        options: pickupTimeOptions,
      },
      {
        id: "arrivalTime",
        label: "Ankunftszeit",
        type: "dropdown",
        value: arrivalTimeFilter,
        onChange: (value) => updateArrivalTimeFilter(value as string),
        options: [
          { value: "all", label: "Alle Ankunftszeiten" },
          ...Array.from(
            new Set(
              students
                .map((s) => s.arrival_time)
                .filter((t): t is string => !!t),
            ),
          )
            .sort((a, b) => a.localeCompare(b))
            .map((time) => ({ value: time, label: `${time} Uhr` })),
          { value: "none", label: "Keine Ankunftszeit" },
        ],
      },
      // Planning-day chooser (#1939). A custom filter so it lives *inside* the
      // "Anwesenheit" section, directly above the Kommt/Kommt-nicht filter it
      // scopes — the date is the reference day for that filter, not a separate
      // mode. Spans both grid columns so the inline calendar has room. Empty
      // value/onChange/options are the required-but-unused stubs for a custom
      // filter (see FilterConfig.render).
      {
        id: "planningDate",
        label: "Tag",
        type: "custom" as const,
        value: "",
        onChange: () => undefined,
        options: [],
        className: "md:col-span-2",
        render: (
          <div className="space-y-2">
            {/* Telefon (#8070): 8 px zwischen den Tag-Knöpfen wie zwischen
                allen Chips der App. */}
            <div className="app:gap-2 flex flex-wrap gap-1.5">
              <Button
                type="button"
                {...dayChoice(isToday, appView)}
                onClick={() => updateSelectedDate(todayIso)}
                tooltip="Zeigt, wo die Kinder heute gerade sind."
              >
                Heute
              </Button>
              {/* On a Sunday the horizon closes with today (see
                  maxPlanningIso), so tomorrow is not selectable — hide the
                  shortcut instead of offering one that clamps back to today. */}
              {tomorrowIso <= maxDateIso && (
                <Button
                  type="button"
                  {...dayChoice(selectedDate === tomorrowIso, appView)}
                  onClick={() => updateSelectedDate(tomorrowIso)}
                  tooltip="Zeigt, welche Kinder morgen laut Plan kommen."
                >
                  Morgen
                </Button>
              )}
            </div>
            <DatePicker
              value={parseISODate(selectedDate)}
              minDate={parseISODate(todayIso)}
              maxDate={parseISODate(maxDateIso)}
              calendarLayout="popover"
              onChange={(date) =>
                updateSelectedDate(date ? toISODate(date) : todayIso)
              }
            />
            {!isToday && (
              <p className="text-xs text-gray-500">
                Geplante Anwesenheit für {formatDate(selectedDate, true)},
                basierend auf Anwesenheits- und Betreuungsplänen sowie
                gemeldeten Abwesenheiten. Aktuelle Aufenthaltsorte und
                Live-Filter bleiben ausgeblendet.
              </p>
            )}
          </div>
        ),
      },
      {
        id: "dayStatus",
        label: isToday ? "Tagesplanung" : "Kommt / Kommt nicht",
        type: "dropdown",
        value: dayStatusFilter,
        onChange: (value) => updateDayStatusFilter(value as DayStatusFilter),
        options: dayStatusFilterOptions,
      },
      // The location-derived buckets read current whereabouts and drop out for
      // another day; the absence buckets follow the selected date (#1939).
      {
        id: "attendance",
        label: "Status",
        type: "dropdown" as const,
        value: effectiveAttendanceFilter,
        onChange: (value: string | string[]) =>
          updateAttendanceFilter(value as StatusFilter),
        options: [
          // Handy: Das Blatt nennt den Abschnitt „Status“ schon; „Alle
          // Status“ läse sich dort doppelt.
          { value: "all", label: appView ? "Alle" : "Alle Status" },
          ...(isToday ? LIVE_STATUS_FILTER_OPTIONS : []),
          ...PLANNED_ABSENCE_STATUS_FILTER_OPTIONS,
        ],
      },
      {
        id: "bus",
        label: "Buskind",
        type: "dropdown",
        value: busFilter,
        onChange: (value) => updateBusFilter(value as BooleanFilter),
        options: BUS_FILTER_OPTIONS,
      },
      ...(canUsePhotoConsentFilter
        ? [
            {
              id: "photoConsent",
              label: "Fotoerlaubnis",
              type: "dropdown" as const,
              value: photoConsentFilter,
              onChange: (value: string | string[]) =>
                updatePhotoConsentFilter(value as BooleanFilter),
              options: PHOTO_CONSENT_FILTER_OPTIONS,
            },
          ]
        : []),
      ...(enrollmentAnswerOptions.length > 0
        ? [
            {
              id: "enrollmentAnswer",
              label: "Angabe aus der Anmeldung",
              type: "dropdown" as const,
              // "Frage: Antwort (Zahl)" is long; on a phone the answer and
              // its count must stay visible (#7012).
              wrapLabels: true,
              value: effectiveEnrollmentAnswer || "all",
              onChange: (value: string | string[]) =>
                updateEnrollmentAnswerFilter(value as string),
              options: [
                { value: "all", label: "Alle Angaben" },
                ...enrollmentAnswerOptions.map(({ value, label }) => ({
                  value,
                  label,
                })),
              ],
            },
          ]
        : []),
      {
        id: "pickupStatus",
        label: "Abholregelung",
        type: "dropdown",
        value: pickupStatusFilter,
        onChange: (value) =>
          updatePickupStatusFilter(value as PickupStatusFilter),
        options: PICKUP_STATUS_FILTER_OPTIONS,
      },
      {
        id: "sort",
        label: "Sortierung",
        type: "dropdown",
        value: sortMode,
        onChange: (value) => updateSortMode(value as SortMode),
        options: SORT_OPTIONS,
      },
      {
        id: "groupMode",
        // Nicht „Ansicht“: das ist der Umschalter Kacheln/Liste (#3834).
        label: "Gruppieren",
        type: "dropdown",
        value: effectiveGroupMode,
        onChange: (value) => updateGroupMode(value as GroupMode),
        // Status/room grouping reads current whereabouts — today-only (#1939).
        options: isToday
          ? GROUP_OPTIONS
          : GROUP_OPTIONS.filter(
              (option) => option.value !== "status" && option.value !== "room",
            ),
      },
      ...(isToday && trackingLabels && trackingLabels.length > 0
        ? [
            {
              id: "tracking",
              label: "Aktivitäten heute",
              type: "dropdown" as const,
              value: trackingFilter,
              onChange: (value: string | string[]) =>
                updateTrackingFilter(value as TrackingFilter),
              options: [
                { value: "all", label: "Alle Aktivitäten heute" },
                ...trackingLabels.map((lbl, idx) => ({
                  value: `missing:${idx}`,
                  label: `Noch nicht in ${lbl}`,
                })),
                { value: "none_visited", label: "Noch nichts erledigt" },
              ],
            },
          ]
        : []),
    ],
    [
      appView,
      selectedYears,
      selectedSchoolClasses,
      selectedGroupIds,
      pickupTimeFilter,
      pickupTimeOptions,
      arrivalTimeFilter,
      busFilter,
      photoConsentFilter,
      pickupStatusFilter,
      canUsePhotoConsentFilter,
      enrollmentAnswerOptions,
      effectiveEnrollmentAnswer,
      updateEnrollmentAnswerFilter,
      dayStatusFilter,
      trackingFilter,
      trackingLabels,
      groups,
      schoolClassOptions,
      rooms,
      students,
      selectedRoomId,
      selectedRoomName,
      orderedRoomOptions,
      clearRoomFilter,
      updateRoomFilter,
      sortMode,
      updateSelectedYears,
      updateSelectedSchoolClasses,
      updateSelectedGroupIds,
      updateAttendanceFilter,
      updateBusFilter,
      updatePhotoConsentFilter,
      updatePickupStatusFilter,
      updatePickupTimeFilter,
      updateArrivalTimeFilter,
      updateDayStatusFilter,
      updateTrackingFilter,
      updateSortMode,
      updateGroupMode,
      isToday,
      dayStatusFilterOptions,
      effectiveAttendanceFilter,
      effectiveGroupMode,
      selectedDate,
      todayIso,
      tomorrowIso,
      maxDateIso,
      updateSelectedDate,
    ],
  );

  // Prepare active filters for display
  const activeFilters: ActiveFilter[] = useMemo(() => {
    const filters: ActiveFilter[] = [];
    // A multi-select with every option chosen means "alle", like an empty one,
    // and carries no chip and no count (#6734). Read against the options the
    // control shows, so a selected value outside them still counts.
    const restricting = restrictingFilterIds(filterConfigs);

    if (searchTerm) {
      filters.push({
        id: "search",
        label: `"${searchTerm}"`,
        onRemove: () => updateSearchTerm(""),
      });
    }

    // A non-today planning day is an active filter state (#1939): it re-scopes
    // the Kommt/Kommt-nicht filter and the whole list to another day. Surface
    // it so the filter-count badge accounts for it; removing it returns to
    // today.
    if (!isToday) {
      filters.push({
        id: "planningDate",
        label: `Tag: ${formatDate(selectedDate, true)}`,
        onRemove: () => updateSelectedDate(todayIso),
      });
    }

    // One chip per filter names every selected value, so a two-class selection
    // stays readable without turning the chip row into a list of ten pills.
    if (restricting.has("year")) {
      filters.push({
        id: "year",
        label: `Jahr ${selectedYears.join(", ")}`,
        onRemove: () => updateSelectedYears([]),
      });
    }

    if (restricting.has("schoolClass")) {
      filters.push({
        id: "schoolClass",
        label: schoolClassesLabel(selectedSchoolClasses),
        onRemove: () => updateSelectedSchoolClasses([]),
      });
    }

    if (restricting.has("group")) {
      const groupNames = selectedGroupIds.map(
        (groupId) => groups.find((g) => g.id === groupId)?.name ?? "Gruppe",
      );
      filters.push({
        id: "group",
        label: groupNames.join(", "),
        onRemove: () => updateSelectedGroupIds([]),
      });
    }

    if (effectiveRoomId) {
      // Fall back to "Raum #{id}" when no room_name was passed in the URL
      // (e.g. an old bookmark), better than rendering an empty chip.
      const label = selectedRoomName
        ? `Raum: ${selectedRoomName}`
        : `Raum #${effectiveRoomId}`;
      filters.push({
        id: "room",
        label,
        onRemove: clearRoomFilter,
      });
    }

    if (effectiveAttendanceFilter !== "all") {
      filters.push({
        id: "attendance",
        label: STATUS_FILTER_LABELS[effectiveAttendanceFilter],
        onRemove: () => updateAttendanceFilter("all"),
      });
    }

    if (busFilter !== "all") {
      filters.push({
        id: "bus",
        label: busFilter === "yes" ? "Buskind" : "Kein Buskind",
        onRemove: () => updateBusFilter("all"),
      });
    }

    if (effectivePhotoConsentFilter !== "all") {
      filters.push({
        id: "photoConsent",
        label:
          effectivePhotoConsentFilter === "yes"
            ? "Fotoerlaubnis liegt vor"
            : "Keine Fotoerlaubnis",
        onRemove: () => updatePhotoConsentFilter("all"),
      });
    }

    if (pickupStatusFilter !== "all") {
      filters.push({
        id: "pickupStatus",
        label:
          PICKUP_STATUS_FILTER_OPTIONS.find(
            (option) => option.value === pickupStatusFilter,
          )?.label ?? "Abholregelung",
        onRemove: () => updatePickupStatusFilter("all"),
      });
    }

    if (effectiveEnrollmentAnswer) {
      filters.push({
        id: "enrollmentAnswer",
        label:
          enrollmentAnswerOptions.find(
            (option) => option.value === effectiveEnrollmentAnswer,
          )?.chip ?? "Angabe aus der Anmeldung",
        onRemove: () => updateEnrollmentAnswerFilter(""),
      });
    }

    if (dayStatusFilter !== "all") {
      filters.push({
        id: "dayStatus",
        label:
          dayStatusFilterOptions.find(
            (option) => option.value === dayStatusFilter,
          )?.label ?? dayStatusFilter,
        onRemove: () => updateDayStatusFilter("all"),
      });
    }

    for (const time of restricting.has("pickupTime") ? pickupTimeFilter : []) {
      filters.push({
        id: `pickupTime-${time}`,
        label: time === "none" ? "Keine Gehzeit" : `Gehzeit ${time} Uhr`,
        onRemove: () =>
          updatePickupTimeFilter(
            pickupTimeFilter.filter((value) => value !== time),
          ),
      });
    }

    if (arrivalTimeFilter !== "all") {
      filters.push({
        id: "arrivalTime",
        label:
          arrivalTimeFilter === "none"
            ? "Keine Ankunftszeit"
            : `Ankunftszeit ${arrivalTimeFilter} Uhr`,
        onRemove: () => updateArrivalTimeFilter("all"),
      });
    }

    if (trackingLabels && isToday) {
      const chipLabel = trackingFilterChipLabel(trackingFilter, trackingLabels);
      if (chipLabel !== null) {
        filters.push({
          id: "tracking",
          label: chipLabel,
          onRemove: () => updateTrackingFilter("all"),
        });
      }
    }

    if (sortMode !== "name") {
      filters.push({
        id: "sort",
        label:
          SORT_OPTIONS.find((option) => option.value === sortMode)?.label ??
          "Sortierung",
        onRemove: () => updateSortMode("name"),
      });
    }

    if (effectiveGroupMode !== "none") {
      filters.push({
        id: "groupMode",
        label: `Gruppiert: ${
          GROUP_OPTIONS.find((option) => option.value === effectiveGroupMode)
            ?.label ?? "Gruppiert"
        }`,
        onRemove: () => updateGroupMode("none"),
      });
    }

    return filters;
  }, [
    filterConfigs,
    searchTerm,
    updateSearchTerm,
    selectedYears,
    selectedSchoolClasses,
    selectedGroupIds,
    busFilter,
    effectivePhotoConsentFilter,
    pickupStatusFilter,
    effectiveEnrollmentAnswer,
    enrollmentAnswerOptions,
    updateEnrollmentAnswerFilter,
    dayStatusFilter,
    pickupTimeFilter,
    arrivalTimeFilter,
    trackingFilter,
    trackingLabels,
    groups,
    selectedRoomName,
    sortMode,
    clearRoomFilter,
    updateSelectedYears,
    updateSelectedSchoolClasses,
    updateSelectedGroupIds,
    updateAttendanceFilter,
    updateBusFilter,
    updatePhotoConsentFilter,
    updatePickupStatusFilter,
    updateDayStatusFilter,
    updatePickupTimeFilter,
    updateArrivalTimeFilter,
    updateTrackingFilter,
    updateSortMode,
    updateGroupMode,
    isToday,
    dayStatusFilterOptions,
    effectiveAttendanceFilter,
    effectiveRoomId,
    effectiveGroupMode,
    selectedDate,
    todayIso,
    updateSelectedDate,
  ]);

  const exportFilters = useMemo(
    () => ({
      search: searchTerm,
      group_ids: [...queryGroupIds],
      year: queryYears.length > 0 ? encodeMultiValueParam(queryYears) : "all",
      // Preserve class names containing commas as one selection.
      school_class: encodeMultiValueParam(querySchoolClasses),
      // The realtime snapshot/room filters are neutral for non-today dates —
      // the export must mirror what the page shows (#1939).
      status: effectiveAttendanceFilter,
      bus: busFilter,
      photo_consent: effectivePhotoConsentFilter,
      pickup_status: pickupStatusFilter,
      enrollment_answer: effectiveEnrollmentAnswer,
      day_status: dayStatusFilter,
      ...(isToday ? {} : { date: selectedDate }),
      pickup_time: encodeMultiValueParam(queryPickupTimes),
      arrival_time: arrivalTimeFilter,
      room_id: effectiveRoomId,
      sort: sortMode,
    }),
    [
      searchTerm,
      queryGroupIds,
      queryYears,
      querySchoolClasses,
      effectiveAttendanceFilter,
      busFilter,
      effectivePhotoConsentFilter,
      pickupStatusFilter,
      effectiveEnrollmentAnswer,
      dayStatusFilter,
      isToday,
      selectedDate,
      queryPickupTimes,
      arrivalTimeFilter,
      effectiveRoomId,
      sortMode,
    ],
  );

  // Apply sort mode (name = stable A-Z; arrival/pickup = daily operational order)
  const sortedStudents = useMemo(() => {
    if (sortMode === "name") return [...filteredStudents].sort(compareByName);

    return [...filteredStudents].sort((a, b) => {
      if (sortMode === "pickup") {
        return compareByPickupTime(a, b, planningNow, isToday);
      }

      // Whether a child has checked in yet only orders today's list; for a
      // non-today planning date the live location is irrelevant.
      if (isToday) {
        const aHome = isNotCheckedInLocation(a.current_location);
        const bHome = isNotCheckedInLocation(b.current_location);
        if (!aHome && bHome) return 1;
        if (aHome && !bHome) return -1;
      }

      const statusA = getStudentTimeStatus({
        plannedTime: a.arrival_time,
        actualTime: a.actual_arrival_time,
        now: planningNow,
        kind: "arrival",
        day: getStudentDayTimes(a, { ignoreCurrentAttendance: !isToday }),
        sick: a.sick,
        classTrip: a.class_trip,
        excused: a.excused,
        currentLocation: isToday ? a.current_location : null,
      });
      const statusB = getStudentTimeStatus({
        plannedTime: b.arrival_time,
        actualTime: b.actual_arrival_time,
        now: planningNow,
        kind: "arrival",
        day: getStudentDayTimes(b, { ignoreCurrentAttendance: !isToday }),
        sick: b.sick,
        classTrip: b.class_trip,
        excused: b.excused,
        currentLocation: isToday ? b.current_location : null,
      });
      const rankA = getTimeStatusSortRank(statusA);
      const rankB = getTimeStatusSortRank(statusB);
      if (rankA !== rankB) return rankA - rankB;

      if (a.arrival_time && b.arrival_time) {
        const timeCmp = a.arrival_time.localeCompare(b.arrival_time);
        if (timeCmp !== 0) return timeCmp;
      }
      return compareByName(a, b);
    });
  }, [filteredStudents, sortMode, planningNow, isToday]);

  // The students currently marked in the selection sub-mode (#2359). Derived
  // from the VISIBLE rows (client-side filters applied), never the raw fetch:
  // confirmation counts and the executed batch must cover exactly the cards
  // on screen, or a mark hidden by a filter could be acted on sight-unseen
  // (review #2372). The selection bars' count/activation must come from this
  // list too — selectedIds may still hold students a live update removed,
  // and a count the bar shows must never exceed what a bulk action executes.
  // Statuszeile unter dem Seitentitel, allein aus der bereits geladenen
  // Kinderliste: Gesamtzahl, wie viele in der OGS sind, wie viele krank. Ohne
  // geladene Liste für das gewählte Datum steht keine "0 Kinder" neben dem
  // Ladefehler (#2517).
  // Höchstens drei Angaben trägt die Statuszeile (#7402). Krank bleibt: die
  // Zahl ist sicherheitsrelevant und steht sonst nirgends ohne Weiteres. In
  // der Schule, im Unterricht und zuhause zählt die Liste selbst: gruppiert
  // „Nach Status“ steht die Zahl an jeder Gruppe.
  const studentSummary = useMemo(() => {
    if (!rowsLoaded) return null;
    const total = students.length;
    if (!isToday) {
      // App (#8070): Die Gesamtzahl steht wie am Desktop als Zähler in der
      // Suchzeile; ohne Tageszahlen bleibt die Titelzeile frei.
      if (appView) return null;
      return {
        summary: `${total} ${total === 1 ? "Kind" : "Kinder"}`,
        compact: null,
      };
    }
    // Ein eingechecktes Kind zählt „in der OGS“, auch wenn es krank gemeldet
    // ist (Ort vor Status, #6371). Entschuldigt oder auf Klassenfahrt zählt
    // weder krank noch in der OGS.
    let sick = 0;
    // In der OGS: in einem Raum, auf dem Schulhof oder unterwegs. Ohne diese
    // Zahl stünde unter „Meine Aufsicht“ „7 Kinder, 0 krank“, obwohl alle
    // sieben im Raum sind (#1321); die frühere Gruppenseite zeigte sie als
    // „X von Y da“.
    let inCare = 0;
    for (const student of students) {
      const dayStatus = countedDayStatus(student);
      if (dayStatus === "sick") {
        sick += 1;
        continue;
      }
      if (dayStatus !== null) continue;
      const status = parseLocation(student.current_location).status;
      if (status === LOCATION_STATUSES.SICK) {
        sick += 1;
        continue;
      }
      if (
        status === LOCATION_STATUSES.EXCUSED ||
        status === LOCATION_STATUSES.CLASS_TRIP
      ) {
        continue;
      }
      if (
        status === LOCATION_STATUSES.PRESENT ||
        status === LOCATION_STATUSES.UNPLANNED_PRESENT ||
        status === LOCATION_STATUSES.SCHOOLYARD ||
        status === LOCATION_STATUSES.TRANSIT
      ) {
        inCare += 1;
      }
    }
    // App (#8070): Die Chips stehen in der Titelzeile neben „Alle Kinder“,
    // also kurz: „16 von 118 da · 0 krank“. Die Gesamtzahl steht im ersten
    // Chip statt als zweiter, knopfartiger Zähler neben dem Filter. „krank“
    // steht wie am Desktop immer im Kopf, auch mit 0 (Runde 21).
    const summary = (
      <TenantPageStats
        items={
          appView
            ? [
                { value: inCare, label: `von ${total} da` },
                { value: sick, label: "krank" },
              ]
            : [
                { value: total, label: total === 1 ? "Kind" : "Kinder" },
                { value: inCare, label: "in der OGS" },
                { value: sick, label: "krank" },
              ]
        }
      />
    );
    // Schmaler Kopf beim Rollen: ein Kurzstatus, die Zahl der Kinder, die
    // da sind; daneben brauchen Lupe und Filter ihren Platz.
    const compact = appView ? (
      <TenantPageStats items={[{ value: inCare, label: "da" }]} />
    ) : null;
    return { summary, compact };
  }, [isToday, students, rowsLoaded, appView]);

  const selectedStudentsForBulk = useMemo(
    () =>
      filteredStudents.filter((student) =>
        schoolCheckin.selectedIds.has(student.id.toString()),
      ),
    [filteredStudents, schoolCheckin.selectedIds],
  );

  // „Elternbrief schreiben" (#4779): übernimmt die gefilterte Liste als
  // einzelne Kinder in den Verfasser. Die Auswahl ist ein Schnappschuss dieses
  // Moments, kein mitlaufender Filter; ändert sich später ein Merkmal, bleibt
  // der Brief bei diesen Kindern. Namen reisen über die Ablage, nie in der URL.
  const parentAnnouncementsAvailable = useParentAnnouncementsAvailable();
  const tenantSlug = useTenantSlugSafe();
  const writeParentLetter = () => {
    const token = tenantSlug
      ? stashAnnouncementStudents(
          tenantSlug,
          filteredStudents.map((student) => ({
            id: student.id.toString(),
            name: student.name,
          })),
        )
      : null;
    router.push(announcementPrefillPath(token, KIND_PARAM.letter));
  };

  // „Alle N auswählen“ of the check-in mode (#4762): the cards on screen,
  // without the children who are absent today.
  const selectAllPlan = useMemo(
    () => planSelectAll(filteredStudents),
    [filteredStudents],
  );
  const setCheckinSelected = schoolCheckin.setSelected;
  const checkinSelectAll: SelectAllControl = {
    count: selectAllPlan.ids.length,
    leftOutCount: selectAllPlan.leftOutCount,
    allSelected: selectAllPlan.ids.every((id) =>
      schoolCheckin.selectedIds.has(id),
    ),
    onSelectAll: () => setCheckinSelected(selectAllPlan.ids, true),
  };

  // After a bulk Anmelden the page names who of this list is still missing
  // (#4762). The hint belongs to the list it was made for: a new scope or
  // leaving the mode hides it.
  const [missingHintScope, setMissingHintScope] = useState<string | null>(null);
  const handleBulkRunProcessed = useCallback(
    (action: SchoolCheckinAction) => {
      if (action === "in") setMissingHintScope(selectionScopeSignature);
    },
    [selectionScopeSignature],
  );
  const checkinModeActive = schoolCheckin.isActive;
  useEffect(() => {
    if (!checkinModeActive) setMissingHintScope(null);
  }, [checkinModeActive]);
  const missingAfterCheckin = useMemo((): MissingCheckinStudent[] => {
    if (missingHintScope !== selectionScopeSignature) return [];
    const missing: MissingCheckinStudent[] = [];
    for (const student of sortedStudents) {
      if (isLeftOutOfSelectAll(student)) continue;
      const label = statusLabelForStudent(student);
      if (label !== "Schule" && label !== "Zuhause") continue;
      missing.push({
        id: student.id.toString(),
        name:
          `${student.first_name ?? ""} ${student.second_name ?? ""}`.trim() ||
          student.name,
        status: label === "Schule" ? "schule" : "abwesend",
      });
    }
    return missing;
  }, [missingHintScope, selectionScopeSignature, sortedStudents]);

  const bulkCheckin = useBulkCheckinActions(
    schoolCheckin,
    selectedStudentsForBulk,
    handleBulkRunProcessed,
  );
  const { handleBulkAction, runningBulkAction } = bulkCheckin;

  const groupedStudents = useMemo(
    () => groupStudents(sortedStudents, effectiveGroupMode),
    [sortedStudents, effectiveGroupMode],
  );

  const fromParam = useMemo(() => {
    const qs = new URLSearchParams();
    if (searchTerm) qs.set(SEARCH_QUERY_PARAM, searchTerm);
    if (!isToday) qs.set(DATE_QUERY_PARAM, selectedDate);
    const params = searchPageFilterParams({
      groupIds: selectedGroupIds,
      schoolClasses: selectedSchoolClasses,
      years: selectedYears,
      roomId: effectiveRoomId,
      roomName: selectedRoomName,
      bus: busFilter,
      photoConsent: effectivePhotoConsentFilter,
      pickupStatus: pickupStatusFilter,
      pickupTimes: pickupTimeFilter,
      arrivalTime: arrivalTimeFilter,
      enrollmentAnswer: effectiveEnrollmentAnswer,
      dayStatus: dayStatusFilter,
      attendance: effectiveAttendanceFilter,
      tracking: effectiveTrackingFilter,
      sort: sortMode,
      view: effectiveGroupMode,
    });
    for (const [key, value] of Object.entries(params)) {
      if (value) qs.set(key, value);
    }
    return qs.size === 0
      ? "/students/search"
      : encodeURIComponent(`/students/search?${qs.toString()}`);
  }, [
    searchTerm,
    isToday,
    selectedDate,
    selectedGroupIds,
    selectedSchoolClasses,
    selectedYears,
    effectiveRoomId,
    selectedRoomName,
    busFilter,
    effectivePhotoConsentFilter,
    pickupStatusFilter,
    pickupTimeFilter,
    arrivalTimeFilter,
    effectiveEnrollmentAnswer,
    dayStatusFilter,
    effectiveAttendanceFilter,
    effectiveTrackingFilter,
    sortMode,
    effectiveGroupMode,
  ]);

  const openStudent = useCallback(
    (student: Student) =>
      router.push(`/students/${student.id}?from=${fromParam}`),
    [fromParam, router],
  );
  const openStudentRef = useLatest(openStudent);
  const handleOpenStudent = useCallback(
    (student: Student) => openStudentRef.current(student),
    [openStudentRef],
  );

  // Kacheln oder Tabelle (#3834). Die Tabelle trägt dieselben Angaben wie
  // die Karte, eine Spalte je Angabe, und markiert Kinder per Kästchen für
  // die Sammelaktionen. Auf dem Telefon wird sie zur dichten Zeilenliste.
  const holidayGuestLabel = useHolidayGuestLabels(students);
  const tableColumns = useMemo(
    () =>
      compactColumns<Student>([
        nameColumn(
          (student) => `/students/${student.id}?from=${fromParam}`,
          studentPhotosEnabled,
        ),
        statusColumn(isToday ? "Aufenthalt" : "Planung", (student) => (
          <SearchStudentStatusBadge
            student={student}
            isToday={isToday}
            userGroups={myGroups}
            groupRooms={myGroupRooms}
            supervisedRooms={mySupervisedRooms}
          />
        )),
        classColumn({ label: holidayGuestLabel }),
        groupColumn(),
        arrivalColumn((student) => searchStudentDay(student, isToday)),
        pickupColumn((student) => searchStudentDay(student, isToday)),
        departureColumn(dailyDepartureLabelForStudent),
        trackingColumn(trackingData, isToday),
      ]),
    [
      fromParam,
      studentPhotosEnabled,
      isToday,
      myGroups,
      myGroupRooms,
      mySupervisedRooms,
      trackingData,
      holidayGuestLabel,
    ],
  );
  const tableColumnDefaults = useMemo(
    () => columnDefaults(tableColumns),
    [tableColumns],
  );
  const collectionView = useCollectionView(
    "student-search",
    tableColumnDefaults,
    // Ohne eigene Wahl zeigt die Handy-Liste unter dem Namen die Gehzeit.
    "pickup",
  );
  const showTable = collectionView.view === "table";
  // Die Spaltenwahl wirkt nur am Computer: auf dem Handy zeigt die Liste
  // je Kind eine Zeile mit Name, Status und Gehzeit (#3834).
  const isPhone = useMediaQuery(BELOW_MD);
  const appList = appView && !(checkinModeAvailable && schoolCheckin.isActive);
  const changeView = useCallback(
    (next: "tiles" | "table") => {
      if (next === collectionView.view) return;
      // Der An- und Abmelde-Modus gehört zu den Kacheln.
      schoolCheckin.deactivate();
      collectionView.setView(next);
    },
    [collectionView, schoolCheckin],
  );
  const checkinClick = useCallback(
    (student: Student) => {
      const studentIdStr = student.id.toString();
      if (schoolCheckin.selectionActive) {
        schoolCheckin.toggleSelected(studentIdStr);
        return;
      }
      const room = checkoutConfirmationRoom(student.current_location);
      const checkinState = deriveCheckinState(student.current_location);
      if (
        (checkinState === "anwesend" || checkinState === "schulhof") &&
        requestEarlyCheckout({
          studentId: studentIdStr,
          studentName: `${student.first_name} ${student.second_name}`.trim(),
          plannedPickup: student.pickup_time,
          room,
        })
      ) {
        return;
      }
      if (room) {
        setPendingRoomCheckout({
          studentId: studentIdStr,
          studentName: `${student.first_name} ${student.second_name}`.trim(),
          room,
        });
        return;
      }
      void schoolCheckin.toggle(studentIdStr, checkinState);
    },
    [schoolCheckin, requestEarlyCheckout],
  );
  const checkinClickRef = useLatest(checkinClick);
  const handleCheckinClick = useCallback(
    (student: Student) => checkinClickRef.current(student),
    [checkinClickRef],
  );
  // Build the first viewport before the rest of a long card list on a
  // client remount. The opening document still renders the complete list;
  // grouping and bulk selection always use and render the complete result.
  const viewport = useInitialPaintViewport();
  const deepScroll = useHasDeepScrollPosition();
  const desktopViewport = viewport && viewport.width >= 1024;
  // On desktop the shell, page heading and search controls consume at least
  // 160px vertically. The shell and main padding leave at least 64px outside
  // the grid horizontally. Keep a full row at the lower edge as well.
  const initialCardCount =
    !viewport || schoolCheckin.isActive || deepScroll
      ? Infinity
      : desktopViewport
        ? Math.max(1, Math.floor((viewport.width - 64) / 320)) *
          Math.max(1, Math.ceil((viewport.height - 160) / 128))
        : Math.max(1, Math.floor(viewport.width / 320)) *
          Math.ceil(viewport.height / 112);
  const renderMemoizedStudentCard = (student: Student) => {
    const studentIdStr = student.id.toString();
    return (
      <SearchStudentCard
        key={student.id}
        student={student}
        isToday={isToday}
        checkinMode={checkinModeAvailable && schoolCheckin.isActive}
        checkinSelectMode={schoolCheckin.selectionActive}
        isCheckinSelected={schoolCheckin.selectedIds.has(studentIdStr)}
        isCheckinPending={schoolCheckin.pendingIds.has(studentIdStr)}
        checkinTargetName={checkinTarget.target?.roomName ?? null}
        userGroups={myGroups}
        groupRooms={myGroupRooms}
        supervisedRooms={mySupervisedRooms}
        trackingData={trackingData}
        onOpen={handleOpenStudent}
        onCheckinClick={handleCheckinClick}
        classLabel={holidayGuestLabel(student)}
      />
    );
  };

  // Fix P2: Session initialization / auth-gate loading no longer replaces the
  // whole page — real chrome (header, filters) renders immediately below;
  // only the results region skeletonizes while the session resolves. Note:
  // with required: true, unauthenticated users are auto-redirected to login.

  // Die Einträge des „⋮“ am Computer. Am Telefon stehen sie direkt im „…“
  // der Kopfkarte, statt als zweites Menü darin (#8070, Erreichbarkeit).
  const searchMenuItems: OverflowMenuEntry[] = [
    ...childScope.menuItems,
    {
      // Abwesenheits-Übersicht (#2288): bewusst kein eigener
      // Seitenleisten-Eintrag; der Einstieg liegt hier, wo das Team
      // ohnehin nach einem Kind sucht.
      label: "Abwesenheiten",
      description: "Öffnet die Übersicht, welche Kinder wann fehlen.",
      icon: <CalendarRange className="h-4 w-4" aria-hidden />,
      onClick: () => router.push("/absences"),
    },
    // Der Export verlangt users:read; der Gast hat es nicht.
    ...(canExportStudents(session)
      ? [
          {
            label: "Exportieren",
            description:
              "Öffnet den Export der Kinder aus der aktuellen Filterung.",
            icon: <Download className="h-4 w-4" aria-hidden />,
            onClick: () => setIsExportOpen(true),
            disabled: awaitsSearchFilters,
            badge: rowsLoaded ? filteredStudents.length : undefined,
          },
        ]
      : []),
    // Nur mit vollständig geladenen, sichtbaren Kindern: ein
    // Brief an eine abgeschnittene Liste würde Empfänger
    // auslassen.
    ...(parentAnnouncementsAvailable &&
    rowsLoaded &&
    !isSearchResultValidating &&
    !hasLoadError &&
    truncatedTotal === null &&
    filteredStudents.length > 0
      ? [
          {
            label: "Elternbrief schreiben",
            description:
              "Öffnet einen neuen Brief an die Eltern der gezeigten Kinder.",
            icon: <FileText className="h-4 w-4" aria-hidden />,
            onClick: writeParentLetter,
            badge: filteredStudents.length,
          },
        ]
      : []),
    // Die Spaltenwahl der Liste (#3834) steht hier und nicht
    // als eigener Knopf neben dem Umschalter.
    ...(showTable && !isPhone
      ? columnMenuEntries(
          tableColumns,
          collectionView.hiddenColumns,
          collectionView.setColumnVisible,
        )
      : []),
    ...(showTable && isPhone
      ? phoneDetailMenuEntries(
          tableColumns,
          collectionView.phoneDetail,
          collectionView.setPhoneDetail,
        )
      : []),
  ];

  return (
    <>
      {/* Kopfkarte wie auf jeder Tenant-Seite: Titel, Statuszeile, Aktionen,
          darunter Suche und Filter. */}
      <TenantPage
        title="Alle Kinder"
        appStatsInline
        // Beim Rollen schrumpft der Kopf wie auf den anderen Seiten auf eine
        // Zeile; die Lupe darin führt zurück ins Suchfeld (Runde 19).
        appToolbarScrollsAway="with-tools"
        info="Hier findest du jedes Kind deiner OGS. Gib zuerst den Namen in die Suche ein. Wähle dann die Karte des Kindes, um seine Angaben zu sehen."
        tabs={childScope.tabs}
        stats={studentSummary?.summary}
        appCompactStats={studentSummary?.compact ?? undefined}
        statsLoading={!hasFetchedOnce || isDateTransition}
        overflowMenu={appView ? searchMenuItems : undefined}
        // Am Telefon gibt es nur die Zeilenliste (kein Umschalter), und die
        // Menüeinträge stehen direkt im „…“ (`overflowMenu`).
        actions={
          appView ? undefined : (
            <>
              <CollectionViewSwitch
                value={collectionView.view}
                onChange={changeView}
              />
              {/* `tourTarget` gibt der Einstiegs-Tour ein eindeutiges Ziel: über
                dieses Menü erreicht man die Aufsicht, wenn die Schule Kinder
                nur hier finden lässt (#1321). */}
              <OverflowMenu
                tourTarget="child-search-menu"
                items={searchMenuItems}
                ariaLabel="Weitere Aktionen"
              />
            </>
          )
        }
        // Der Zähler ändert sich mit der Filterung und gehört deshalb in
        // die Filterzeile, nicht in die Titelzeile.
        badge={
          // Handy: Ungefiltert nennt der Chip der Titelzeile die Gesamtzahl
          // („16 von 118 da“); der Zähler erscheint erst, wenn Suche oder
          // Filter die Liste verkleinern („3 Kinder“).
          rowsLoaded &&
          !(appView && isToday && filteredStudents.length === students.length)
            ? {
                count: filteredStudents.length,
                icon: <MotoConceptIcon concept={childrenConcept} size={20} />,
                // Telefon (#8070): Die Titelzeile trägt nur „da“ und
                // „krank“; die Gesamtzahl steht hier beschriftet wie am
                // Desktop („118 Kinder“), nicht als nackte Zahl.
                ...(appView
                  ? {
                      compactLabel:
                        filteredStudents.length === 1 ? "Kind" : "Kinder",
                    }
                  : {}),
              }
            : undefined
        }
        primaryAction={
          checkinModeAvailable && !schoolCheckin.isActive && !showTable ? (
            <SchoolCheckinFab
              variant="inline"
              isActive={schoolCheckin.isActive}
              onToggle={schoolCheckin.toggleActive}
              successCount={
                schoolCheckin.selectionActive
                  ? selectedStudentsForBulk.length
                  : schoolCheckin.successCount
              }
              pendingCount={schoolCheckin.pendingIds.size}
              disabled={schoolCheckin.isBulkRunning}
            />
          ) : undefined
        }
        // Unter `xl` hat die Seite eigene Auslöser für den Modus: den
        // schwebenden Knopf (`md` bis `xl`) und `SchoolCheckinModeMobile`
        // darunter. In der Suchzeile stünde er dort doppelt (#7132).
        primaryActionDesktopOnly
        search={{
          value: searchTerm,
          onChange: updateSearchTerm,
          placeholder: "Name suchen…",
          debounceMs: 300,
          resetKey: searchResetKey,
        }}
        filters={filterConfigs}
        activeFilters={activeFilters}
        // Sechs Filter sprengen die Zeile bis hinauf zu Tablet-Breiten; die
        // Filterschaltfläche sammelt sie hinter einer Fläche mit Abschnitten.
        // Handy (#8070): „Anwesenheit“ (Tag, Status) ist der häufigste
        // Filter und steht im Blatt zuerst, auch am iPhone SE ohne Rollen.
        filterPanel={{
          sections: appView
            ? [
                // Handy: Ein Haken vor „Anwesenheit“ las sich wie „gewählt“;
                // ein Kalender sagt, dass es um den Tag geht.
                ...filterSections
                  .filter((section) => section.title === "Anwesenheit")
                  .map((section) => ({
                    ...section,
                    icon: (
                      <MotoDuotoneIcon
                        icon={CalendarBlankIcon}
                        tone="blue"
                        size="100%"
                      />
                    ),
                  })),
                ...filterSections.filter(
                  (section) => section.title !== "Anwesenheit",
                ),
              ]
            : filterSections,
        }}
        onClearAllFilters={clearAllFilters}
        // Ein Ladefehler ist der Fehlerzustand des Gerüsts. Fehlende Rechte
        // stehen als eingebetteter Standardzustand im Inhalt.
        error={(() => {
          if (hasLoadError && !isPermissionError) {
            // Until the catalog text is there, the skeleton stays hidden and
            // nothing is shown; a server or unavailable error carries its own
            // retry, every other one gets the reload next to it.
            if (!load.error) return null;
            return {
              message: load.error.message,
              action: errorAlertActions(load.error) ?? reloadAction,
            };
          }
          if (loadingStalled) {
            return {
              message:
                "Die Kinder laden gerade sehr lange. Bitte lade die Liste noch einmal.",
              action: reloadAction,
            };
          }
          return null;
        })()}
        empty={
          !hasLoadError &&
          hasFetchedOnce &&
          !isInitializing &&
          !isAuthError &&
          !isDateTransition &&
          filteredStudents.length === 0
            ? {
                icon: (
                  <Search
                    className="h-12 w-12 text-gray-500"
                    aria-hidden="true"
                  />
                ),
                title: "Keine Kinder gefunden",
                description:
                  "Zu Suche und Filtern passt kein Kind. Setze die Filter zurück, um alle Kinder zu sehen.",
                action: (
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={clearAllFilters}
                    tooltip="Hebt Suche, Filter und Sortierung auf und zeigt wieder heute."
                  >
                    Filter zurücksetzen
                  </Button>
                ),
              }
            : null
        }
        overlays={
          <>
            {earlyCheckout.dialog}
            {/* Checkout out of a room ends the running room visit, so it asks
          first and names the room (#2220). Roomless states never reach
          this dialog — they stay a single tap. */}
            <Modal
              isOpen={pendingRoomCheckout !== null}
              onClose={() => setPendingRoomCheckout(null)}
              title="Aus der Betreuung abmelden?"
              mobileSheet
              footer={
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={() => setPendingRoomCheckout(null)}
                    noTooltip={CHECKOUT_HINTS.cancel}
                  >
                    Abbrechen
                  </Button>
                  <Button
                    type="button"
                    variant="surface"
                    size="md"
                    onClick={() => {
                      if (!pendingRoomCheckout) return;
                      void schoolCheckin.toggle(
                        pendingRoomCheckout.studentId,
                        "anwesend",
                        undefined,
                        "class",
                      );
                      setPendingRoomCheckout(null);
                    }}
                    tooltip={CHECKOUT_HINTS.toClass}
                  >
                    Geht zum Unterricht
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="md"
                    onClick={() => {
                      if (!pendingRoomCheckout) return;
                      void schoolCheckin.toggle(
                        pendingRoomCheckout.studentId,
                        "anwesend",
                      );
                      setPendingRoomCheckout(null);
                    }}
                    tooltip={CHECKOUT_HINTS.home}
                  >
                    Geht nach Hause
                  </Button>
                </>
              }
            >
              <p className="text-sm text-gray-600">
                <span className="font-medium text-gray-900">
                  {pendingRoomCheckout?.studentName}
                </span>{" "}
                ist gerade in{" "}
                <span className="font-medium text-gray-900">
                  {pendingRoomCheckout?.room}
                </span>
                . Beim Abmelden wird der laufende Raumbesuch beendet.
              </p>
            </Modal>

            {bulkCheckin.dialogs}

            {isExportOpen && (
              <StudentExportModal
                isOpen={isExportOpen}
                filters={exportFilters}
                appliedFilters={activeFilters.map((filter) => filter.label)}
                resultCount={filteredStudents.length}
                onClose={() => setIsExportOpen(false)}
              />
            )}
          </>
        }
      >
        {isPermissionError && load.error ? (
          <ForbiddenPage embedded message={load.error.message} />
        ) : null}
        <div hidden={isPermissionError}>
          <LoadErrorAlert error={filterOptionsLoad.error} className="mb-3" />
          {/* Planning-date context banner (#1939). The day chooser itself lives in
          the filter panel, in the "Anwesenheit" section right above the
          Kommt/Kommt-nicht filter it scopes. This banner only appears for a
          non-today date so nobody mistakes a plan view for live presence. */}
          {!isToday && (
            <div className="mb-3">
              <Alert
                type="info"
                message={`Geplante Anwesenheit für ${formatDate(selectedDate, true)}; aktuelle Aufenthaltsorte bleiben ausgeblendet.`}
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="compact"
                    onClick={() => updateSelectedDate(todayIso)}
                    tooltip="Zeigt, wo die Kinder heute gerade sind."
                  >
                    Zurück zu heute
                  </Button>
                }
              />
            </div>
          )}

          {/* Incomplete-result notice (#2218 review). The page walk stops at
          MAX_STUDENT_SEARCH_PAGES, and the badge, the grouping headers and the
          export all describe the rows it loaded. Without this the school would
          read a truncated list as the complete one, so the shortfall is named
          here instead of only in the log. */}
          {truncatedTotal !== null && (
            <div className="mb-3">
              <Alert
                type="warning"
                message={`Es werden nur die ersten ${students.length} von ${truncatedTotal} Kindern geladen. Anzahl, Gruppierung und Export beziehen sich allein auf diese Kinder; bitte die Filter enger setzen.`}
              />
            </div>
          )}

          {/* Unterwegs-Kinder einem Raum zuweisen (#5026): wie auf „Räume“
              führt die Karte zur Seite „Unterwegs“, der Rückweg zurück
              hierher. Gezählt wird vor dem Statusfilter: Ein krank
              gemeldetes Kind ohne Raum steht in der Liste unter „Krank“,
              auf der Seite „Unterwegs“ aber mit. */}
          <StudentSearchTransitCard
            students={students}
            show={
              isToday &&
              (effectiveAttendanceFilter === "unterwegs" ||
                effectiveGroupMode === "status" ||
                effectiveGroupMode === "room")
            }
            fromParam={fromParam}
          />

          {/* Mobile (<md) check-in mode trigger, inline pill / sticky bar.
          Check-in toggles TODAY's attendance, so it hides on other dates. */}
          {/* In der Liste markieren die Kästchen; der Modus gehört zu den
              Kacheln (#3834). */}
          {checkinModeAvailable && !showTable && !appList && (
            <div className="mb-3 md:hidden">
              <SchoolCheckinModeMobile
                isActive={schoolCheckin.isActive}
                onToggle={schoolCheckin.toggleActive}
                successCount={schoolCheckin.successCount}
                pendingCount={schoolCheckin.pendingIds.size}
                selectionActive={schoolCheckin.selectionActive}
                onSelectionActiveChange={schoolCheckin.setSelectionActive}
                selectedCount={selectedStudentsForBulk.length}
                onClearSelection={schoolCheckin.clearSelection}
                onBulkAction={handleBulkAction}
                runningAction={runningBulkAction}
                selectAll={checkinSelectAll}
                disabled={schoolCheckin.isBulkRunning}
                targetPicker={
                  checkinTarget.available ? (
                    <SchoolCheckinTargetPicker
                      state={checkinTarget}
                      layout="sheet"
                      disabled={schoolCheckin.isBulkRunning}
                    />
                  ) : undefined
                }
              />
            </div>
          )}

          {/* Sub-mode bar of the active check-in mode (#2359): switch between
          immediate taps (door operation, default) and the selection mode
          with its bulk Anmelden/Abmelden actions. */}
          {checkinModeAvailable && schoolCheckin.isActive && (
            <SchoolCheckinSelectionBar
              selectionActive={schoolCheckin.selectionActive}
              onSelectionActiveChange={schoolCheckin.setSelectionActive}
              selectedCount={selectedStudentsForBulk.length}
              onClearSelection={schoolCheckin.clearSelection}
              onBulkAction={handleBulkAction}
              onFinish={schoolCheckin.toggleActive}
              isRunning={schoolCheckin.isBulkRunning}
              runningAction={runningBulkAction}
              selectAll={checkinSelectAll}
              targetRoomName={checkinTarget.target?.roomName ?? null}
              targetPicker={
                checkinTarget.available ? (
                  <SchoolCheckinTargetPicker
                    state={checkinTarget}
                    disabled={schoolCheckin.isBulkRunning}
                  />
                ) : undefined
              }
            />
          )}

          {checkinModeAvailable && schoolCheckin.isActive && (
            <SchoolCheckinMissingHint
              students={missingAfterCheckin}
              onShowStatus={updateAttendanceFilter}
              onDismiss={() => setMissingHintScope(null)}
            />
          )}

          {/* Student Grid. Bottom padding reserves room for the mobile sticky
          bar / tablet floating FAB; desktop has neither. The active mobile bar
          is taller (mode line + switcher, plus the bulk row in "Mehrere" and
          the line naming left-out children, #4762). */}
          <div
            className={
              checkinModeAvailable
                ? schoolCheckin.isActive
                  ? schoolCheckin.selectionActive
                    ? selectAllPlan.leftOutCount > 0
                      ? "pb-52 md:pb-24 lg:pb-0"
                      : "pb-44 md:pb-24 lg:pb-0"
                    : "pb-36 md:pb-24 lg:pb-0"
                  : "pb-24 lg:pb-0"
                : undefined
            }
          >
            <StudentCardClockProvider now={planningNow}>
              {(() => {
                if (showGridSkeleton) {
                  return <StudentCardGridSkeleton />;
                }
                if (appList) {
                  return (
                    <>
                      <StudentListApp
                        students={sortedStudents}
                        groups={groupedStudents}
                        alphabetic={
                          effectiveGroupMode === "none" && sortMode === "name"
                        }
                        isToday={isToday}
                        studentHref={(student) =>
                          `/students/${student.id}?from=${fromParam}`
                        }
                        classLabel={holidayGuestLabel}
                        userGroups={myGroups}
                        groupRooms={myGroupRooms}
                        supervisedRooms={mySupervisedRooms}
                        trackingData={trackingData}
                      />
                      {/* App (#8070): An- und Abmelden als beschriftete
                          Aktion in Daumennähe. */}
                      {checkinModeAvailable ? (
                        <ActionBar>
                          <Button
                            type="button"
                            variant="primary"
                            size="md"
                            className="gap-2"
                            onClick={schoolCheckin.toggleActive}
                            disabled={schoolCheckin.isBulkRunning}
                            tooltip="Zeigt bei jedem Kind einen Knopf zum An- und Abmelden."
                          >
                            <ListChecks className="size-5" aria-hidden="true" />
                            Kinder an- und abmelden
                          </Button>
                        </ActionBar>
                      ) : null}
                    </>
                  );
                }
                if (showTable) {
                  return (
                    <StudentSelectionScope
                      visibleStudents={filteredStudents}
                      scopeKey={selectionScopeSignature}
                      checkinAllowed={isToday}
                      exportContext={{
                        ...(isToday ? {} : { date: selectedDate }),
                        sort: sortMode,
                      }}
                    >
                      {(tableSelection) =>
                        effectiveGroupMode === "none" ? (
                          <StudentTable
                            rows={sortedStudents}
                            columns={tableColumns}
                            hiddenColumns={collectionView.hiddenColumns}
                            phoneDetail={collectionView.phoneDetail}
                            onOpen={handleOpenStudent}
                            selection={tableSelection}
                          />
                        ) : (
                          <div className="space-y-6">
                            {groupedStudents.map((group) => (
                              <div key={group.key} data-testid="student-group">
                                <StudentTable
                                  heading={{
                                    title: group.label,
                                    count: group.items.length,
                                  }}
                                  rows={group.items}
                                  columns={tableColumns}
                                  hiddenColumns={collectionView.hiddenColumns}
                                  phoneDetail={collectionView.phoneDetail}
                                  onOpen={handleOpenStudent}
                                  selection={tableSelection}
                                />
                              </div>
                            ))}
                          </div>
                        )
                      }
                    </StudentSelectionScope>
                  );
                }
                // Fehler und Leerzustand liegen im Gerüst (`error`/`empty`)
                // und ersetzen den Inhalt dort.
                if (effectiveGroupMode !== "none") {
                  return (
                    <ParentAttentionList>
                      <div className="space-y-6">
                        {groupedStudents.map((group) => (
                          // Der Gruppentitel steht auf der Fläche seiner Karte,
                          // nicht frei auf dem gemusterten Grund (BAUARTEN-SPEC,
                          // Teil 3).
                          <div key={group.key} data-testid="student-group">
                            <SectionCard
                              title={group.label}
                              action={
                                <StatusBadge
                                  label={String(group.items.length)}
                                  tone="gray"
                                  compact
                                />
                              }
                            >
                              <CollectionGrid>
                                {group.items.map(renderMemoizedStudentCard)}
                              </CollectionGrid>
                            </SectionCard>
                          </div>
                        ))}
                      </div>
                    </ParentAttentionList>
                  );
                }

                return (
                  <ParentAttentionList>
                    <CollectionGrid>
                      {sortedStudents
                        .slice(0, initialCardCount)
                        .map(renderMemoizedStudentCard)}
                    </CollectionGrid>
                  </ParentAttentionList>
                );
              })()}
            </StudentCardClockProvider>
          </div>
        </div>
      </TenantPage>

      {/* Tablet (md..xl) check-in mode trigger, floating FAB. Tablet
          range is bumped to `xl` here to stay aligned with the header,
          whose filter panel switches to desktop at `xl`. Both the filter sheet and the FAB
          live under the same boundary so iPad Air gets the consistent
          tablet UX. */}
      {checkinModeAvailable &&
        !schoolCheckin.isActive &&
        !showTable &&
        !appView && (
          <div className="hidden md:block xl:hidden">
            <SchoolCheckinFab
              variant="floating"
              floatingUntil="xl"
              isActive={schoolCheckin.isActive}
              onToggle={schoolCheckin.toggleActive}
              successCount={
                schoolCheckin.selectionActive
                  ? selectedStudentsForBulk.length
                  : schoolCheckin.successCount
              }
              pendingCount={schoolCheckin.pendingIds.size}
              disabled={schoolCheckin.isBulkRunning}
            />
          </div>
        )}
    </>
  );
}

// Main component with Suspense wrapper
export default function StudentSearchPage() {
  return (
    <Suspense fallback={<StudentSearchPageSkeleton />}>
      <SearchPageContent />
    </Suspense>
  );
}
