"use client";

// Einsatzplanung des Trägers über alle Standorte (#4708, ADR 0242). Die
// Personalverwaltung sieht die Woche jeder Person mit Personalakte an allen
// ihren Einsatzorten und plant dort Schichten. Jede Schicht steht sofort im
// Dienstplan der Schule. moto prüft jede Schicht über alle Einsatzorte:
// Überschneidungen sind gesperrt, Verstöße gegen die Arbeitszeitregeln
// brauchen eine Bestätigung mit Begründung.

import { GearSixIcon, LockKeyIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import {
  PlanShiftModal,
  type PlanShiftTarget,
} from "~/components/traeger/planning/plan-shift-modal";
import {
  addDaysISO,
  mondayOf,
  planningDays,
  planningWeekLabel,
  rulesSummary,
  schoolColors,
} from "~/components/traeger/planning/planning-format";
import { PlanningWeekGrid } from "~/components/traeger/planning/planning-week-grid";
import { TraegerListExportMenu } from "~/components/traeger/traeger-list-export-menu";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Alert } from "~/components/ui/alert";
import { ButtonLink } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { PlanningContextBar } from "~/components/ui/planning/planning-context-bar";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useToast } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerStaffKeys } from "~/lib/swr/traeger-staff-keys";
import {
  downloadTraegerPlanningWeek,
  fetchTraegerPlanningWeek,
} from "~/lib/traeger-planning-api";
import { describeWorkingTimeWarning } from "~/lib/working-time";

const NOT_RELEASED = "workforce.traeger_staff_not_released";
const RULES_HREF = "/traeger/einstellungen?bereich=einsatzplanung";

const INFO = (
  <div className="space-y-2">
    <p>
      Hier planst du Personen mit Personalakte an allen ihren Schulen. Jede
      Schicht steht sofort im Dienstplan der Schule.
    </p>
    <p>
      moto zählt dabei alle Schulen der Person zusammen: Stunden am Tag,
      Ruhezeit, Pausen und das Soll aus dem Arbeitsvertrag. Zwei Schichten zur
      selben Zeit an zwei Schulen gehen nicht.
    </p>
    <p>
      Gestrichelt steht ein Vorschlag aus dem Arbeitsvertrag: die Stunden des
      Tages an einer Schule, an der noch keine Schicht steht. Wähle ihn, prüfe
      Beginn und Ende und wähle „Planen“.
    </p>
  </div>
);

export default function TraegerStaffPlanningPage() {
  const today = useBerlinToday();
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [target, setTarget] = useState<PlanShiftTarget | null>(null);
  const { success } = useToast();
  const invalidateFamily = useInvalidateFamily();
  const {
    data: shownWeek,
    error,
    failure,
  } = useTraegerResource(
    traegerStaffKeys.planningWeek(weekStart),
    () => fetchTraegerPlanningWeek(weekStart),
    "die Einsatzplanung",
  );
  const notReleased =
    failure instanceof ApiError && failure.code === NOT_RELEASED;
  const loadError = notReleased ? null : error;
  const colors = useMemo(
    () => schoolColors(shownWeek?.schools ?? []),
    [shownWeek],
  );
  const days = useMemo(
    () => planningDays(weekStart, shownWeek?.people ?? []),
    [weekStart, shownWeek],
  );
  const shiftCount =
    shownWeek?.people.reduce(
      (sum, person) =>
        sum + person.shifts.filter((shift) => !shift.cancelled).length,
      0,
    ) ?? 0;
  const warned = useMemo(
    () =>
      (shownWeek?.people ?? []).filter((person) => person.warnings.length > 0),
    [shownWeek],
  );
  const warningCount = warned.reduce(
    (sum, person) => sum + person.warnings.length,
    0,
  );
  const canPlan = shownWeek?.rules.enabled ?? false;
  const loading = !notReleased && !shownWeek && !loadError;

  const contextBar = (
    <PlanningContextBar
      dateLabel={planningWeekLabel(weekStart)}
      onPrevious={() => setWeekStart((current) => addDaysISO(current, -7))}
      onNext={() => setWeekStart((current) => addDaysISO(current, 7))}
      previousLabel="Vorherige Woche"
      nextLabel="Nächste Woche"
      previousTooltip="Zeigt die Woche davor."
      nextTooltip="Zeigt die Woche danach."
      onToday={
        weekStart === mondayOf(today)
          ? undefined
          : () => setWeekStart(mondayOf(today))
      }
      actions={
        <>
          <TraegerListExportMenu
            download={(format) =>
              downloadTraegerPlanningWeek(weekStart, format)
            }
            scope="Alle Personen dieser Woche"
            ariaLabel="Einsatzplanung herunterladen"
            tooltip="Zeigt die Formate für die gezeigte Woche. Jeder Download steht im Zugriffsprotokoll der Schulen."
            fallbackName={`einsatzplanung-${weekStart}`}
            errorObject="die Einsatzplanung"
            unavailable={!shownWeek || shownWeek.people.length === 0}
          />
          <ButtonLink
            href={RULES_HREF}
            variant="outline"
            size="md"
            className="gap-2"
            tooltip="Öffnet die Arbeitszeitregeln in den Einstellungen."
          >
            <GearSixIcon className="h-4 w-4" aria-hidden="true" />
            Regeln
          </ButtonLink>
        </>
      }
      contextRowWrap
    >
      {shownWeek ? (
        <p className="text-sm text-gray-600">
          {rulesSummary(shownWeek.rules).join(" · ")}
        </p>
      ) : null}
    </PlanningContextBar>
  );

  return (
    <TenantPage
      title="Einsatzplanung"
      info={INFO}
      stats={
        shownWeek && shownWeek.people.length > 0 ? (
          <TenantPageStats
            items={[
              {
                value: shownWeek.people.length,
                label: shownWeek.people.length === 1 ? "Person" : "Personen",
              },
              {
                value: shiftCount,
                label: shiftCount === 1 ? "Schicht" : "Schichten",
              },
              {
                value: warningCount,
                label: warningCount === 1 ? "Hinweis" : "Hinweise",
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      searchSlot={notReleased ? undefined : contextBar}
      error={loadError}
      loading={loading}
      overlays={
        <PlanShiftModal
          target={target}
          onClose={() => setTarget(null)}
          onSaved={(message) => {
            setTarget(null);
            success(message);
            // Eine Schicht ändert auch Nachbarwochen und die Schulen mit
            // künftigen Schichten.
            void invalidateFamily(traegerStaffKeys.planningFamily);
          }}
        />
      }
    >
      {notReleased ? (
        <SectionCard>
          <EmptyState
            icon={<LockKeyIcon className="h-12 w-12" aria-hidden="true" />}
            title="Personal beim Träger ist noch nicht freigeschaltet."
            description="Das moto-Team schaltet es frei. Bis dahin plant jede Schule ihren Dienstplan selbst."
          />
        </SectionCard>
      ) : null}

      {shownWeek && !shownWeek.rules.enabled ? (
        <Alert
          type="warning"
          message="Einsatzplanung in moto ist aus. Neue Schichten sind in allen Schulen gesperrt. Geplante Schichten bleiben."
          action={
            <ButtonLink
              href={RULES_HREF}
              variant="ghost_tone"
              size="compact"
              tooltip="Öffnet die Einstellungen der Einsatzplanung."
            >
              Einstellungen öffnen
            </ButtonLink>
          }
        />
      ) : null}

      {shownWeek && shownWeek.unreached.length > 0 ? (
        <Alert
          type="warning"
          message={`Diese Woche fehlt von: ${shownWeek.unreached.map((school) => school.name).join(", ")}. Bitte lade die Seite später neu.`}
        />
      ) : null}

      {shownWeek && shownWeek.people.length === 0 ? (
        <SectionCard>
          <EmptyState
            title="Noch niemand zu planen."
            description="Hier stehen Personen mit Personalakte, die an einer deiner Schulen arbeiten. Lege Personalakten unter „Personalakten“ an."
          />
        </SectionCard>
      ) : null}

      {shownWeek && shownWeek.people.length > 0 ? (
        <PlanningWeekGrid
          people={shownWeek.people}
          days={days}
          schools={shownWeek.schools}
          colors={colors}
          todayIso={today}
          canPlan={canPlan}
          maxDailyMinutes={shownWeek.rules.maxDailyMinutes}
          onPlan={(person, date) => setTarget({ kind: "create", person, date })}
          onPlanSuggestion={(person, suggestion) =>
            setTarget({
              kind: "create",
              person,
              date: suggestion.date,
              suggestion,
            })
          }
          onOpenShift={(person, shift) =>
            setTarget({ kind: "edit", person, shift })
          }
        />
      ) : null}

      {warned.length > 0 ? (
        <SectionCard
          title="Hinweise dieser Woche"
          description="moto zählt alle Schulen der Person zusammen. Die Prüfung ist eine Hilfe; ob die Planung erlaubt ist, entscheidest du."
          action={
            <span className="text-sm font-medium text-gray-600 tabular-nums">
              {warningCount} offen
            </span>
          }
        >
          <ul className="divide-y divide-gray-100">
            {warned.map((person) => (
              <li key={person.recordId} className="py-3 first:pt-0 last:pb-0">
                <span className="block text-sm font-medium text-gray-900">
                  {person.lastName}, {person.firstName}
                </span>
                <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
                  {person.warnings.map((warning) => (
                    <li key={`${warning.kind}-${warning.date}`}>
                      {describeWorkingTimeWarning(warning)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </TenantPage>
  );
}
