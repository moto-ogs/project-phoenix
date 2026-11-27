"use client";

// „Heute anders“ auf dem Start des Träger-Portals (#7672, #8146): pro Schule
// die Schließtage von heute, die geänderte Öffnungszeit, ein ausfallendes
// Mittagessen, die Zahl der abgesagten Termine und der gesperrten Räume. Nur
// Schulen mit Eintrag, jeweils mit Link in die Schulansicht. Keine Personen,
// keine Gründe. Personalmangel steht weiter unter den Auffälligkeiten.

import { CheckCircleIcon } from "@phosphor-icons/react/ssr";
import { useState } from "react";
import type { DayChangesDay } from "~/components/home/day-changes-text";
import { DaySwitch, nextDayISO } from "~/components/home/day-switch";
import { ButtonLink } from "~/components/ui/button";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
  ResponsiveRowActions,
} from "~/components/ui/responsive-action-list";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { trackEvent } from "~/lib/analytics";
import { activitiesConcept } from "~/lib/concepts/activities";
import { careTimesConcept } from "~/lib/concepts/careTimes";
import { closingDaysConcept } from "~/lib/concepts/closingDays";
import { dayChangesConcept } from "~/lib/concepts/dayChanges";
import { mealPlanConcept } from "~/lib/concepts/mealPlan";
import { roomsConcept } from "~/lib/concepts/rooms";
import type { MotoConcept } from "~/lib/moto-concepts";
import { schoolCountLabel } from "~/lib/traeger-alerts";
import {
  cancelledBlocksText,
  closedRoomsText,
  closingDayLabel,
  closingDayText,
  hasDayChange,
  openingChangeText,
} from "~/lib/traeger-day-changes-text";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { traegerPath } from "~/lib/traeger-url";
import { useTraegerDayChanges } from "./use-traeger-day-changes";

// Die Sätze des gewählten Tags (#8236): morgen ist der nächste Kalendertag,
// auch am Wochenende oder an einem Schließtag.
const DAY_WORD: Record<DayChangesDay, { word: string; Word: string }> = {
  today: { word: "heute", Word: "Heute" },
  tomorrow: { word: "morgen", Word: "Morgen" },
};

export function TraegerDayChangesCard() {
  const [day, setDay] = useState<DayChangesDay>("today");
  const today = useBerlinToday();
  const tomorrow = nextDayISO(today);
  const shown = day === "tomorrow" ? tomorrow : today;
  const {
    changes: anyDay,
    error,
    refreshFailed,
  } = useTraegerDayChanges(day === "tomorrow" ? tomorrow : undefined);
  // Die Antwort eines anderen Tags steht nie mit den Sätzen dieses Tags da.
  const changes = anyDay !== null && anyDay.day === shown ? anyDay : null;
  const { word, Word } = DAY_WORD[day];
  const schools = changes?.schools.filter(hasDayChange) ?? [];
  const quiet = changes !== null && schools.length === 0;
  return (
    <SectionCard
      title="Heute anders"
      testId="traeger-day-changes"
      loading={changes === null && !error}
      action={
        <DaySwitch
          value={day}
          onChange={(next) => {
            if (next === "tomorrow") trackEvent("day_changes_tomorrow_shown");
            setDay(next);
          }}
        />
      }
      titleBadge={
        schools.length > 0 ? (
          <StatusBadge
            tone="warning"
            label={schoolCountLabel(schools.length)}
          />
        ) : undefined
      }
      description={`Hier stehen die Schulen, an denen ${word} etwas anders läuft als geplant.`}
      leading={
        quiet ? (
          <CheckCircleIcon
            weight="duotone"
            className="text-moto-green-strong mt-0.5 size-5 shrink-0"
            aria-hidden="true"
          />
        ) : (
          <MotoConceptIcon
            concept={dayChangesConcept}
            className="mt-0.5 size-5 shrink-0"
            aria-hidden="true"
          />
        )
      }
    >
      {error ? <LoadErrorAlert error={error} /> : null}
      {refreshFailed ? (
        <p className="mb-3 text-sm text-gray-600">
          Die Liste konnte gerade nicht neu geladen werden und ist vielleicht
          nicht mehr aktuell.
        </p>
      ) : null}
      {quiet ? (
        <p className="text-sm text-gray-900">
          {Word} läuft an allen Schulen alles wie geplant.
        </p>
      ) : null}
      {schools.length > 0 ? (
        <ResponsiveActionList>
          {schools.map((school) => (
            <ResponsiveActionRow key={school.id}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  {school.name}
                  {school.city ? (
                    <span className="font-normal text-gray-500">
                      {" "}
                      · {school.city}
                    </span>
                  ) : null}
                </p>
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {school.closingDays.map((closing, index) => (
                    <DayChangeLine
                      // A school can have its own and a Träger closing day.
                      key={`closing-${index}`}
                      concept={closingDaysConcept}
                      label={closingDayLabel(closing)}
                      text={closingDayText(closing)}
                    />
                  ))}
                  {school.openingChanges.map((opening, index) => (
                    <DayChangeLine
                      // Overlapping changes of the hours are allowed.
                      key={`opening-${index}`}
                      concept={careTimesConcept}
                      label="Geänderte Öffnungszeit"
                      text={openingChangeText(opening)}
                      numeric
                    />
                  ))}
                  {school.mealCancelled ? (
                    <DayChangeLine
                      concept={mealPlanConcept}
                      label="Mittagessen"
                      text={`fällt ${word} aus`}
                    />
                  ) : null}
                  {school.cancelledBlocks > 0 ? (
                    <DayChangeLine
                      concept={activitiesConcept}
                      label="Stundenplan"
                      text={cancelledBlocksText(school.cancelledBlocks)}
                      numeric
                    />
                  ) : null}
                  {school.closedRooms > 0 ? (
                    <DayChangeLine
                      concept={roomsConcept}
                      label="Räume"
                      text={closedRoomsText(school.closedRooms)}
                      numeric
                    />
                  ) : null}
                </ul>
              </div>
              <ResponsiveRowActions>
                <ButtonLink
                  href={traegerPath(`/traeger/schulen/${school.id}`)}
                  variant="surface"
                  size="compact"
                  aria-label={`Zur Schule: ${school.name}`}
                  tooltip="Öffnet die Zahlen und Angaben dieser Schule."
                >
                  Zur Schule
                </ButtonLink>
              </ResponsiveRowActions>
            </ResponsiveActionRow>
          ))}
        </ResponsiveActionList>
      ) : null}
    </SectionCard>
  );
}

/** Eine Zeile pro Art: Symbol, Art und was an dem Tag anders ist. */
function DayChangeLine({
  concept,
  label,
  text,
  numeric = false,
}: {
  readonly concept: MotoConcept;
  readonly label: string;
  readonly text: string;
  readonly numeric?: boolean;
}) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <MotoConceptIcon
        concept={concept}
        className="mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />
      <span className="min-w-0 text-gray-600">
        <span className="font-medium text-gray-900">{label}:</span>{" "}
        <span className={numeric ? "tabular-nums" : undefined}>{text}</span>
      </span>
    </li>
  );
}
