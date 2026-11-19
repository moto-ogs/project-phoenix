"use client";

// Das Wochenraster der Einsatzplanung (#4708): Personen untereinander, die
// Tage nebeneinander, in jeder Zelle die Schichten aller Einsatzorte in der
// Farbe ihrer Schule. Ein Tag mit einem Hinweis trägt das Warnsymbol. Unter
// lg zeigt die Fläche einen Tag mit allen Personen, wie der Dienstplan der
// Schule (`ResourceDayList`, wie der Vertretungspool). Das Raster lädt
// nichts; alles kommt als Props von der Seite.

import { WarningIcon } from "@phosphor-icons/react";
import { useMemo, type ReactNode } from "react";

import { CoverageIndicator } from "~/components/ui/planning/coverage-indicator";
import { PlanAddButton } from "~/components/ui/planning/plan-add-affordance";
import { PlanBlock } from "~/components/ui/planning/plan-block";
import {
  PlanLegend,
  type PlanLegendEntry,
} from "~/components/ui/planning/plan-legend";
import { ResourceDayList } from "~/components/ui/planning/resource-day-list";
import {
  ResourceGrid,
  type ResourceGridColumn,
} from "~/components/ui/planning/resource-grid";
import { StatusBadge } from "~/components/ui/status-badge";
import { Tooltip } from "~/components/ui/tooltip";
import { BELOW_LG, useMediaQuery } from "~/lib/hooks/use-media-query";
import { LOCATION_COLORS } from "~/lib/location-helper";
import type {
  TraegerPlanningPerson,
  TraegerPlanningSchool,
  TraegerPlanningShift,
} from "~/lib/traeger-planning-api";
import { formatPlannedHours } from "~/lib/shift-helpers";
import { describeWorkingTimeWarning } from "~/lib/working-time";

import {
  plannedOfSoll,
  sollTone,
  suggestionSentence,
  warningsOfDay,
  type ContractSuggestion,
  weekSuggestions,
  type PlanningDay,
} from "./planning-format";

interface PlanningWeekGridProps {
  readonly people: readonly TraegerPlanningPerson[];
  readonly days: readonly PlanningDay[];
  readonly schools: readonly TraegerPlanningSchool[];
  readonly colors: ReadonlyMap<string, string>;
  readonly todayIso: string;
  /** `false`: der Träger plant außerhalb von moto, keine neuen Schichten. */
  readonly canPlan: boolean;
  /** Höchstzeit am Tag aus den Regeln; 0 ohne Grenze. */
  readonly maxDailyMinutes: number;
  readonly onPlan: (person: TraegerPlanningPerson, date: string) => void;
  /** Übernimmt einen Vorschlag aus dem Arbeitsvertrag in den Dialog (#7381). */
  readonly onPlanSuggestion: (
    person: TraegerPlanningPerson,
    suggestion: ContractSuggestion,
  ) => void;
  readonly onOpenShift: (
    person: TraegerPlanningPerson,
    shift: TraegerPlanningShift,
  ) => void;
}

const fullName = (person: TraegerPlanningPerson) =>
  `${person.lastName}, ${person.firstName}`;

function RowHeader({ person }: { readonly person: TraegerPlanningPerson }) {
  const count = person.warnings.length;
  const sollTooltip =
    person.sollMinutes === null
      ? "Kein Arbeitsvertrag mit Soll für diese Woche."
      : "Geplante Stunden dieser Woche an allen Schulen, und das Soll aus dem Arbeitsvertrag.";
  return (
    <div className="min-w-0">
      <span className="block truncate text-sm font-medium text-gray-900">
        {fullName(person)}
      </span>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <Tooltip className="block w-fit" content={sollTooltip}>
          <CoverageIndicator
            state="covered"
            size="sm"
            label={plannedOfSoll(person)}
            tone={sollTone(person)}
            title={sollTooltip}
          />
        </Tooltip>
        {count > 0 ? (
          <Tooltip
            className="block w-fit"
            content={person.warnings.map(describeWorkingTimeWarning).join(" ")}
          >
            <StatusBadge
              size="xs"
              tone="warning"
              label={count === 1 ? "1 Hinweis" : `${count} Hinweise`}
            />
          </Tooltip>
        ) : null}
      </div>
      <span className="mt-0.5 block truncate text-xs text-gray-500">
        {person.sites.map((site) => site.schoolName).join(" · ")}
      </span>
    </div>
  );
}

export function PlanningWeekGrid({
  people,
  days,
  schools,
  colors,
  todayIso,
  canPlan,
  maxDailyMinutes,
  onPlan,
  onPlanSuggestion,
  onOpenShift,
}: PlanningWeekGridProps) {
  const isCompact = useMediaQuery(BELOW_LG);

  const columns: ResourceGridColumn[] = useMemo(
    () =>
      days.map((day) => ({
        key: day.date,
        label: day.weekday,
        sublabel: day.label,
        isCurrent: day.date === todayIso,
      })),
    [days, todayIso],
  );

  const shiftsByPersonDay = useMemo(() => {
    const result = new Map<string, TraegerPlanningShift[]>();
    for (const person of people) {
      for (const shift of person.shifts) {
        const key = `${person.recordId}|${shift.date}`;
        const list = result.get(key) ?? [];
        list.push(shift);
        result.set(key, list);
      }
    }
    return result;
  }, [people]);

  // Die Vorschläge rechnen die Woche einer Person einmal von vorn durch,
  // damit sie zusammen nie über das Soll der Woche führen.
  const suggestionsByPerson = useMemo(
    () =>
      new Map(
        canPlan
          ? people.map((person) => [
              person.recordId,
              weekSuggestions(person, todayIso, maxDailyMinutes),
            ])
          : [],
      ),
    [canPlan, maxDailyMinutes, people, todayIso],
  );

  const usedSchools = useMemo(() => {
    const used = new Set(
      people.flatMap((person) => person.sites.map((site) => site.schoolId)),
    );
    return schools.filter((school) => used.has(school.id));
  }, [people, schools]);

  const legendEntries: PlanLegendEntry[] = useMemo(
    () => [
      ...usedSchools.map((school) => ({
        key: school.id,
        label: school.name,
        color: colors.get(school.id),
      })),
      ...(canPlan
        ? [
            {
              key: "suggested",
              label: "Vorschlag aus dem Arbeitsvertrag",
              variant: "suggested" as const,
            },
          ]
        : []),
      {
        key: "warning",
        label: "Hinweis zu Arbeitszeit",
        color: LOCATION_COLORS.WARNING,
        variant: "dot" as const,
      },
    ],
    [canPlan, colors, usedSchools],
  );

  const planLabel = (
    person: TraegerPlanningPerson,
    column: { label: string; sublabel?: string },
  ) =>
    `Schicht planen, ${person.firstName} ${person.lastName}, ${column.label} ${column.sublabel ?? ""}`.trim();

  const renderShift = (
    person: TraegerPlanningPerson,
    shift: TraegerPlanningShift,
    warned: boolean,
  ) => {
    // Title: what the shift is; second line: where. The colour edge names
    // the school at a glance, the line spells it out.
    const label = shift.cancelled
      ? "Abgesagt"
      : (shift.shiftTypeName ??
        (shift.plannedByTraeger ? "Vom Träger" : "Schicht"));
    const detail =
      shift.plannedByTraeger && shift.shiftTypeName && !shift.cancelled
        ? `${shift.schoolName} · vom Träger`
        : shift.schoolName;
    const timeRange = `${shift.startTime}–${shift.endTime}`;
    return (
      <PlanBlock
        key={shift.id}
        size="compact"
        timeRange={timeRange}
        label={label}
        color={colors.get(shift.schoolId)}
        status={shift.cancelled ? "cancelled" : "default"}
        compactDetail={
          <span className="block truncate text-xs text-gray-600">{detail}</span>
        }
        statusIcon={
          warned && !shift.cancelled ? (
            <WarningIcon
              weight="fill"
              aria-label="Hinweis zu Arbeitszeit an diesem Tag"
              style={{ color: LOCATION_COLORS.WARNING }}
            />
          ) : undefined
        }
        title={[
          `${timeRange}, ${shift.schoolName}`,
          shift.breakMinutes > 0 ? `Pause ${shift.breakMinutes} Min.` : "",
          shift.notes,
        ]
          .filter(Boolean)
          .join(" · ")}
        interactive={!shift.cancelled}
        onClick={() => onOpenShift(person, shift)}
        details={[
          shift.plannedByTraeger ? "vom Träger geplant" : "",
          warned && !shift.cancelled
            ? "Hinweis zu Arbeitszeit an diesem Tag"
            : "",
          shift.cancelled ? "" : "Schicht ändern",
        ]
          .filter(Boolean)
          .join(", ")}
      />
    );
  };

  // Ein Vorschlag aus dem Arbeitsvertrag: gestrichelt, ohne Farbfläche,
  // damit er nie wie eine geplante Schicht aussieht. Ein Klick öffnet den
  // Dialog mit Einsatzort und Zeiten; geplant ist erst nach „Planen“.
  const renderSuggestion = (
    person: TraegerPlanningPerson,
    suggestion: ContractSuggestion,
  ) => (
    <PlanBlock
      key={`suggestion-${suggestion.schoolId}`}
      size="compact"
      status="suggested"
      timeRange={formatPlannedHours(suggestion.minutes)}
      label="Vorschlag"
      color={colors.get(suggestion.schoolId)}
      compactDetail={
        <span className="block truncate text-xs text-gray-600">
          {suggestion.schoolName}
        </span>
      }
      title={`${suggestionSentence(suggestion, { askToCheck: false })} Öffnet „Schicht planen“ mit ${suggestion.startTime}–${suggestion.endTime}.`}
      onClick={() => onPlanSuggestion(person, suggestion)}
      details={`${suggestion.schoolName}, aus dem Arbeitsvertrag, noch nicht geplant, Schicht planen`}
    />
  );

  const renderCell = (
    person: TraegerPlanningPerson,
    column: ResourceGridColumn,
  ): ReactNode => {
    const shifts =
      shiftsByPersonDay.get(`${person.recordId}|${column.key}`) ?? [];
    const suggestions =
      suggestionsByPerson.get(person.recordId)?.get(column.key) ?? [];
    if (shifts.length === 0 && suggestions.length === 0) return null;
    const warned = warningsOfDay(person.warnings, column.key).length > 0;
    return (
      <div className="flex flex-col gap-1">
        {shifts.map((shift) => renderShift(person, shift, warned))}
        {suggestions.map((suggestion) => renderSuggestion(person, suggestion))}
        {canPlan ? (
          <PlanAddButton
            label={planLabel(person, column)}
            onClick={() => onPlan(person, column.key)}
          />
        ) : null}
      </div>
    );
  };

  const legend = (
    <PlanLegend
      entries={legendEntries}
      aria-label="Legende Einsatzorte und Hinweise"
    />
  );

  if (isCompact && columns.length > 0) {
    return (
      <ResourceDayList
        columns={columns}
        rows={people}
        getRowKey={(person) => person.recordId}
        renderRowHeader={(person) => <RowHeader person={person} />}
        renderCell={(person, column) =>
          renderCell(person, column) ??
          (canPlan ? (
            <PlanAddButton
              label={planLabel(person, column)}
              onClick={() => onPlan(person, column.key)}
            />
          ) : null)
        }
        legend={legend}
      />
    );
  }

  return (
    <ResourceGrid
      columns={columns}
      rows={people}
      getRowKey={(person) => person.recordId}
      renderRowHeader={(person) => <RowHeader person={person} />}
      renderCell={renderCell}
      columnMode="days"
      cornerHeader="Person"
      emptyCellLabel={canPlan ? planLabel : undefined}
      onEmptyCellClick={
        canPlan ? (person, column) => onPlan(person, column.key) : undefined
      }
      ariaLabel="Einsatzplanung, Woche aller Personen"
      legend={legend}
    />
  );
}
