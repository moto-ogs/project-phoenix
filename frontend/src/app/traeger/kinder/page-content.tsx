"use client";

// Kinder aller Schulen des Trägers (#8137, ADR 0327): eine Liste mit einem
// Reiter je Schule und „Alle“, damit das Träger-Büro ein Kind findet, ohne in
// jede Schule zu wechseln. Eine Zeile nennt Kind, Schule, Klasse und Gruppe,
// sonst nichts. Nur die Rolle mit dem Recht „Verträge verwalten“ sieht die
// Seite; jede geladene Seite und jeder Download steht im Zugriffsprotokoll
// der gezeigten Schulen.

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useLayoutEffect, useMemo, useRef, useState } from "react";
import { emptySearchText } from "~/components/traeger/empty-search";
import {
  traegerExportScope,
  useTraegerListExportItems,
} from "~/components/traeger/traeger-list-export-menu";
import { isRefusal } from "~/components/traeger/use-traeger-confirmed-resource";
import { useFreshTraegerResource } from "~/components/traeger/use-traeger-resource";
import { useTraegerSchools } from "~/components/traeger/use-traeger-schools";
import { Button } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { ListSkeleton } from "~/components/ui/page-skeletons";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { childrenConcept } from "~/lib/concepts/children";
import { createLogger } from "~/lib/logger";
import { schoolClassLabel, schoolClassName } from "~/lib/school-class-label";
import { IsolatedSWRCache } from "~/lib/swr";
import { useSWRRequestGuard } from "~/lib/swr/hooks";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  downloadTraegerChildren,
  fetchTraegerChildren,
  type TraegerChild,
  type TraegerChildrenPage,
  type TraegerSchoolChildCount,
} from "~/lib/traeger-children-api";

const logger = createLogger({ component: "TraegerChildrenPage" });

const TITLE = "Kinder";
/** Der Reiter über alle Schulen; jeder andere trägt die ID seiner Schule. */
const ALL_SCHOOLS = "alle";
/** Die Schule in der Adresse, damit ein Lesezeichen ihren Reiter öffnet. */
const SCHOOL_PARAM = "schule";
const LIST_OBJECT = "die Liste der Kinder";
/** So lange wartet das Suchfeld nach dem letzten Buchstaben, bevor es sucht. */
const SEARCH_PAUSE_MS = 250;

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

const plural = (count: number, one: string, many: string) =>
  count === 1 ? one : many;

/** Die Statuszeile: Kinder des offenen Reiters, bei einer Suche die Treffer. */
function childFigures(
  page: TraegerChildrenPage,
  allSchools: boolean,
  searching: boolean,
) {
  const children = {
    value: page.total,
    label: plural(page.total, "Kind", "Kinder"),
  };
  if (searching) {
    return [children, { value: page.matched, label: "gefunden" }];
  }
  if (allSchools && page.schools.length > 1) {
    return [children, { value: page.schools.length, label: "Schulen" }];
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
  const term = search.trim();
  const { show: showActionError } = useApiErrorDisplay();

  // Keep the last audited response's school metadata while a new list loads.
  // Shared metadata is only the initial fallback, for tabs and validation alike.
  const [counted, setCounted] = useState<
    readonly TraegerSchoolChildCount[] | null
  >(null);
  const schools: readonly (Pick<TraegerSchoolChildCount, "id" | "name"> &
    Partial<TraegerSchoolChildCount>)[] = counted ?? knownSchools ?? [];
  const school = schools.find((entry) => entry.id === tab);
  const schoolId =
    tab !== ALL_SCHOOLS && (school || (!counted && !knownSchools)) ? tab : "";
  const filter = useMemo(() => ({ schoolId, search: term }), [schoolId, term]);
  // Every page read stands in the access log of the schools it shows. So a
  // reiter or a search shows nothing until its own read answered, also when
  // the person comes back to one the tab has read before (ADR 0311).
  const listKey = traegerKeys.children(filter);
  const first = useFreshTraegerResource(
    listKey,
    () => fetchTraegerChildren(filter),
    LIST_OBJECT,
  );
  const beginPageRead = useSWRRequestGuard();

  // Later pages belong to the first page they continue; another reiter,
  // another search or a reload starts a new list and drops them.
  const [later, setLater] = useState<{
    readonly after: TraegerChildrenPage;
    readonly children: readonly TraegerChild[];
    readonly nextCursor: string;
  } | null>(null);
  const [loadingPage, setLoadingPage] = useState<TraegerChildrenPage | null>(
    null,
  );
  const page = first.data;
  if (page && page.schools !== counted) setCounted(page.schools);

  const shownPage = useRef<TraegerChildrenPage | null>(null);
  useLayoutEffect(() => {
    shownPage.current = page;
    return () => {
      shownPage.current = null;
    };
  }, [page]);
  const continued = later && later.after === page ? later : null;
  const children = useMemo(
    () => (page ? [...page.children, ...(continued?.children ?? [])] : []),
    [page, continued],
  );
  const nextCursor = continued?.nextCursor ?? page?.nextCursor;
  const loadingMore = page !== null && loadingPage === page;

  function withdrawRefusedList(error: unknown) {
    if (!page || shownPage.current !== page || !isRefusal(error)) return;
    first.readCallbacks.onError(error);
    void first.mutate(undefined, { revalidate: false });
    setLater(null);
  }

  const loadMore = async () => {
    if (!page || !nextCursor || loadingMore) return;
    let complete: ReturnType<typeof beginPageRead> | undefined;
    setLoadingPage(page);
    try {
      complete = beginPageRead(listKey);
      const next = await fetchTraegerChildren(filter, nextCursor);
      if (!complete.isCurrent() || shownPage.current !== page) return;
      setLater({
        after: page,
        children: [...(continued?.children ?? []), ...next.children],
        nextCursor: next.nextCursor,
      });
    } catch (err) {
      // A superseded request must not change the new list or report an error.
      if (!complete?.isCurrent() || shownPage.current !== page) return;
      if (isRefusal(err)) {
        withdrawRefusedList(err);
      } else {
        logger.error("traeger_children_load_more_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        await showActionError(err, { object: "die nächsten Kinder" });
      }
    } finally {
      setLoadingPage((current) => (current === page ? null : current));
    }
  };

  const changeTab = (next: string) => {
    const params = new URLSearchParams(searchParams?.toString());
    if (next === ALL_SCHOOLS) params.delete(SCHOOL_PARAM);
    else params.set(SCHOOL_PARAM, next);
    const query = params.toString();
    router.replace(query ? `?${query}` : "?", { scroll: false });
  };

  const exportItems = useTraegerListExportItems({
    download: (format) => downloadTraegerChildren(format, filter),
    scope: traegerExportScope(school?.name),
    fallbackName: "kinder",
    errorObject: LIST_OBJECT,
    unavailable: !page,
    onError: withdrawRefusedList,
  });

  // One school per reiter, or one school at all: its column would repeat
  // the same name on every row.
  const showSchool = schoolId === "" && schools.length > 1;
  const columns = useMemo(() => childColumns(showSchool), [showSchool]);
  const searching = term !== "";
  const loading = !page && !first.error;
  const noMatch = emptySearchText(search, []);
  // A search without a hit offers the way back. A list nobody can fill
  // from here is one sentence, not a stage.
  const empty =
    !page || children.length > 0
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
        page ? (
          <TenantPageStats
            items={childFigures(page, schoolId === "", searching)}
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
      error={first.error}
      empty={empty}
      // A list loads in the shape of its rows.
      loading={loading ? <ListSkeleton rows={8} avatar={false} /> : false}
    >
      {page ? (
        <DataTable
          columns={columns}
          rows={children}
          getRowKey={(child) => child.studentId}
          hiddenColumns={showSchool ? HIDE_NOTHING : HIDE_SCHOOL}
          stackedLayout="row"
          stackedDetailKey="class"
          moreAction={
            nextCursor
              ? {
                  label: `Weitere Kinder laden (${children.length} von ${page.matched})`,
                  onClick: () => void loadMore(),
                  loading: loadingMore,
                  loadingText: "Wird geladen …",
                  disabled: loadingMore,
                  tooltip:
                    "Zeigt die nächsten 50 Kinder unten in der Liste an.",
                }
              : undefined
          }
        />
      ) : null}
    </TenantPage>
  );
}
