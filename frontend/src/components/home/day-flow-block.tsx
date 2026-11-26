"use client";

import { Fragment } from "react";
import { Check, TriangleAlert } from "lucide-react";

import { EmptyState } from "~/components/ui/empty-state";
import { ListRow } from "~/components/ui/list-row";
import Link from "~/components/ui/navigation-link";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SkeletonRows } from "~/components/ui/skeleton";
import {
  HomeCard,
  HomeCardEmpty,
  HomeCardIcon,
} from "~/components/home/home-card";
import { blockTintStyle } from "~/components/timetable/block-row-parts";
import { minutesBetween } from "~/lib/home-clock";
import type { PlannedTimetableInstance } from "~/lib/timetable-operations-types";
import { useCarePlanTodayTarget } from "~/lib/hooks/use-day-plan-href";
import { useHomeBlockAccess } from "~/lib/hooks/use-home-block-access";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useTodayBlocks } from "~/lib/hooks/use-today-blocks";
import {
  BlockRowBody,
  blockRowState,
  BlockState,
  NowLine,
  openUntil,
} from "~/components/home/home-block-row";
import {
  HOME_TWO_COLUMNS,
  HomeCardLink,
  HomeMoreRow,
  upcomingFirst,
  useBerlinClock,
  useHomeCardRows,
} from "~/components/home/home-card-rows";
import { carePlanConcept } from "~/lib/concepts/carePlan";

/**
 * So viele Blöcke passen in eine Spalte der Karte ganz hinein: drei
 * Rasterzeilen wie „Mein Tag“ (Körper 286 px, Zeile 52 px, Jetzt-Linie 20 px).
 */
const COLUMN_ROWS = 5;

/** Ab dieser Kartenbreite stehen die Blöcke in zwei Spalten (`@3xl`, 48rem). */
const WIDE_ROWS = COLUMN_ROWS * 2;

/** Bis zu so vielen Minuten vor dem Beginn zählt die Karte herunter. */
const SOON_MINUTES = 60;

/**
 * Baustein „Betreuungsplan heute" (#8134, vorher „Ablauf des Tages", #2180):
 * der Betreuungsplan der ganzen Schule für den laufenden Tag, unter seinem
 * Namen und mit denselben Zeilen wie „Mein Tag". Die Karte beginnt bei dem,
 * was läuft oder als Nächstes kommt; jede Zeile führt in ihren Termin, der
 * Weiterlink auf den Tag im Plan.
 *
 * Über die volle Breite stehen mehr als fünf Blöcke in zwei Spalten, die man
 * wie eine Zeitung liest: erst die linke nach unten, dann die rechte. So
 * passt ein Betreuungstag mit zehn Blöcken ganz auf die Karte. Die Breite entscheidet
 * die Karte selbst (Container-Abfrage), nicht der Bildschirm: halb so breit
 * gelegt oder auf dem Handy bleibt es eine Spalte. Beide Mengen stehen im
 * Dokument und CSS wählt, damit die Karte ohne Messen und ohne Sprung nach
 * dem ersten Rendern auskommt.
 *
 * Die Karte ist so hoch wie ihr Inhalt (`data-home-card-fit`): nachmittags
 * stehen noch drei Blöcke da, und drei Rasterzeilen wären dann halb leer.
 * Ist der Tag vorbei, steht ein Satz da statt der letzten Blöcke.
 *
 * Welche Blöcke die Karte liest, sagt `useTodayBlocks`.
 */
export function DayFlowBlock() {
  const { opensPlan, label, tooltip, dayHref, blockHref } =
    useCarePlanTodayTarget();
  const { data, error, isLoading, mutate } = useTodayBlocks();
  const loadError = useSwrLoadError(
    error,
    "die Karte „Betreuungsplan heute“",
    () => mutate(),
  );

  const now = useBerlinClock();
  // Eigene Blöcke sind in ihrer Farbe hinterlegt wie im Tagesplan (#4350),
  // aber nur, wo eigene und fremde nebeneinander stehen.
  const showMine = useHomeBlockAccess().seesAllBlocks;
  const blocks = data ?? [];
  // Ab dem Block, der gerade läuft: sonst stünde um 16 Uhr immer noch die
  // Frühbetreuung oben in der Karte.
  const { items: open, allPast } = upcomingFirst(blocks, openUntil, now);
  // Eine Spalte und zwei Spalten kappen verschieden. Die schmale Auswahl ist
  // immer Teil der breiten: dieselbe Liste, vom selben Ende her gekürzt.
  const narrow = useHomeCardRows(open, COLUMN_ROWS).shown;
  const wide = useHomeCardRows(open, WIDE_ROWS).shown;
  const inNarrow = new Set(narrow.map((block) => block.id));
  const inWide = new Set(wide.map((block) => block.id));
  // Was ausfällt und was der Person selbst gehört, steht immer als Zeile da,
  // auch hinter der Kappung: auf genau diese Blöcke muss sie handeln.
  const pinned = (block: PlannedTimetableInstance) =>
    block.status === "cancelled" || (showMine && block.isAssigned);
  const rows = open.filter((block) => inWide.has(block.id) || pinned(block));
  const hiddenBeyond = (shown: ReadonlySet<string>) =>
    open.filter((block) => !shown.has(block.id) && !pinned(block)).length;
  const narrowHidden = hiddenBeyond(inNarrow);
  const wideHidden = hiddenBeyond(inWide);
  // Zwei Spalten nur, wenn eine nicht reicht: zwei oder drei Blöcke
  // nebeneinander läse man quer statt erst nach unten.
  const columns = open.length > COLUMN_ROWS ? HOME_TWO_COLUMNS : "";
  const today = blocks[0]?.date;
  // Was vor jetzt lag, steht nicht mehr als Zeile da. Die Karte nennt die
  // Zahl, damit drei Zeilen am Nachmittag nicht wie der ganze Tag aussehen.
  const earlier = blocks.length - open.length;

  return (
    <HomeCard
      title="Betreuungsplan heute"
      leading={<HomeCardIcon concept={carePlanConcept} />}
      inlineActions
      actions={
        <HomeCardLink
          href={dayHref(today)}
          label={`Betreuungsplan heute: ${label}`}
          tooltip={tooltip}
        >
          {label}
        </HomeCardLink>
      }
    >
      {/* So hoch wie der Inhalt: nachmittags stehen noch drei Blöcke da,
          abends ein Satz, und drei Rasterzeilen wären dann fast leer. */}
      <div className="@container" data-home-card-fit="">
        {(() => {
          // Bis der Katalogtext da ist, bleibt das Skelett stehen: ein
          // Ladefehler ist nie „Heute ist nichts geplant“.
          if (loadError) return <LoadErrorAlert error={loadError} />;
          if ((isLoading && data === undefined) || error) {
            return <SkeletonRows rows={4} labelClassName="w-20" />;
          }
          if (blocks.length === 0) {
            return (
              <HomeCardEmpty
                title="Heute ist nichts geplant"
                description="Sobald für heute Termine im Betreuungsplan stehen, siehst du sie hier."
              />
            );
          }
          // Der Tag ist vorbei: ein Satz statt zehn grauer Zeilen, die sich
          // wie offene Arbeit lesen. Der Weg in den Tag steht im Kopf.
          if (allPast) {
            return (
              // Klein und links, nicht die große Leerfläche: die Karte steht
              // oben auf der Seite und soll abends „Heute anders“ nicht aus
              // dem Bild schieben.
              <EmptyState
                variant="compact"
                tone="neutral"
                // Der Haken nur, wenn alles nach Plan lief: neben „1 Block
                // ist ausgefallen“ läse er sich als „alles gut“.
                icon={
                  dayWentToPlan(blocks, now) ? (
                    <Check aria-hidden />
                  ) : (
                    <TriangleAlert aria-hidden />
                  )
                }
                title="Für heute ist nichts mehr geplant"
                description={dayOverText(blocks, now)}
              />
            );
          }
          return (
            <>
              {/* Die Jetzt-Linie steht über beiden Spalten: in der Liste
                  stünde sie nur über der linken und verschöbe deren Zeilen
                  gegen die rechte. Ohne Uhr (erstes Rendern) gibt es keine. */}
              {now !== "" ? (
                <div className="mb-1.5">
                  <NowLine
                    now={now}
                    before={
                      earlier > 0 ? (
                        <EarlierLink count={earlier} href={dayHref(today)} />
                      ) : null
                    }
                  />
                </div>
              ) : null}
              {/* -mb-1 nimmt den Abstand unter der letzten Zeile zurück. Die
                  feine Linie zwischen den Spalten sagt: erst links nach unten
                  lesen, dann rechts. */}
              <ul className={`-mb-1 ${columns}`}>
                {rows.map((block) => (
                  <Fragment key={block.id}>
                    <PlanRow
                      block={block}
                      now={now}
                      mine={showMine && block.isAssigned}
                      href={blockHref(block)}
                      opensPlan={opensPlan}
                      wideOnly={!inNarrow.has(block.id) && !pinned(block)}
                    />
                    {/* Der Rest steht dort, wo Blöcke fehlen: nach der
                        letzten Zeile der Reihe, vor dem, was danach noch
                        festgehalten ist. Je Breite ein eigener Rest, eine
                        Spalte kappt früher. */}
                    {block.id === narrow.at(-1)?.id && narrowHidden > 0 ? (
                      <li
                        className="mb-1 break-inside-avoid @3xl:hidden"
                        data-plan-more="narrow"
                      >
                        <HomeMoreRow
                          hidden={narrowHidden}
                          href={dayHref(today)}
                          label="Blöcke"
                          singular="Block"
                        />
                      </li>
                    ) : null}
                    {block.id === wide.at(-1)?.id && wideHidden > 0 ? (
                      <li
                        className="mb-1 hidden break-inside-avoid @3xl:block"
                        data-plan-more="wide"
                      >
                        <HomeMoreRow
                          hidden={wideHidden}
                          href={dayHref(today)}
                          label="Blöcke"
                          singular="Block"
                        />
                      </li>
                    ) : null}
                  </Fragment>
                ))}
              </ul>
            </>
          );
        })()}
      </div>
    </HomeCard>
  );
}

/**
 * Was abends von den Blöcken des Tages zu sagen bleibt: dass sie vorbei sind,
 * und was dabei nicht nach Plan lief. Ohne die Zeilen stünde ein Ausfall
 * sonst nirgends mehr auf der Karte.
 */
function dayOverText(
  blocks: readonly PlannedTimetableInstance[],
  now: string,
): string {
  const cancelled = blocks.filter((block) => block.status === "cancelled");
  const missed = blocks.filter((block) => blockRowState(block, now).missed);
  if (cancelled.length === 0 && missed.length === 0) {
    return blocks.length === 1
      ? "Der eine Block von heute ist vorbei."
      : `Alle ${blocks.length} Blöcke von heute sind vorbei.`;
  }
  // Ein oder zwei Ausfälle beim Namen und mit Grund: wer abends nach der
  // Abholung gefragt wird, muss dafür nicht in den Plan wechseln.
  const cancelledText =
    cancelled.length === 0
      ? null
      : cancelled.length <= 2
        ? `Ausgefallen: ${cancelled
            .map((block) =>
              block.cancelReason
                ? `„${block.title}“ (${block.cancelReason})`
                : `„${block.title}“`,
            )
            .join(" und ")}.`
        : `${cancelled.length} von ${blocks.length} Blöcken sind ausgefallen.`;
  const missedText =
    missed.length === 0
      ? null
      : `${missed.length} von ${blocks.length} Blöcken ${missed.length === 1 ? "wurde" : "wurden"} in moto nicht gestartet.`;
  return [cancelledText, missedText].filter((part) => part !== null).join(" ");
}

/** Kein Block ist ausgefallen oder ungestartet geblieben. */
function dayWentToPlan(
  blocks: readonly PlannedTimetableInstance[],
  now: string,
): boolean {
  return blocks.every(
    (block) =>
      block.status !== "cancelled" && !blockRowState(block, now).missed,
  );
}

/**
 * Links vor der Jetzt-Linie: wie viele Blöcke heute schon vorbei sind, als
 * Weg in den Tag. Ohne das läse sich die Karte nachmittags, als hätte der
 * Tag nur drei Termine.
 */
function EarlierLink({
  count,
  href,
}: {
  readonly count: number;
  readonly href: string;
}) {
  return (
    // Dieselbe Schrift und dieselben Worte wie „Noch 3 Blöcke ansehen“
    // (`HomeMoreRow`) unter der Liste: beide führen in den Tag im Plan.
    <Link
      href={href}
      className="shrink-0 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
    >
      {count === 1 ? "1 früheren Block" : `${count} frühere Blöcke`} ansehen
    </Link>
  );
}

/**
 * Ein Block des Plans. Dieselbe Zeile wie in „Mein Tag", nur führt die ganze
 * Zeile zu ihrem Termin, und rechts steht allein der Zustand.
 */
function PlanRow({
  block,
  now,
  mine,
  href,
  opensPlan,
  wideOnly,
}: {
  readonly block: PlannedTimetableInstance;
  readonly now: string;
  readonly mine: boolean;
  readonly href: string;
  /** Die Zeile öffnet den Termin im Betreuungsplan statt den Tagesplan. */
  readonly opensPlan: boolean;
  /** Nur in zwei Spalten ist für diese Zeile Platz. */
  readonly wideOnly: boolean;
}) {
  const { over } = blockRowState(block, now);
  // Beendete Blöcke sind ausgegraut und ohne Tönung, auf der gray-500 keine
  // 4,5:1 erreicht (#7110).
  const tinted = mine && !over;
  // Rechts steht nur, was JETZT zählt: läuft, fällt aus, nicht gestartet
  // oder beginnt gleich. Ein Block am Nachmittag braucht morgens keine Marke
  // „in 7 Std“; seine Uhrzeit steht links, und zehn blaue Marken
  // untereinander sagen nichts mehr. „Beendet“ nennt die Metazeile.
  const farAhead =
    block.status === "planned" &&
    !block.isOverdue &&
    now !== "" &&
    minutesBetween(now, block.startTime) > SOON_MINUTES;
  return (
    <li
      className={`mb-1 break-inside-avoid ${wideOnly ? "hidden @3xl:block" : ""}`}
    >
      <ListRow
        density="compact"
        href={href}
        style={blockTintStyle(block, tinted)}
        trailing={
          over || farAhead ? undefined : <BlockState block={block} now={now} />
        }
      >
        <BlockRowBody
          block={block}
          now={now}
          metaLines={2}
          // Die Tönung allein las sich neben „Läuft“ als „läuft auch“: das
          // Wort sagt, was sie meint.
          titleAddon={
            mine ? (
              <span className="ml-2 text-xs font-normal text-gray-600">
                Dein Block
              </span>
            ) : null
          }
        />
        {/* Named by what the row shows (WCAG 2.5.3, #7112); the target
            follows hidden. */}
        <span className="sr-only">{`, ${opensPlan ? "im Betreuungsplan öffnen" : "unter Heute öffnen"}`}</span>
      </ListRow>
    </li>
  );
}
