"use client";

// Der Zeitexport des Trägers (#4712, ADR 0250 Punkt 8): ein festes CSV für
// Träger mit eigenem Zeiterfassungssystem, eine Zeile je Person, Tag und
// Schule. Die Spalten stehen hier und in der Hilfe; Personen ohne
// Personalnummer fehlen in der Datei, die Seite nennt sie.

import { DownloadSimpleIcon } from "@phosphor-icons/react";

import { Button, ButtonLink } from "~/components/ui/button";
import { FramedList } from "~/components/ui/framed-list";
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

/** Die Spalten der Datei, in ihrer Reihenfolge. */
const TIME_EXPORT_COLUMNS: readonly {
  name: string;
  meaning: string;
}[] = [
  { name: "Personalnummer", meaning: "Die Nummer aus der Personalakte." },
  { name: "Nachname", meaning: "Der Nachname der Person." },
  { name: "Vorname", meaning: "Der Vorname der Person." },
  { name: "Datum", meaning: "Der Tag, zum Beispiel 2026-10-05." },
  { name: "Einsatzort", meaning: "Der Name der Schule." },
  { name: "Beginn", meaning: "Das erste Einstempeln, zum Beispiel 08:00." },
  {
    name: "Ende",
    meaning: "Das letzte Ausstempeln. Leer, solange jemand arbeitet.",
  },
  {
    name: "Pause_Minuten",
    meaning: "Pausen und Lücken zwischen zwei Zeiten, in Minuten.",
  },
  { name: "Ist_Minuten", meaning: "Die angerechnete Arbeitszeit, in Minuten." },
  {
    name: "Abwesenheit",
    meaning:
      "Ein fester Code: vacation heißt Urlaub, sick krank, training Fortbildung, comp_time Freizeitausgleich, other sonstige.",
  },
  {
    name: "Abwesenheitsart",
    meaning: "Der Name der Abwesenheit an der Schule.",
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
        description={`${monthLabel} · Für dein eigenes Zeiterfassungssystem. Eine Zeile je Person, Tag und Schule.`}
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
              className="grid grid-cols-[2rem_minmax(0,9rem)_minmax(0,1fr)] items-baseline gap-3 px-4 py-2.5 text-sm"
            >
              <span className="text-gray-500 tabular-nums">{index + 1}</span>
              <code className="truncate font-mono text-gray-900">
                {column.name}
              </code>
              <span className="text-gray-600">{column.meaning}</span>
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
