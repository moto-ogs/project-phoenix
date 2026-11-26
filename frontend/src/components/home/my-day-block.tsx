"use client";

import { ChevronRight } from "lucide-react";

import { Button } from "~/components/ui/button";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { ListRow } from "~/components/ui/list-row";
import Link from "~/components/ui/navigation-link";
import { SkeletonRows } from "~/components/ui/skeleton";
import { StatusBadge } from "~/components/ui/status-badge";
import { BlockState } from "~/components/home/day-flow-block";
import {
  HomeCard,
  HomeCardEmpty,
  HomeCardIcon,
} from "~/components/home/home-card";
import {
  dayPlanLinkTooltip,
  HomeCardLink,
  HomeMoreRow,
  upcomingFirst,
  useBerlinClock,
  useHomeCardRows,
} from "~/components/home/home-card-rows";
import {
  BlockRowBody,
  blockRowState,
  blockSpokenTime,
  NowLine,
} from "~/components/home/home-block-row";
import { useDayPlanHref, useDayPlanLabel } from "~/lib/hooks/use-day-plan-href";
import {
  START_OWN_BLOCK_TOOLTIP,
  useStartOwnBlock,
} from "~/components/home/use-start-own-block";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { homeKeys } from "~/lib/swr/portal-keys";
import { useTenantAwarePath } from "~/lib/tenant-path";
import { timetableOperationsApi } from "~/lib/timetable-operations-api";
import { canStartPlannedInstance } from "~/lib/timetable-lifecycle";
import type { PlannedTimetableInstance } from "~/lib/timetable-operations-types";
import { carePlanConcept } from "~/lib/concepts/carePlan";

/**
 * So viele Blöcke passen in eine Karte von drei Rasterzeilen ganz hinein
 * (gemessen: Körper 272 px, Zeile 44 px, Jetzt-Linie 20 px).
 */
const MAX_ROWS = 5;

/**
 * Baustein „Mein Tag" (#2180): der Betreuungstag der Person, so wie ihn der
 * Tagesplan zeigt — nur auf die Blöcke gekürzt, für die sie eingeteilt ist.
 *
 * Das ist die Karte, von der aus eine Betreuungskraft arbeitet: der GANZE
 * Tag mit Zeit, Raum, Kinderzahl und Kolleginnen, Vergangenes gedimmt, die
 * Jetzt-Linie vor dem Block, der als Nächstes zählt, und der Starten-Knopf
 * am eigenen Block, sobald er starten darf. Ein laufender Block führt in
 * seine Kinderliste. Nichts davon muss man im Tagesplan suchen; der bleibt
 * der Weg zu den anderen Tagen und zu den Blöcken der anderen.
 *
 * Dieselbe Abfrage wie „Betreuungsplan heute" (gleicher Schlüssel): stehen beide
 * Karten auf dem Brett, fragt die Seite den Server nur einmal.
 */
export function MyDayBlock() {
  const dayPlanHref = useDayPlanHref();
  const dayPlanLabel = useDayPlanLabel();
  const dayPlanTooltip = dayPlanLinkTooltip(dayPlanHref);
  const tenantPath = useTenantAwarePath();
  const now = useBerlinClock();
  const { data, error, isLoading, mutate } = useSWRAuth<
    PlannedTimetableInstance[]
  >(
    homeKeys.dayFlow(),
    () =>
      timetableOperationsApi.plannedNow({
        scope: "day",
        includeRoster: false,
      }),
    { refreshInterval: 5 * 60 * 1000 },
  );

  // Derselbe Weg wie „Aufsicht starten" in der Jetzt-Zone.
  const { start, busyId: startBusyId } = useStartOwnBlock({
    onFailure: () => mutate(),
  });
  const loadError = useSwrLoadError(error, "die Karte „Mein Tag“", () =>
    mutate(),
  );

  const mine = [...(data ?? [])]
    .filter((block) => block.isAssigned)
    .sort(
      (a, b) =>
        a.startTime.localeCompare(b.startTime) ||
        a.endTime.localeCompare(b.endTime),
    );
  // Zuerst zählt, was jetzt läuft oder noch kommt. Würde die Karte den
  // Tagesanfang kürzen, fehlten nachmittags gerade der laufende und der
  // nächste Einsatz. Ein laut Server laufender Block bleibt dabei relevant,
  // auch wenn seine geplante Endzeit schon vorbei ist.
  const { items: relevant, allPast } = upcomingFirst(
    mine,
    (block) => (block.status === "active" ? "24:00" : block.endTime),
    now,
  );
  const { shown, hidden } = useHomeCardRows(relevant, MAX_ROWS, {
    preferLatest: allPast,
  });
  // Die Jetzt-Linie steht vor dem ersten Block, dessen Endzeit noch nicht
  // vorbei ist — nach der Uhr, wie im Tagesplan. Ein Block, der laut Server
  // noch läuft, obwohl seine Zeit um ist, bleibt oben mit seiner Marke
  // „Läuft"; die Linie folgt der Zeit, nicht dem Zustand. Ohne Uhr (erstes
  // Rendern) gibt es keine Linie.
  const nowIndex =
    now === ""
      ? -1
      : (() => {
          const index = shown.findIndex((block) => block.endTime > now);
          return index === -1 ? shown.length : index;
        })();

  return (
    <HomeCard
      title="Mein Tag"
      leading={<HomeCardIcon concept={carePlanConcept} />}
      inlineActions
      actions={
        <HomeCardLink
          href={dayPlanHref}
          label={`Mein Tag: ${dayPlanLabel}`}
          tooltip={dayPlanTooltip}
        >
          {dayPlanLabel}
        </HomeCardLink>
      }
    >
      {(() => {
        if (loadError) return <LoadErrorAlert error={loadError} />;
        // Bis der Katalogtext des Ladefehlers da ist, bleibt das Skelett.
        if ((isLoading && data === undefined) || error) {
          return <SkeletonRows rows={4} labelClassName="w-20" />;
        }
        if (mine.length === 0) {
          return (
            <HomeCardEmpty
              title="Heute bist du für keinen Block eingeteilt"
              description="Deine Einsätze aus dem Betreuungsplan erscheinen hier, mit Raum, Kindern und dem Starten-Knopf."
            />
          );
        }
        return (
          <>
            <ul className="space-y-1.5">
              {shown.map((block, index) => (
                <BlockRow
                  key={block.id}
                  block={block}
                  now={now}
                  withNowLine={index === nowIndex}
                  dayPlanHref={dayPlanHref}
                  tenantPath={tenantPath}
                  busy={startBusyId === block.id}
                  onStart={start}
                />
              ))}
              {/* Der Tag ist vorbei: die Linie steht unter dem letzten Block,
                  damit „heute war das" eine Antwort bleibt. */}
              {nowIndex === shown.length && hidden === 0 && (
                <li>
                  <NowLine now={now} />
                </li>
              )}
            </ul>
            <HomeMoreRow
              hidden={hidden}
              href={dayPlanHref}
              label="Einsätze"
              singular="Einsatz"
            />
          </>
        );
      })()}
    </HomeCard>
  );
}

/**
 * Ein Block des eigenen Tages. Zeit, Name, Raum, Kinderzahl und Kolleginnen
 * in einer Zeile mit Untertitel; rechts, was der Block gerade ist — oder
 * der Knopf, ihn zu starten.
 */
function BlockRow({
  block,
  now,
  withNowLine,
  dayPlanHref,
  tenantPath,
  busy,
  onStart,
}: {
  readonly block: PlannedTimetableInstance;
  readonly now: string;
  readonly withNowLine: boolean;
  readonly dayPlanHref: string;
  readonly tenantPath: (path: string) => string;
  readonly busy: boolean;
  readonly onStart: (block: PlannedTimetableInstance) => void;
}) {
  const { running, over } = blockRowState(block, now);
  const startable =
    block.status === "planned" && canStartPlannedInstance(block, new Date());
  // Ein laufender Block führt in seine Kinderliste; jeder andere in den
  // Tagesplan, wo er bedient wird.
  const href =
    running && block.activeGroupId
      ? tenantPath(`/active-supervisions?session=${block.activeGroupId}`)
      : dayPlanHref;

  return (
    <li>
      {withNowLine && (
        <div className="mb-1.5">
          <NowLine now={now} />
        </div>
      )}
      <ListRow
        density="compact"
        trailing={
          <>
            {startable ? (
              <Button
                type="button"
                size="md"
                variant="success"
                disabled={busy}
                onClick={() => onStart(block)}
                tooltip={START_OWN_BLOCK_TOOLTIP}
              >
                {busy ? "Startet..." : "Starten"}
              </Button>
            ) : block.isAbsent ? (
              <StatusBadge tone="gray" label="Du fehlst" />
            ) : over ? null : (
              <BlockState block={block} now={now} />
            )}
            {running && block.activeGroupId && (
              <ChevronRight
                className="h-4 w-4 text-gray-500"
                aria-hidden="true"
              />
            )}
          </>
        }
      >
        <Link
          href={href}
          aria-label={`${block.title} ${blockSpokenTime(block)}: ${running ? "Kinderliste öffnen" : "unter Heute öffnen"}`}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <BlockRowBody
            block={block}
            now={now}
            titleAddon={
              block.isSubstitute ? (
                <span className="ml-2 text-xs font-normal text-gray-500">
                  Vertretung
                </span>
              ) : null
            }
          />
        </Link>
      </ListRow>
    </li>
  );
}
