"use client";

// Plätze eines Ferienzeitraums (#4699): je Woche, wie viele Plätze es gibt,
// wie viele vergeben sind und wer auf der Warteliste steht. Das Büro legt
// hier die Plätze je Woche fest. Mehr Plätze geben die Warteliste sofort
// frei, in der Reihenfolge der Anmeldung.

import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { holidayPeriodTabs } from "~/components/traeger/holiday-period-head";
import { schoolNames } from "~/components/traeger/holiday-registration-format";
import { HolidayWeekPlacesCard } from "~/components/traeger/holiday-week-places";
import { useTraegerHolidayPeriod } from "~/components/traeger/use-traeger-resources";
import { useTraegerSchools } from "~/components/traeger/use-traeger-schools";
import {
  TraegerListExportMenu,
  traegerExportScope,
} from "~/components/traeger/traeger-list-export-menu";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { fetchHolidayWeekPlaces } from "~/lib/traeger-holiday-registrations-api";
import { downloadTraegerList } from "~/lib/traeger-list-export";
import { traegerPath } from "~/lib/traeger-url";

export default function TraegerHolidayPlacesPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const {
    data: period,
    preview,
    loadError: periodError,
  } = useTraegerHolidayPeriod(id);
  const { schools } = useTraegerSchools();
  const names = useMemo(() => schoolNames(schools), [schools]);
  const {
    data: weeks,
    error: placesError,
    reload,
  } = useTraegerResource(
    id ? traegerKeys.holidayPlaces(id) : null,
    () => fetchHolidayWeekPlaces(id),
    "die Plätze",
  );
  const [editing, setEditing] = useState<string | null>(null);
  const loadError = placesError ?? periodError;
  const totals = useMemo(() => {
    const all = weeks ?? [];
    return {
      placed: all.reduce((sum, week) => sum + week.placed, 0),
      pending: all.reduce((sum, week) => sum + (week.pending ?? 0), 0),
      waiting: new Set(
        all.flatMap((week) => week.waitlist.map((entry) => entry.childId)),
      ).size,
    };
  }, [weeks]);

  return (
    <TenantPage
      title={period?.name ?? preview?.name ?? "Ferienzeitraum"}
      back
      backHref={traegerPath("/traeger/ferien")}
      backLabel="Zurück zu den Ferien"
      info={
        period?.allocationMode === "criteria" ? (
          <p>
            Hier legst du fest, wie viele Kinder in einer Woche mitmachen
            können. Die Plätze vergibt dein Büro im Reiter „Vergabe“. moto
            sortiert die Anmeldungen dafür nach deinen Kriterien vor. Wird
            später ein Platz frei, rückt das nächste Kind der Warteliste
            automatisch nach. Seine Eltern bekommen eine E-Mail. Kinder auf der
            Warteliste oder mit offenem Platz zahlen nichts und stehen nicht auf
            der Liste der OGS.
          </p>
        ) : (
          <p>
            Hier legst du fest, wie viele Kinder in einer Woche mitmachen
            können. Plätze gehen in der Reihenfolge, in der die Anmeldungen
            eingehen. Ist eine Woche voll, kommt das Kind auf die Warteliste.
            Wird ein Platz frei, rückt das nächste Kind automatisch nach. Seine
            Eltern bekommen eine E-Mail. Kinder auf der Warteliste zahlen nichts
            und stehen nicht auf der Liste der OGS.
          </p>
        )
      }
      stats={
        weeks ? (
          // Wochen und ihre Grenze zeigt jede Wochenkarte; die Zeile trägt
          // nur die Summen über alle Wochen (#7402).
          <TenantPageStats
            items={[
              { value: totals.placed, label: "Plätze vergeben" },
              ...(totals.pending > 0
                ? [{ value: totals.pending, label: "offen" }]
                : []),
              ...(totals.waiting > 0
                ? [
                    {
                      value: totals.waiting,
                      label:
                        totals.waiting === 1
                          ? "Kind wartet auf einen Platz"
                          : "Kinder warten auf einen Platz",
                    },
                  ]
                : []),
            ]}
          />
        ) : null
      }
      statsLoading={!weeks && !loadError}
      tabs={holidayPeriodTabs(
        id,
        "plaetze",
        period?.registrationCount,
        period?.allocationMode,
      )}
      actions={
        <TraegerListExportMenu
          download={(format) =>
            downloadTraegerList(
              `/api/traeger/holiday-periods/${id}/places/export`,
              format,
            )
          }
          scope={traegerExportScope()}
          ariaLabel="Plätze und Warteliste herunterladen"
          fallbackName="plaetze"
          errorObject="die Plätze"
          unavailable={!weeks || weeks.length === 0}
        />
      }
      error={loadError}
      loading={!loadError && !weeks}
      empty={
        weeks?.length === 0
          ? {
              title: "Noch keine Wochen",
              description:
                "Lege zuerst im Reiter „Planung“ die Wochen der Ferien an.",
            }
          : undefined
      }
    >
      {/* Equal week cards in a grid: grids do not grow (TenantPage body
          rule), so the last week keeps its height like its siblings. */}
      {weeks && weeks.length > 0 ? (
        <div className="compact:gap-4 grid gap-6 max-sm:gap-3">
          {weeks.map((week) => (
            <HolidayWeekPlacesCard
              key={week.weekId}
              periodId={id}
              week={week}
              noCareDays={
                period?.weeks.find((w) => w.id === week.weekId)?.noCareDays
              }
              hostSchoolName={names.get(week.hostSchoolId) ?? "Schule"}
              editing={editing === week.weekId}
              onEdit={() => setEditing(week.weekId)}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                reload();
              }}
            />
          ))}
        </div>
      ) : null}
    </TenantPage>
  );
}
