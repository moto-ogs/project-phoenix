"use client";

// Eine Woche der Vergabe nach Kriterien (#4700): freie Plätze, die offenen
// Anmeldungen in der Reihenfolge des Vorschlags und die Linie, an der die
// Plätze voll sind. moto schlägt nur vor; jede Zeile entscheidet das Büro mit
// „Platz geben“ oder „Auf die Warteliste“, die ganze Woche mit „Vorschlag
// übernehmen“.

import { BadgeCheck, CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { IconTile } from "~/components/ui/icon-tile";
import { ListGroupHeader } from "~/components/ui/list-group-header";
import NavigationLink from "~/components/ui/navigation-link";
import { ProgressBar } from "~/components/ui/progress-bar";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
  ResponsiveRowActions,
} from "~/components/ui/responsive-action-list";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { formatChatDateTime } from "~/lib/date-helpers";
import { holidayDayList } from "~/lib/holiday-days";
import type {
  HolidayAllocationCriterion,
  HolidayAllocationEntry,
  HolidayAllocationPlacement,
  HolidayAllocationWeek,
  HolidayCriteriaRanking,
} from "~/lib/traeger-holiday-allocation-api";
import { traegerPath } from "~/lib/traeger-url";
import {
  allocationChips,
  capacityBoundary,
  countLabel,
  criterionLabel,
  freePlacesText,
  scoreText,
} from "./holiday-allocation-model";
import { HOLIDAY_PENDING_TONE } from "./holiday-placement";
import { formatHolidayWeek } from "./holiday-registration-format";

/**
 * The criteria of one entry: met as a neutral chip, open as „ungeklärt“. By
 * priority the rank number ties the chip to the criterion, by points its
 * points stand behind the name; colour means status only (#7411). Where a
 * total decides the order (#8135), it stands above the chips.
 */
function AllocationCriteriaChips({
  entry,
  criteria,
  ranking,
  maxScore,
}: Readonly<{
  entry: HolidayAllocationEntry;
  criteria: readonly HolidayAllocationCriterion[];
  ranking: HolidayCriteriaRanking;
  maxScore: number;
}>) {
  const chips = allocationChips(entry, criteria);
  const score = scoreText(ranking, entry.score, maxScore);
  if (chips.length === 0) {
    return (
      <p className="text-xs text-gray-500">
        {score ?? "Kein Kriterium erfüllt"}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {score ? (
        <p className="text-sm font-medium text-gray-900">{score}</p>
      ) : null}
      <AllocationChipList chips={chips} ranking={ranking} />
    </div>
  );
}

function AllocationChipList({
  chips,
  ranking,
}: Readonly<{
  chips: ReturnType<typeof allocationChips>;
  ranking: HolidayCriteriaRanking;
}>) {
  return (
    <ul
      className="flex max-w-full min-w-0 flex-wrap gap-1.5"
      aria-label="Kriterien"
    >
      {chips.map((chip) => (
        <li key={chip.criterion.id} className="max-w-full min-w-0">
          {chip.value === "unknown" ? (
            <StatusBadge
              tone="outline"
              size="xs"
              wrap
              className="wrap-anywhere"
              icon={CircleHelp}
              label={`${criterionLabel(chip.criterion, ranking === "points" ? "equal" : ranking)}: ungeklärt`}
              title="Keine Angabe. Zählt erst, wenn das Büro es geprüft hat."
            />
          ) : (
            <StatusBadge
              tone="gray"
              size="xs"
              wrap
              className="wrap-anywhere"
              icon={chip.checkedByOffice ? BadgeCheck : undefined}
              label={criterionLabel(chip.criterion, ranking)}
              title={
                chip.checkedByOffice
                  ? "Vom Büro geprüft"
                  : "Angabe der Eltern, nicht geprüft"
              }
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function AllocationRow({
  periodId,
  entry,
  criteria,
  ranking,
  maxScore,
  busy,
  onDecide,
}: Readonly<{
  periodId: string;
  entry: HolidayAllocationEntry;
  criteria: readonly HolidayAllocationCriterion[];
  ranking: HolidayCriteriaRanking;
  maxScore: number;
  busy: boolean;
  onDecide: (placement: HolidayAllocationPlacement) => void;
}>) {
  const name = `${entry.childFirstName} ${entry.childLastName}`;
  const proposedPlace = entry.proposal === "placed";
  return (
    <ResponsiveActionRow className="gap-3">
      <div className="flex min-w-0 gap-3">
        <IconTile
          icon={
            <span className="text-sm font-semibold tabular-nums">
              {entry.rank}
            </span>
          }
          size="sm"
          shape="round"
          tone={proposedPlace ? "green" : "neutral"}
        />
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <NavigationLink
              href={traegerPath(
                `/traeger/ferien/${periodId}/anmeldungen/${entry.registrationId}`,
              )}
              className="text-sm font-semibold text-gray-900 hover:underline"
            >
              <span className="sr-only">Rang {entry.rank}: </span>
              {name}
            </NavigationLink>
            <StatusBadge
              tone={proposedPlace ? "green" : "warning"}
              size="xs"
              label={
                proposedPlace ? "Vorschlag: Platz" : "Vorschlag: Warteliste"
              }
            />
          </div>
          <p className="text-sm text-gray-600">
            {entry.timeModelName}
            {entry.days.length > 0 ? ` · ${holidayDayList(entry.days)}` : ""} ·
            Eingang {formatChatDateTime(entry.submittedAt)} Uhr
          </p>
          <AllocationCriteriaChips
            entry={entry}
            criteria={criteria}
            ranking={ranking}
            maxScore={maxScore}
          />
        </div>
      </div>
      <ResponsiveRowActions leading={36}>
        <Button
          type="button"
          variant="surface"
          size="compact"
          disabled={busy}
          aria-label={`${name}: Platz geben`}
          tooltip="Gibt dem Kind den Platz, die Eltern bekommen eine E-Mail. moto fragt vorher nach."
          onClick={() => onDecide("placed")}
        >
          Platz geben
        </Button>
        <Button
          type="button"
          variant="surface"
          size="compact"
          disabled={busy}
          aria-label={`${name}: auf die Warteliste`}
          tooltip="Setzt das Kind auf die Warteliste, die Eltern bekommen eine E-Mail. moto fragt vorher nach."
          onClick={() => onDecide("waitlisted")}
        >
          Auf die Warteliste
        </Button>
      </ResponsiveRowActions>
    </ResponsiveActionRow>
  );
}

/**
 * Where the free places end: the head of the rows moto proposes for the
 * waiting list, as a group head of the list (#7411).
 */
function CapacityLine({ free }: Readonly<{ free: number | null }>) {
  return (
    <li className="py-2 sm:col-span-2">
      <ListGroupHeader
        as="h3"
        title={
          free === null || free <= 0
            ? "Ab hier schlägt moto die Warteliste vor"
            : `${countLabel(free, "freier Platz", "freie Plätze")} oben · ab hier schlägt moto die Warteliste vor`
        }
      />
    </li>
  );
}

export function HolidayAllocationWeekCard({
  periodId,
  week,
  hostSchoolName,
  criteria,
  ranking,
  maxScore,
  busy,
  onDecide,
  onTakeProposal,
}: Readonly<{
  periodId: string;
  week: HolidayAllocationWeek;
  hostSchoolName: string;
  criteria: readonly HolidayAllocationCriterion[];
  ranking: HolidayCriteriaRanking;
  maxScore: number;
  busy: boolean;
  onDecide: (
    entry: HolidayAllocationEntry,
    placement: HolidayAllocationPlacement,
  ) => void;
  onTakeProposal: () => void;
}>) {
  const title = formatHolidayWeek(week.startsOn, week.endsOn);
  const boundary = capacityBoundary(week.pending);
  const full = week.free !== null && week.free <= 0;
  // Places given in the week, at its fullest day for a week by days.
  const taken =
    week.capacity === null
      ? week.placed
      : Math.max(0, week.capacity - (week.free ?? 0));
  return (
    <SectionCard
      title={title}
      titleBadge={
        <StatusBadge
          tone={HOLIDAY_PENDING_TONE}
          size="xs"
          label={`${week.pending.length} offen`}
        />
      }
      description={hostSchoolName}
      action={
        <Button
          type="button"
          variant="outline"
          size="md"
          disabled={busy}
          aria-label={`Vorschlag für die Woche ${title} übernehmen`}
          tooltip="Entscheidet die Woche wie vorgeschlagen, Eltern bekommen E-Mails. moto fragt vorher nach."
          onClick={onTakeProposal}
        >
          Vorschlag übernehmen
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm text-gray-700">
            <span>
              {week.capacity === null ? (
                <>
                  <span className="font-semibold text-gray-900">
                    {week.placed}
                  </span>{" "}
                  {week.placed === 1 ? "Platz" : "Plätze"} vergeben
                </>
              ) : (
                <>
                  <span className="font-semibold text-gray-900">{taken}</span>{" "}
                  von {week.capacity} Plätzen vergeben
                  {week.bookingUnit === "day" ? " am vollsten Tag" : ""}
                </>
              )}
            </span>
            <span className={full ? "font-medium text-gray-900" : ""}>
              {freePlacesText(week)}
            </span>
          </p>
          {week.capacity === null ? null : (
            <ProgressBar
              value={Math.min(taken, week.capacity)}
              max={Math.max(week.capacity, 1)}
              label={`${taken} von ${week.capacity} Plätzen vergeben`}
              tone={full ? "orange" : "green"}
              size="md"
            />
          )}
        </div>
        {full ? (
          <p className="text-sm text-gray-600">
            {week.bookingUnit === "day"
              ? "An mindestens einem Tag ist kein Platz frei. Andere Tage können noch Plätze haben."
              : "Es ist kein Platz frei. Für mehr Kinder erhöhe zuerst im Reiter „Plätze“ die Zahl der Plätze."}
          </p>
        ) : null}
        <ResponsiveActionList>
          {week.pending.map((entry, index) => (
            <AllocationRowWithLine
              key={entry.bookingId}
              line={index === boundary}
              free={week.free === null ? null : week.free}
            >
              <AllocationRow
                periodId={periodId}
                entry={entry}
                criteria={criteria}
                ranking={ranking}
                maxScore={maxScore}
                busy={busy}
                onDecide={(placement) => onDecide(entry, placement)}
              />
            </AllocationRowWithLine>
          ))}
        </ResponsiveActionList>
      </div>
    </SectionCard>
  );
}

function AllocationRowWithLine({
  line,
  free,
  children,
}: Readonly<{
  line: boolean;
  free: number | null;
  children: ReactNode;
}>) {
  return (
    <>
      {line ? <CapacityLine free={free} /> : null}
      {children}
    </>
  );
}
