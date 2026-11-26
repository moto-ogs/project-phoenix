"use client";

// Kinder aller Schulen des Trägers (#8137, ADR 0327): eine Liste mit einem
// Reiter je Schule und „Alle“, damit das Träger-Büro ein Kind findet, ohne in
// jede Schule zu wechseln. Eine Zeile nennt Kind, Schule, Klasse und Gruppe,
// sonst nichts. Nur die Rolle mit dem Recht „Verträge verwalten“ sieht die
// Seite; jede geladene Seite und jeder Download steht im Zugriffsprotokoll
// der gezeigten Schulen.

import { useRouter, useSearchParams } from "next/navigation";
import {
  memo,
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { emptySearchText } from "~/components/traeger/empty-search";
import {
  traegerExportScope,
  useTraegerListExportItems,
} from "~/components/traeger/traeger-list-export-menu";
import { isRefusal } from "~/components/traeger/use-traeger-confirmed-resource";
import { useFreshTraegerResource } from "~/components/traeger/use-traeger-resource";
import { useTraegerSchools } from "~/components/traeger/use-traeger-schools";
import { Button } from "~/components/ui/button";
import {
  DataTable,
  type DataTableColumn,
  type DataTableMoreAction,
} from "~/components/ui/data-table";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { ListSkeleton } from "~/components/ui/page-skeletons";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { ApiError, isChangedSinceRead } from "~/lib/api-error";
import { isPositiveInt64Id } from "~/lib/compare-ids";
import { childrenConcept } from "~/lib/concepts/children";
import { berlinTodayISO } from "~/lib/date-helpers";
import { useBerlinTodayWithRefresh } from "~/lib/hooks/use-berlin-today";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { schoolClassLabel, schoolClassName } from "~/lib/school-class-label";
import { IsolatedSWRCache, useInvalidateMatching } from "~/lib/swr";
import { useSWRRequestGuard } from "~/lib/swr/hooks";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  downloadTraegerChildren,
  fetchTraegerChildren,
  type TraegerChild,
  type TraegerChildrenPage,
  type TraegerSchoolChildCount,
} from "~/lib/traeger-children-api";
import { sameSetMembers } from "~/lib/utils";

const logger = createLogger({ component: "TraegerChildrenPage" });

const TITLE = "Kinder";
/** Der Reiter über alle Schulen; jeder andere trägt die ID seiner Schule. */
const ALL_SCHOOLS = "alle";
/** Die Schule in der Adresse, damit ein Lesezeichen ihren Reiter öffnet. */
const SCHOOL_PARAM = "schule";
const LIST_OBJECT = "die Liste der Kinder";
/** So lange wartet das Suchfeld nach dem letzten Buchstaben, bevor es sucht. */
const SEARCH_PAUSE_MS = 250;
const SEARCH_MAX_LENGTH = 100;

function validateSearch(draft: string) {
  return Array.from(draft.trim()).length > SEARCH_MAX_LENGTH
    ? `Kürze deine Suche auf höchstens ${SEARCH_MAX_LENGTH} Zeichen.`
    : undefined;
}

function Plain({ value }: Readonly<{ value: string }>) {
  return <span className="text-sm text-gray-700">{value || "–"}</span>;
}

/**
 * Die Spalten der Liste. Auf dem Telefon steht unter dem Namen eine Zeile mit
 * Schule, Klasse und Gruppe; die Schule fehlt dort wie in der Tabelle, sobald
 * ein Reiter nur eine Schule zeigt.
 */
function childColumns(showSchool: boolean): DataTableColumn<TraegerChild>[] {
  return [
    {
      key: "name",
      header: "Kind",
      render: (child) => (
        <span className="font-medium text-gray-900">
          {child.lastName}, {child.firstName}
        </span>
      ),
      stacked: "title",
    },
    {
      key: "school",
      header: "Schule",
      render: (child) => <Plain value={child.schoolName} />,
      // The phone line of the class column names the school.
      stacked: "hidden",
    },
    {
      key: "class",
      header: "Klasse",
      render: (child) => <Plain value={schoolClassName(child.schoolClass)} />,
      stackedLabel: false,
      stackedRender: (child) =>
        [
          showSchool ? child.schoolName : "",
          schoolClassLabel(child.schoolClass),
          child.groupName,
        ]
          .filter(Boolean)
          .join(" · ") || "–",
    },
    {
      key: "group",
      header: "Gruppe",
      render: (child) => <Plain value={child.groupName} />,
      // The phone line of the class column names the group.
      stacked: "hidden",
    },
  ];
}

const HIDE_SCHOOL: ReadonlySet<string> = new Set(["school"]);
const HIDE_NOTHING: ReadonlySet<string> = new Set();
// A pending search only changes the menu, not the already drawn rows.
const ChildrenTable = memo(DataTable<TraegerChild>);
const childRowKey = (child: TraegerChild) => child.studentId;

const plural = (count: number, one: string, many: string) =>
  count === 1 ? one : many;

type ChildrenCounts = Pick<
  TraegerChildrenPage,
  "total" | "matched" | "schools"
>;

/** Die Statuszeile: Kinder des offenen Reiters, bei einer Suche die Treffer. */
function childFigures(
  counts: ChildrenCounts,
  allSchools: boolean,
  searching: boolean,
) {
  const children = {
    value: counts.total,
    label: plural(counts.total, "Kind", "Kinder"),
  };
  if (searching) {
    return [children, { value: counts.matched, label: "gefunden" }];
  }
  if (allSchools && counts.schools.length > 1) {
    return [children, { value: counts.schools.length, label: "Schulen" }];
  }
  return [children];
}

export default function TraegerChildrenPage() {
  // `useSearchParams` braucht eine Suspense-Grenze.
  return (
    <Suspense fallback={<TenantPage title={TITLE} loading />}>
      <ChildrenOpening />
    </Suspense>
  );
}

function ChildrenOpening() {
  const [search, setSearch] = useState("");
  const { schools } = useTraegerSchools();
  return (
    <IsolatedSWRCache>
      <ChildrenContent
        knownSchools={schools}
        search={search}
        onSearchChange={setSearch}
      />
    </IsolatedSWRCache>
  );
}

function ChildrenContent({
  knownSchools,
  search,
  onSearchChange,
}: Readonly<{
  knownSchools: ReturnType<typeof useTraegerSchools>["schools"];
  search: string;
  onSearchChange: (search: string) => void;
}>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams?.get(SCHOOL_PARAM) ?? ALL_SCHOOLS;
  // A bookmark scopes the request even when cached school metadata is stale.
  const schoolId = tab === ALL_SCHOOLS ? "" : tab;
  const invalidSchool = tab !== ALL_SCHOOLS && !isPositiveInt64Id(tab);
  const term = search.trim();
  const [day, refreshDay] = useBerlinTodayWithRefresh();
  const [draftPending, setDraftPending] = useState(false);
  const { show: showActionError } = useApiErrorDisplay();

  // Keep counts between filters, but never carry yesterday's counts forward.
  const [counted, setCounted] = useState<{
    day: string;
    schools: readonly TraegerSchoolChildCount[];
  } | null>(null);
  const filter = useMemo(() => ({ schoolId, search: term }), [schoolId, term]);
  // Every page read stands in the access log of the schools it shows. So a
  // reiter or a search shows nothing until its own read answered, also when
  // the person comes back to one the tab has read before (ADR 0311).
  const listKey = invalidSchool ? null : traegerKeys.children(day, filter);
  const first = useFreshTraegerResource(
    listKey,
    async () => {
      const requestedOn = berlinTodayISO();
      const result = await fetchTraegerChildren(filter);
      // A browser day change retires this opening. The roster date itself
      // comes from the server; a device clock may be ahead or behind.
      const crossedMidnight = berlinTodayISO() !== requestedOn;
      if (crossedMidnight || !result.rosterDate) {
        if (crossedMidnight) refreshDay();
        throw new ApiError("Children roster is no longer current", 503, {
          code: "general.unavailable",
        });
      }
      return result;
    },
    LIST_OBJECT,
  );
  const { data: firstPage, readCallbacks } = first;
  const [expired, setExpired] = useState<{
    page: TraegerChildrenPage;
    refreshing: boolean;
    failure?: unknown;
  } | null>(null);
  const expiredPage = expired?.page === firstPage ? expired : null;
  if (expired && !expiredPage) setExpired(null);
  const page = expiredPage ? null : firstPage;
  const invalidate = useInvalidateMatching();
  const beginPageRead = useSWRRequestGuard();

  // Later pages belong to the first page they continue; another reiter,
  // another search or a reload starts a new list and drops them.
  const [later, setLater] = useState<{
    readonly after: TraegerChildrenPage;
    readonly children: TraegerChild[];
    readonly nextCursor: string;
    readonly counts: ChildrenCounts;
  } | null>(null);
  const [loadingPage, setLoadingPage] = useState<TraegerChildrenPage | null>(
    null,
  );
  const activePage = useRef({ firstPage, shown: page });
  useLayoutEffect(() => {
    activePage.current = { firstPage, shown: page };
    return () => {
      activePage.current = { firstPage: null, shown: null };
    };
  }, [firstPage, page]);
  const continued = later && later.after === page ? later : null;
  const counts = continued?.counts ?? page;
  if (counts && (counted?.day !== day || counted.schools !== counts.schools)) {
    setCounted({ day, schools: counts.schools });
  }
  const schools: readonly (Pick<TraegerSchoolChildCount, "id" | "name"> &
    Partial<TraegerSchoolChildCount>)[] =
    counts?.schools ??
    (counted?.day === day ? counted.schools : knownSchools) ??
    [];
  const school = schools.find((entry) => entry.id === schoolId);
  const children = useMemo(
    () => continued?.children ?? (page ? [...page.children] : undefined),
    [continued, page],
  );
  const nextCursor = continued?.nextCursor ?? page?.nextCursor;
  const matched = counts?.matched ?? 0;
  const loadingMore = page !== null && loadingPage === page;

  const clearList = useCallback(() => {
    // End this opening and its in-flight reads; a cache write alone would
    // leave the opening's held answer eligible to reappear.
    void invalidate((key) => key === listKey, { clear: true });
    setLater(null);
    setCounted(null);
  }, [invalidate, listKey]);
  const expiredError = useSwrLoadError(
    expiredPage?.failure,
    LIST_OBJECT,
    clearList,
  );

  const withdrawRefusedList = useCallback(
    (error: unknown) => {
      if (!page || activePage.current.shown !== page || !isRefusal(error))
        return;
      readCallbacks.onError(error);
      clearList();
    },
    [page, readCallbacks, clearList],
  );

  const loadMore = useCallback(async () => {
    if (!page || !children || !nextCursor || loadingMore || draftPending)
      return;
    // A new date changes the list key and opens its first page, not the
    // continuation of the previous day's roster.
    if (refreshDay() !== day) return;
    let complete: ReturnType<typeof beginPageRead> | undefined;
    setLoadingPage(page);
    try {
      complete = beginPageRead(listKey);
      const next = await fetchTraegerChildren(filter, nextCursor);
      if (
        !complete.isCurrent() ||
        activePage.current.shown !== page ||
        refreshDay() !== day
      )
        return;
      if (
        next.rosterDate !== page.rosterDate ||
        (filter.schoolId === "" &&
          !sameSetMembers(
            page.schools.map((entry) => entry.id),
            next.schools.map((entry) => entry.id),
          ))
      ) {
        // The cursor skips rows of a changed roster. Old rows may also
        // belong to a school this Träger is no longer allowed to see.
        clearList();
        return;
      }
      // A renamed child can reappear after the cursor. Its newer position
      // and details replace the older row.
      const nextIDs = new Set(next.children.map(childRowKey));
      const merged = [
        ...children.filter((child) => !nextIDs.has(child.studentId)),
        ...next.children,
      ];
      if (
        next.children.length === 0 ||
        merged.length > next.matched ||
        (!next.nextCursor && merged.length < next.matched)
      ) {
        // The rows no longer add up to the count of this answer: a child
        // left, or a rename moved one across the cursor. The cursor cannot
        // repair that, so the list starts over with a fresh first page.
        clearList();
        return;
      }
      setLater({
        after: page,
        children: merged,
        nextCursor: next.nextCursor,
        counts: {
          total: next.total,
          matched: next.matched,
          schools: next.schools,
        },
      });
    } catch (err) {
      // A superseded request must not change the new list or report an error.
      if (
        !complete?.isCurrent() ||
        activePage.current.shown !== page ||
        refreshDay() !== day
      )
        return;
      if (isRefusal(err)) {
        withdrawRefusedList(err);
      } else if (isChangedSinceRead(err)) {
        clearList();
      } else {
        logger.error("traeger_children_load_more_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        await showActionError(err, { object: "die nächsten Kinder" });
      }
    } finally {
      setLoadingPage((current) => (current === page ? null : current));
    }
  }, [
    page,
    children,
    nextCursor,
    loadingMore,
    draftPending,
    day,
    refreshDay,
    beginPageRead,
    listKey,
    filter,
    clearList,
    withdrawRefusedList,
    showActionError,
  ]);

  const moreAction = useMemo<DataTableMoreAction | undefined>(
    () =>
      nextCursor && children
        ? {
            label:
              children.length <= matched
                ? `Weitere Kinder laden (${children.length} von ${matched})`
                : "Weitere Kinder laden",
            onClick: () => void loadMore(),
            loading: loadingMore,
            loadingText: "Wird geladen …",
            disabled: loadingMore || draftPending,
            tooltip: "Zeigt die nächsten 50 Kinder unten in der Liste an.",
          }
        : undefined,
    [nextCursor, children, matched, loadMore, loadingMore, draftPending],
  );

  const changeTab = (next: string) => {
    const params = new URLSearchParams(searchParams?.toString());
    if (next === ALL_SCHOOLS) params.delete(SCHOOL_PARAM);
    else params.set(SCHOOL_PARAM, next);
    const query = params.toString();
    router.replace(query ? `?${query}` : "?", { scroll: false });
  };

  const exportItems = useTraegerListExportItems({
    download: (format) =>
      downloadTraegerChildren(format, filter, page?.rosterDate ?? ""),
    scope:
      schoolId && !school
        ? "Ausgewählte Schule"
        : traegerExportScope(school?.name),
    fallbackName: "kinder",
    errorObject: LIST_OBJECT,
    errorMessageSuffix: school ? `Download für „${school.name}“.` : undefined,
    unavailable: draftPending || !page?.rosterDate,
    onError: withdrawRefusedList,
    reloadOnChanged: async () => {
      if (!page || activePage.current.firstPage !== page) return;
      // Retire the refused snapshot even if the read that replaces it fails.
      activePage.current.shown = null;
      const attempt = { page, refreshing: true };
      setExpired(attempt);
      setLater(null);
      setCounted(null);
      try {
        await first.reloadOrThrow();
      } catch (failure) {
        setExpired((value) =>
          value === attempt ? { page, refreshing: false, failure } : value,
        );
        throw failure;
      }
    },
  });

  // One school per reiter, or one school at all: its column would repeat
  // the same name on every row.
  const showSchool = schoolId === "" && schools.length > 1;
  const columns = useMemo(() => childColumns(showSchool), [showSchool]);
  const searching = term !== "";
  const loading =
    !invalidSchool && !first.error && (!firstPage || expiredPage?.refreshing);
  const schoolError = invalidSchool
    ? { message: "Der Link enthält keine gültige Schule." }
    : schoolId &&
        first.failure instanceof ApiError &&
        first.failure.code === "traeger.school_not_found"
      ? first.error
      : undefined;
  const error = schoolError
    ? {
        ...schoolError,
        action: (
          <Button
            type="button"
            variant="outline"
            size="compact"
            tooltip="Öffnet die Kinderliste aller Schulen."
            onClick={() => changeTab(ALL_SCHOOLS)}
          >
            Alle Schulen anzeigen
          </Button>
        ),
      }
    : (first.error ?? (expiredPage?.failure ? expiredError : null));
  const noMatch = emptySearchText(search, []);
  // A search without a hit offers the way back. A list nobody can fill
  // from here is one sentence, not a stage.
  const empty =
    !children || children.length > 0
      ? undefined
      : searching
        ? {
            title: "Kein Kind gefunden",
            description: noMatch.description,
            icon: (
              <MotoConceptIcon
                concept={childrenConcept}
                className="h-12 w-12"
              />
            ),
            action: (
              <Button
                type="button"
                variant="outline"
                size="md"
                tooltip="Leert die Suche und zeigt wieder alle Kinder."
                onClick={() => onSearchChange("")}
              >
                {noMatch.actionLabel}
              </Button>
            ),
          }
        : school
          ? {
              title: `${school.name} führt heute kein Kind mit Betreuungsplatz`,
            }
          : {
              title:
                "Deine Schulen führen heute noch kein Kind mit Betreuungsplatz",
            };

  return (
    <TenantPage
      title={TITLE}
      info="Hier stehen alle Kinder, die deine Schulen heute mit Betreuungsplatz führen. Jeder Reiter zeigt eine Schule, „Alle“ zeigt alle zusammen. Du siehst Name, Schule, Klasse und Gruppe. moto hält im Zugriffsprotokoll der Schule fest, wer die Liste öffnet oder herunterlädt."
      stats={
        counts ? (
          <TenantPageStats
            items={childFigures(counts, schoolId === "", searching)}
          />
        ) : null
      }
      statsLoading={loading}
      search={{
        value: search,
        // Keep uncommitted keystrokes in the field so rows don't redraw.
        onChange: onSearchChange,
        placeholder: "Kind suchen",
        debounceMs: SEARCH_PAUSE_MS,
        onDraftPendingChange: setDraftPending,
        validateDraft: validateSearch,
      }}
      overflowMenu={exportItems}
      tabs={
        schools.length > 1
          ? {
              value: schoolId || ALL_SCHOOLS,
              onChange: changeTab,
              label: "Schulen",
              inUrl: true,
              items: [
                { value: ALL_SCHOOLS, label: "Alle" },
                ...schools.map((entry) => ({
                  value: entry.id,
                  label: entry.name,
                  // The children the school counts today, as in its own view.
                  badge: entry.children,
                })),
              ],
            }
          : undefined
      }
      error={error}
      empty={empty}
      // A list loads in the shape of its rows.
      loading={loading ? <ListSkeleton rows={8} avatar={false} /> : false}
    >
      {children ? (
        <ChildrenTable
          columns={columns}
          rows={children}
          getRowKey={childRowKey}
          hiddenColumns={showSchool ? HIDE_NOTHING : HIDE_SCHOOL}
          stackedLayout="row"
          stackedDetailKey="class"
          moreAction={moreAction}
        />
      ) : null}
    </TenantPage>
  );
}
