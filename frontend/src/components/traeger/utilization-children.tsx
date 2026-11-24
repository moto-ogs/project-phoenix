"use client";

// Die Kinder einer Schule mit Namen (#4713, Story 118): standardmäßig
// zusammengefasst, personenscharf nur mit „Verträge verwalten“. Die Namen
// lädt die Seite erst, wenn die Person sie anfordert; jede Lesung steht im
// Zugriffsprotokoll der Schule. Gezählt wird erst ab dem ersten Check-in der
// Schule: davor fehlt jede Anwesenheit, und jeder Betreuungstag hieße sonst
// „ohne Grund“ gefehlt.

import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { ProgressBar } from "~/components/ui/progress-bar";
import { SectionCard } from "~/components/ui/section-card";
import { useApiLoadError } from "~/contexts/ToastContext";
import { childrenConcept } from "~/lib/concepts/children";
import { formatDate } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import { schoolClassLabel } from "~/lib/school-class-label";
import {
  fetchUtilizationChildren,
  type UtilizationChild,
  type UtilizationChildren,
  type UtilizationWindow,
} from "~/lib/traeger-utilization-api";
import { formatUtilization } from "./utilization-tables";

const logger = createLogger({ component: "TraegerUtilizationChildren" });

const TITLE = "Kinder mit Namen";

/** Die Schule, wie die Seite sie wählt; `attendanceFrom` ist ihr erster Check-in. */
interface UtilizationChildrenSchool {
  readonly id: string;
  readonly name: string;
  readonly attendanceFrom: string | null;
}

/**
 * Der Zeitraum, den die Namen zählen: ab dem ersten Check-in der Schule;
 * `null`, wenn sie im Zeitraum keinen hat.
 */
function countedWindow(
  school: UtilizationChildrenSchool,
  period: UtilizationWindow,
): UtilizationWindow | null {
  if (school.attendanceFrom === null || school.attendanceFrom > period.to) {
    return null;
  }
  return school.attendanceFrom > period.from
    ? { from: school.attendanceFrom, to: period.to }
    : period;
}

function Count({ value }: Readonly<{ value: number }>) {
  return <span className="text-sm text-gray-700 tabular-nums">{value}</span>;
}

const CHILD_COLUMNS: DataTableColumn<UtilizationChild>[] = [
  {
    key: "name",
    header: "Kind",
    render: (child) => (
      <div className="min-w-0">
        <span className="font-medium text-gray-900">
          {child.lastName}, {child.firstName}
        </span>
        <span className="block text-sm text-gray-500">
          {[
            child.schoolClass ? schoolClassLabel(child.schoolClass) : "",
            child.groupName,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    ),
    sortValue: (child) => `${child.lastName} ${child.firstName}`,
    stacked: "title",
  },
  {
    key: "present",
    header: "Da",
    render: (child) => (
      <div className="w-40 max-md:w-full">
        <span className="text-sm whitespace-nowrap text-gray-900 tabular-nums">
          <span className="font-semibold">{child.presentDays}</span>
          <span className="text-gray-500"> von {child.careDays} Tagen</span>
          <span className="ml-2 text-gray-500">
            {formatUtilization(
              child.attendanceRate === null ? null : child.attendanceRate / 100,
            )}
          </span>
        </span>
        <ProgressBar
          value={child.presentDays}
          max={Math.max(child.careDays, 1)}
          label={`${child.presentDays} von ${child.careDays} Betreuungstagen da`}
          className="mt-1.5"
        />
      </div>
    ),
    sortValue: (child) => child.attendanceRate,
  },
  {
    key: "sick",
    header: "Krank",
    align: "right",
    render: (child) => <Count value={child.sickDays} />,
    sortValue: (child) => child.sickDays,
  },
  {
    key: "excused",
    header: "Entschuldigt",
    align: "right",
    render: (child) => <Count value={child.excusedDays} />,
    sortValue: (child) => child.excusedDays,
  },
  {
    key: "unexplained",
    header: "Ohne Grund",
    align: "right",
    headerTitle: "Nicht da, ohne Krankmeldung oder Entschuldigung",
    render: (child) => <Count value={child.unexplainedDays} />,
    sortValue: (child) => child.unexplainedDays,
  },
];

/**
 * Ohne Recht ein Hinweis, wer die Namen sieht; ohne gewählte Schule ein
 * Hinweis, was zu tun ist; sonst die Kinder der Schule auf Anforderung.
 */
export function UtilizationChildrenSection({
  canSeeNames,
  school,
  period,
}: Readonly<{
  canSeeNames: boolean;
  school: UtilizationChildrenSchool | null;
  period: UtilizationWindow;
}>) {
  const [children, setChildren] = useState<UtilizationChildren | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const loadError = useApiLoadError();
  const { clear } = loadError;
  const schoolId = school?.id ?? null;
  const counted = school === null ? null : countedWindow(school, period);

  // Another school or window drops the names on screen and every answer
  // still on its way.
  useEffect(() => {
    request.current++;
    setChildren(null);
    setLoading(false);
    clear();
  }, [schoolId, period.from, period.to, clear]);

  if (!canSeeNames) {
    return (
      <SectionCard
        title={TITLE}
        concept={childrenConcept}
        description="Die Namen der Kinder sehen nur Personen mit dem Recht „Verträge verwalten“. Dieses Recht hat die Rolle Verwaltung."
      />
    );
  }
  if (school === null) {
    return (
      <SectionCard
        title={TITLE}
        concept={childrenConcept}
        description="Wähle oben eine Schule. Dann siehst du, an wie vielen Tagen jedes Kind da war."
      />
    );
  }

  if (counted === null) {
    return (
      <SectionCard
        title={TITLE}
        concept={childrenConcept}
        description={`Die ${school.name} hat im Zeitraum keine Check-ins. Deshalb gibt es keine Tage je Kind.`}
      />
    );
  }
  const window = counted;
  const later = window.from !== period.from;

  async function load(target: { readonly id: string }) {
    const current = ++request.current;
    setLoading(true);
    try {
      const result = await fetchUtilizationChildren(target.id, window);
      if (current !== request.current) return;
      setChildren(result);
      clear();
    } catch (err) {
      if (current !== request.current) return;
      logger.error("traeger_utilization_children_load_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await loadError.show(err, {
        object: "die Kinder mit Namen",
        retry: () => void load(target),
      });
    } finally {
      if (current === request.current) setLoading(false);
    }
  }

  if (children === null) {
    return (
      <SectionCard
        title={TITLE}
        concept={childrenConcept}
        description={`An wie vielen Tagen jedes Kind der ${school.name} da war${later ? `, ab dem ersten Check-in am ${formatDate(window.from)}` : ""}. Die Schule sieht im Zugriffsprotokoll, dass du die Namen geöffnet hast.`}
        action={
          <Button
            type="button"
            variant="outline"
            size="md"
            isLoading={loading}
            loadingText="Wird geladen…"
            onClick={() => void load(school)}
            tooltip="Zeigt die Kinder mit Namen. Die Schule sieht das im Zugriffsprotokoll."
          >
            Namen anzeigen
          </Button>
        }
      >
        {loadError.error ? (
          <LoadErrorAlert error={loadError.error} actionLayout="responsive" />
        ) : null}
      </SectionCard>
    );
  }

  return (
    <DataTable
      heading={{
        title: later
          ? `${TITLE} · ${children.schoolName} · ab ${formatDate(window.from)}`
          : `${TITLE} · ${children.schoolName}`,
        count: children.children.length,
        level: 2,
      }}
      columns={CHILD_COLUMNS}
      rows={[...children.children]}
      getRowKey={(child) => child.studentId}
      defaultSortKey="name"
      pageSize={25}
      pageNoun="Kinder"
      emptyState={
        <EmptyState
          variant="compact"
          title="Keine Kinder im Zeitraum"
          description="Die Schule hat in diesem Zeitraum kein Kind betreut."
        />
      }
    />
  );
}
