"use client";

// Startseite des Träger-Portals ("moto träger", #4649): alle Schulen des
// Trägers der Sitzung. Schulen ordnet das moto-Team zu. Eine Zeile führt in die
// Ansicht der Schule im Träger-Portal (#5686). Wer das Recht „In OGS wechseln"
// hat, öffnet die Schul-App ohne neue Anmeldung in einem neuen Tab (#4654).

import { type MouseEvent, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, School } from "lucide-react";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import NavigationLink from "~/components/ui/navigation-link";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import type { TraegerSchool } from "~/lib/traeger-api";
import {
  SCHOOL_SWITCH_MISSING_HINT,
  useOpenTraegerSchool,
} from "~/components/traeger/use-open-traeger-school";
import { TraegerCodeStepModal } from "~/components/traeger/traeger-code-step-modal";
import {
  TraegerListExportMenu,
  traegerExportScope,
} from "~/components/traeger/traeger-list-export-menu";
import { useTraegerSchools } from "~/components/traeger/use-traeger-schools";
import { downloadTraegerList } from "~/lib/traeger-list-export";
import {
  TRAEGER_HANDOFF_OPEN,
  TRAEGER_HANDOFF_OPEN_HINT,
} from "~/lib/traeger-handoff";
import { traegerPath } from "~/lib/traeger-url";

const COLUMNS: DataTableColumn<TraegerSchool>[] = [
  {
    key: "name",
    header: "Schule",
    // Der Link ist der Weg per Tastatur und Vorlesehilfe; die Zeile hat eigene
    // Bedienelemente und wird deshalb selbst kein Knopf.
    render: (school) => (
      <NavigationLink
        href={traegerPath(`/traeger/schulen/${school.id}`)}
        className="font-medium text-gray-900 hover:underline"
        onClick={(event: MouseEvent<HTMLAnchorElement>) =>
          event.stopPropagation()
        }
      >
        {school.name}
      </NavigationLink>
    ),
    sortValue: (school) => school.name,
    stacked: "title",
  },
  {
    key: "city",
    header: "Ort",
    render: (school) => school.city || "–",
    sortValue: (school) => school.city || null,
    stacked: "meta",
  },
];

export default function TraegerSchoolsPage() {
  const { schools: schoolData, error: schoolsError } = useTraegerSchools();
  const schools = schoolData ?? [];
  const loading = schoolData === null && !schoolsError;
  const router = useRouter();
  const { canOpen, opening, open, codeStepModal } = useOpenTraegerSchool();

  const columns = useMemo<DataTableColumn<TraegerSchool>[]>(
    () =>
      canOpen
        ? [
            // On a phone the button takes the place beside the name; the
            // city moves under it.
            ...COLUMNS.map((column) =>
              column.key === "city"
                ? { ...column, stacked: "field" as const }
                : column,
            ),
            {
              key: "actions",
              header: "",
              align: "right",
              stacked: "meta",
              stackedLabel: false,
              render: (school) => (
                <Button
                  type="button"
                  variant="surface"
                  size="compact"
                  aria-label={`${TRAEGER_HANDOFF_OPEN}: ${school.name}, neuer Tab`}
                  tooltip={TRAEGER_HANDOFF_OPEN_HINT}
                  disabled={opening !== null}
                  onClick={(event) => {
                    // Die Aktion öffnet die Schul-App, nicht die Schulansicht.
                    event.stopPropagation();
                    void open(school);
                  }}
                >
                  {opening === school.id ? (
                    "Wird geöffnet …"
                  ) : (
                    <>
                      {TRAEGER_HANDOFF_OPEN}
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </>
                  )}
                </Button>
              ),
            },
          ]
        : COLUMNS,
    [canOpen, open, opening],
  );

  return (
    <TenantPage
      title="Schulen"
      info={
        <>
          Alle Schulen deines Trägers. Neue Schulen ordnet das moto-Team zu. Ein
          Klick auf eine Schule zeigt ihre Zahlen und Stammdaten.
          {canOpen &&
            " „Schul-App öffnen“ zeigt die Schule in einem neuen Tab. Dort hast du dieselben Rechte wie die Verwaltung der Schule. Mit „Zurück zur Träger-App“ kommst du wieder hierher."}
        </>
      }
      stats={
        schools.length > 0 ? (
          <TenantPageStats
            items={[
              {
                value: schools.length,
                label: schools.length === 1 ? "Schule" : "Schulen",
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      error={schoolsError}
      actions={
        <TraegerListExportMenu
          download={(format) =>
            downloadTraegerList("/api/traeger/schools/export", format)
          }
          scope={traegerExportScope()}
          ariaLabel="Schulen herunterladen"
          fallbackName="schulen"
          errorObject="die Liste der Schulen"
          unavailable={schools.length === 0}
        />
      }
    >
      {!canOpen && (
        <Alert
          type="info"
          announce="off"
          message={SCHOOL_SWITCH_MISSING_HINT}
        />
      )}
      <DataTable
        columns={columns}
        rows={schools}
        getRowKey={(school) => school.id}
        isLoading={loading}
        loadingRowCount={3}
        defaultSortKey="name"
        stackedOnMobile
        stackedLayout="row"
        stackedDetailKey={canOpen ? "city" : null}
        rowHasInteractiveControls
        onRowClick={(school) =>
          router.push(traegerPath(`/traeger/schulen/${school.id}`))
        }
        emptyState={
          <EmptyState
            icon={<School className="h-12 w-12" aria-hidden="true" />}
            title="Deinem Träger sind noch keine Schulen zugeordnet."
            description="Das moto-Team ordnet die Schulen deinem Träger zu."
          />
        }
      />
      <TraegerCodeStepModal {...codeStepModal} />
    </TenantPage>
  );
}
