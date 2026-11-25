"use client";

// Der Zeitexport des Trägers (#4712, ADR 0250 Punkt 8): ein festes CSV für
// Träger mit eigenem Zeiterfassungssystem, eine Zeile pro Person, Tag und
// Schule. Die Spalten stehen hier und in der Hilfe; Personen ohne
// Personalnummer fehlen in der Datei, die Seite nennt sie.

import { ArrowRightIcon, DownloadSimpleIcon } from "@phosphor-icons/react";

import { Button, ButtonLink } from "~/components/ui/button";
import { FramedList } from "~/components/ui/framed-list";
import { InsetPanel } from "~/components/ui/inset-panel";
import { SectionCard } from "~/components/ui/section-card";
import { StatCard } from "~/components/ui/stat-card";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
  ResponsiveRowActions,
} from "~/components/ui/responsive-action-list";
import { timeTrackingConcept } from "~/lib/concepts/timeTracking";
import type { TimeReport } from "~/lib/traeger-staff-exports-api";
import { traegerPath } from "~/lib/traeger-url";

/** Ein fester Wert einer Spalte und was er bedeutet. */
interface ColumnValue {
  readonly code: string;
  readonly meaning: string;
}

/** Die Spalten der Datei, in ihrer Reihenfolge. */
const TIME_EXPORT_COLUMNS: readonly {
  name: string;
  meaning: string;
  /** Feste Werte, die die Spalte annehmen kann. */
  values?: readonly ColumnValue[];
}[] = [
  { name: "Personalnummer", meaning: "Nummer aus der Personalakte." },
  { name: "Nachname", meaning: "Nachname der Person." },
  { name: "Vorname", meaning: "Vorname der Person." },
  {
    name: "Datum",
    meaning: "Tag als Jahr-Monat-Tag, zum Beispiel 2026-10-05.",
  },
  { name: "Einsatzort", meaning: "Name der Schule." },
  { name: "Beginn", meaning: "Erstes Einstempeln, zum Beispiel 08:00." },
  {
    name: "Ende",
    meaning:
      "Letztes Ausstempeln, zum Beispiel 16:30. Leer, solange die Person noch arbeitet.",
  },
  {
    name: "Pause_Minuten",
    meaning:
      "Pausen und Lücken, in Minuten. Eine Lücke ist die Zeit zwischen Ausstempeln und dem nächsten Einstempeln.",
  },
  {
    name: "Ist_Minuten",
    meaning: "Angerechnete Arbeitszeit ohne Pausen, in Minuten.",
  },
  {
    name: "Abwesenheit",
    meaning: "Fester Code der Abwesenheit. Leer an Tagen ohne Abwesenheit.",
    values: [
      { code: "vacation", meaning: "Urlaub" },
      { code: "sick", meaning: "Krank" },
      { code: "training", meaning: "Fortbildung" },
      { code: "comp_time", meaning: "Freizeitausgleich" },
      { code: "other", meaning: "Sonstige Abwesenheit" },
    ],
  },
  {
    name: "Abwesenheitsart",
    meaning: "Name der Abwesenheit, so wie die Schule sie nennt.",
  },
];

export function TimeExportPanel({
  report,
  monthLabel,
  onDownload,
  downloading,
}: Readonly<{
  report: TimeReport | null;
  monthLabel: string;
  onDownload: () => void;
  downloading: boolean;
}>) {
  const hasRows = (report?.rows ?? 0) > 0;
  return (
    <>
      <SectionCard
        concept={timeTrackingConcept}
        title="Zeitexport"
        description={`${monthLabel} · Für dein eigenes Zeiterfassungssystem. Eine Zeile pro Person, Tag und Schule.`}
        actions={
          <Button
            type="button"
            size="md"
            variant="primary"
            className="gap-2"
            disabled={!hasRows}
            disabledReason={
              hasRows
                ? undefined
                : "In diesem Monat gibt es keine Zeiten und keine Abwesenheiten."
            }
            isLoading={downloading}
            loadingText="Lädt"
            tooltip="Lädt die Zeiten als CSV herunter. Das steht im Zugriffsprotokoll jeder Schule."
            onClick={onDownload}
          >
            <DownloadSimpleIcon className="h-4 w-4" aria-hidden="true" />
            CSV herunterladen
          </Button>
        }
        loading={report === null}
        bodyClassName="mt-4 space-y-4"
      >
        {report ? (
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              variant="tile"
              label="Personen"
              value={String(report.people)}
            />
            <StatCard
              variant="tile"
              label="Schulen"
              value={String(report.schools)}
            />
            <StatCard
              variant="tile"
              label="Zeilen"
              value={String(report.rows)}
            />
          </div>
        ) : null}
      </SectionCard>

      {report && report.withoutNumber.length > 0 ? (
        <SectionCard
          title="Nicht in der Datei"
          description="Ohne Personalnummer kann dein System die Zeile niemandem zuordnen."
        >
          <ResponsiveActionList>
            {report.withoutNumber.map((person) => {
              const name = `${person.firstName} ${person.lastName}`.trim();
              return (
                <ResponsiveActionRow key={person.recordId}>
                  <p className="min-w-0 text-sm text-gray-800">
                    {name} hat noch keine Personalnummer.
                  </p>
                  <ResponsiveRowActions>
                    <ButtonLink
                      href={traegerPath(
                        `/traeger/personal/${encodeURIComponent(person.recordId)}`,
                      )}
                      variant="surface"
                      size="compact"
                      aria-label={`Personalakte von ${name} öffnen`}
                      tooltip="Öffnet die Personalakte, dort trägst du die Personalnummer ein."
                    >
                      Akte öffnen
                    </ButtonLink>
                  </ResponsiveRowActions>
                </ResponsiveActionRow>
              );
            })}
          </ResponsiveActionList>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Spalten der Datei"
        description="Die Reihenfolge bleibt fest, damit dein System die Datei jeden Monat gleich einliest."
      >
        <FramedList>
          {TIME_EXPORT_COLUMNS.map((column, index) => (
            <li
              key={column.name}
              className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 text-sm sm:grid-cols-[1.5rem_10rem_minmax(0,1fr)] sm:items-baseline"
            >
              <span className="text-gray-500 tabular-nums">{index + 1}</span>
              <code className="font-mono font-medium break-words text-gray-900">
                {column.name}
              </code>
              <div
                data-column-meaning
                className="col-start-2 text-gray-600 sm:col-start-3"
              >
                {column.meaning}
                {column.values ? (
                  <InsetPanel
                    as="ul"
                    padding="compact"
                    aria-label={`Codes der Spalte ${column.name}`}
                    className="mt-2 space-y-1"
                  >
                    {column.values.map((value) => (
                      <li key={value.code} className="flex items-center gap-2">
                        <code className="w-24 shrink-0 font-mono text-gray-900">
                          {value.code}
                        </code>
                        <ArrowRightIcon
                          className="h-3.5 w-3.5 shrink-0 text-gray-400"
                          aria-hidden="true"
                        />
                        <span className="text-gray-700">{value.meaning}</span>
                      </li>
                    ))}
                  </InsetPanel>
                ) : null}
              </div>
            </li>
          ))}
        </FramedList>
        <p className="mt-3 text-sm text-gray-600">
          Trennzeichen ist das Semikolon. Die Datei ist UTF-8 und öffnet sich so
          auch in Excel.
        </p>
      </SectionCard>
    </>
  );
}
