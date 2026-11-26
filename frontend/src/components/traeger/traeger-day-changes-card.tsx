"use client";

// „Heute anders“ auf dem Start des Träger-Portals (#7672): pro Schule die
// Schließtage von heute und die Zahl der abgesagten Termine. Nur Schulen mit
// Eintrag, jeweils mit Link in die Schulansicht. Keine Personen, keine
// Gründe. Personalmangel steht weiter unter den Auffälligkeiten.

import { CheckCircleIcon } from "@phosphor-icons/react/ssr";
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
import { activitiesConcept } from "~/lib/concepts/activities";
import { closingDaysConcept } from "~/lib/concepts/closingDays";
import { dayChangesConcept } from "~/lib/concepts/dayChanges";
import { schoolCountLabel } from "~/lib/traeger-alerts";
import {
  cancelledBlocksText,
  closingDayLabel,
  closingDayText,
  hasDayChange,
} from "~/lib/traeger-day-changes-text";
import { traegerPath } from "~/lib/traeger-url";
import { useTraegerDayChanges } from "./use-traeger-day-changes";

export function TraegerDayChangesCard() {
  const { changes, error, refreshFailed } = useTraegerDayChanges();
  const schools = changes?.schools.filter(hasDayChange) ?? [];
  const quiet = changes !== null && schools.length === 0;
  return (
    <SectionCard
      title="Heute anders"
      testId="traeger-day-changes"
      loading={changes === null && !error}
      titleBadge={
        schools.length > 0 ? (
          <StatusBadge
            tone="warning"
            label={schoolCountLabel(schools.length)}
          />
        ) : undefined
      }
      description="Hier stehen die Schulen, an denen heute etwas anders läuft als geplant."
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
          Heute läuft an allen Schulen alles wie geplant.
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
                    <li
                      // A school can have its own and a Träger closing day.
                      key={`closing-${index}`}
                      className="flex items-start gap-2 text-sm"
                    >
                      <MotoConceptIcon
                        concept={closingDaysConcept}
                        className="mt-0.5 size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 text-gray-600">
                        <span className="font-medium text-gray-900">
                          {closingDayLabel(closing)}:
                        </span>{" "}
                        {closingDayText(closing)}
                      </span>
                    </li>
                  ))}
                  {school.cancelledBlocks > 0 ? (
                    <li className="flex items-start gap-2 text-sm">
                      <MotoConceptIcon
                        concept={activitiesConcept}
                        className="mt-0.5 size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 text-gray-600">
                        <span className="font-medium text-gray-900">
                          Stundenplan:
                        </span>{" "}
                        <span className="tabular-nums">
                          {cancelledBlocksText(school.cancelledBlocks)}
                        </span>
                      </span>
                    </li>
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
