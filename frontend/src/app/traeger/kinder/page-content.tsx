"use client";

// Kinder aller Schulen des Trägers (#8137, ADR 0327): eine Liste mit einem
// Reiter je Schule und „Alle“, damit das Träger-Büro ein Kind findet, ohne in
// jede Schule zu wechseln. Eine Zeile nennt Kind, Schule, Klasse und Gruppe,
// sonst nichts. Nur die Rolle mit dem Recht „Verträge verwalten“ sieht die
// Seite; jede geladene Seite und jeder Download steht im Zugriffsprotokoll
// der gezeigten Schulen.

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { emptySearchText } from "~/components/traeger/empty-search";
import {
  traegerExportScope,
  useTraegerListExportItems,
} from "~/components/traeger/traeger-list-export-menu";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { useTraegerSchools } from "~/components/traeger/use-traeger-schools";
import { Button } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { ListSkeleton } from "~/components/ui/page-skeletons";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { childrenConcept } from "~/lib/concepts/children";
import { createLogger } from "~/lib/logger";
import { schoolClassLabel, schoolClassName } from "~/lib/school-class-label";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  downloadTraegerChildren,
  fetchTraegerChildren,
  type TraegerChild,
  type TraegerChildrenPage,
  type TraegerSchoolChildCount,
} from "~/lib/traeger-children-api";
import { useDebounce } from "~/lib/use-debounce";

const logger = createLogger({ component: "TraegerChildrenPage" });

const TITLE = "Kinder";
/** Der Reiter über alle Schulen; jeder andere trägt die ID seiner Schule. */
const ALL_SCHOOLS = "alle";
/** Die Schule in der Adresse, damit ein Lesezeichen ihren Reiter öffnet. */
const SCHOOL_PARAM = "schule";
const LIST_OBJECT = "die Liste der Kinder";

// Jede geladene Seite steht im Zugriffsprotokoll der gezeigten Schulen: ein
// Lesen je Öffnen und Filter, keines beim Zurückkehren in den Tab, bei neuer
// Verbindung oder aus dem Dedupe-Fenster.
const ONCE_PER_OPENING = {
  revalidateOnMount: true,
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  dedupingInterval: 0,
};

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
      <ChildrenContent />
    </Suspense>
  );
}

function ChildrenContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(
    () => searchParams?.get(SCHOOL_PARAM) ?? ALL_SCHOOLS,
  );
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search.trim(), 250);
  const schoolList = useTraegerSchools();
  const { show: showActionError } = useApiErrorDisplay();

  // A school the Träger no longer has, or a mistyped address, opens „Alle“.
  const knownSchools = schoolList.schools;
  const schoolId =
    tab !== ALL_SCHOOLS &&
    (!knownSchools || knownSchools.some((school) => school.id === tab))
      ? tab
      : "";
  const filter = useMemo(
    () => ({ schoolId, search: debouncedSearch }),
    [schoolId, debouncedSearch],
  );
  const first = useTraegerResource(
    traegerKeys.children(filter),
    () => fetchTraegerChildren(filter),
    LIST_OBJECT,
    ONCE_PER_OPENING,
  );

  // Later pages belong to the first page they continue; another reiter,
  // another search or a reload starts a new list and drops them.
  const [later, setLater] = useState<{
    readonly after: TraegerChildrenPage;
    readonly children: readonly TraegerChild[];
    readonly hasMore: boolean;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const page = first.data ?? null;
  const continued = later && later.after === page ? later : null;
  const children = useMemo(
    () => (page ? [...page.children, ...(continued?.children ?? [])] : []),
    [page, continued],
  );
  const hasMore = continued ? continued.hasMore : (page?.hasMore ?? false);

  const loadMore = async () => {
    if (!page) return;
    setLoadingMore(true);
    try {
      const next = await fetchTraegerChildren(filter, children.length);
      setLater({
        after: page,
        children: [...(continued?.children ?? []), ...next.children],
        hasMore: next.hasMore,
      });
    } catch (err) {
      logger.error("traeger_children_load_more_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await showActionError(err, { object: "die nächsten Kinder" });
    } finally {
      setLoadingMore(false);
    }
  };

  // The reiters come from the schools the page was opened with, so they
  // stand while a list loads; the list's own answer keeps them current.
  const schools: readonly Pick<TraegerSchoolChildCount, "id" | "name">[] =
    page?.schools ?? knownSchools ?? [];
  const school = schools.find((entry) => entry.id === schoolId);
  const changeTab = (next: string) => {
    setTab(next);
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
  });

  // One school per reiter, or one school at all: its column would repeat
  // the same name on every row.
  const showSchool = schoolId === "" && schools.length > 1;
  const columns = useMemo(() => childColumns(showSchool), [showSchool]);
  const searching = debouncedSearch !== "";
  const loading = !page && !first.error;
  const emptyText = searching
    ? {
        title: "Kein Kind gefunden",
        description: emptySearchText(search, []).description,
      }
    : school
      ? {
          title: "Keine Kinder an dieser Schule",
          description: `${school.name} führt heute kein Kind mit Betreuungsplatz.`,
        }
      : {
          title: "Noch keine Kinder",
          description:
            "Sobald eine deiner Schulen Kinder mit Betreuungsplatz führt, stehen sie hier.",
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
        onChange: setSearch,
        placeholder: "Kind suchen",
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
                })),
              ],
            }
          : undefined
      }
      error={first.error}
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
            hasMore
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
          emptyState={
            <EmptyState
              icon={
                <MotoConceptIcon
                  concept={childrenConcept}
                  className="h-12 w-12"
                />
              }
              {...emptyText}
              action={
                searching ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    tooltip="Leert die Suche und zeigt wieder alle Kinder."
                    onClick={() => setSearch("")}
                  >
                    {emptySearchText(search, []).actionLabel}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      ) : null}
    </TenantPage>
  );
}
