"use client";

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
  // Was ausfällt, steht immer als Zeile da, auch hinter der Kappung: genau
  // auf diesen Block muss die Leitung handeln.
  const narrow = keepCancelled(open, useHomeCardRows(open, COLUMN_ROWS).shown);
  const wide = keepCancelled(open, useHomeCardRows(open, WIDE_ROWS).shown);
  const inNarrow = new Set(narrow.shown.map((block) => block.id));
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
                description={dayOverText(blocks, now, label)}
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
                {wide.shown.map((block) => (
                  <PlanRow
                    key={block.id}
                    block={block}
                    now={now}
                    mine={showMine && block.isAssigned}
                    href={blockHref(block)}
                    opensPlan={opensPlan}
                    wideOnly={!inNarrow.has(block.id)}
                  />
                ))}
                {/* Je Breite ein eigener Rest: eine Spalte kappt früher. */}
                {narrow.hidden > 0 ? (
                  <li
                    className="mb-1 break-inside-avoid @3xl:hidden"
                    data-plan-more="narrow"
                  >
                    <HomeMoreRow
                      hidden={narrow.hidden}
                      href={dayHref(today)}
                      label="Blöcke"
                      singular="Block"
                    />
                  </li>
                ) : null}
                {wide.hidden > 0 ? (
                  <li
                    className="mb-1 hidden break-inside-avoid @3xl:block"
                    data-plan-more="wide"
                  >
                    <HomeMoreRow
                      hidden={wide.hidden}
                      href={dayHref(today)}
                      label="Blöcke"
                      singular="Block"
                    />
                  </li>
                ) : null}
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
  /** Der Knopf im Kopf der Karte, der die Blöcke des Tages zeigt. */
  openLabel: string,
): string {
  const cancelled = blocks.filter((block) => block.status === "cancelled");
  const missed = blocks.filter((block) => blockRowState(block, now).missed);
  // „Standen im Plan“, nicht „sind vorbei“: neben einem Ausfall wäre das
  // zweite nicht wahr.
  const done =
    blocks.length === 1
      ? "Heute stand 1 Block im Plan."
      : `Heute standen ${blocks.length} Blöcke im Plan.`;
  // Ein oder zwei Ausfälle beim Namen: wer abends nach der Abholung gefragt
  // wird, muss dafür nicht in den Plan wechseln.
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
        : `${cancelled.length} Blöcke sind ausgefallen.`;
  const missedText =
    missed.length === 0
      ? null
      : missed.length === 1
        ? `1 Block wurde in moto nicht gestartet. „${openLabel}“ zeigt ihn.`
        : `${missed.length} Blöcke wurden in moto nicht gestartet. „${openLabel}“ zeigt sie.`;
  return [done, cancelledText, missedText]
    .filter((part) => part !== null)
    .join(" ");
}

/**
 * Die gezeigten Zeilen und dazu jeder Block, der ausfällt, in der
 * Reihenfolge des Tages. `hidden` zählt, was danach noch fehlt.
 */
function keepCancelled(
  all: readonly PlannedTimetableInstance[],
  shown: readonly PlannedTimetableInstance[],
): { shown: readonly PlannedTimetableInstance[]; hidden: number } {
  const visible = new Set(shown.map((block) => block.id));
  const kept = all.filter(
    (block) => visible.has(block.id) || block.status === "cancelled",
  );
  return { shown: kept, hidden: all.length - kept.length };
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
