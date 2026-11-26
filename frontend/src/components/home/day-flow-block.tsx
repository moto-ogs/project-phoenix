"use client";

import { ListRow } from "~/components/ui/list-row";
import Link from "~/components/ui/navigation-link";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SkeletonRows } from "~/components/ui/skeleton";
import {
  HomeCard,
  HomeCardEmpty,
  HomeCardIcon,
} from "~/components/home/home-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { blockTintStyle } from "~/components/timetable/block-row-parts";
import { useOperationalOverviewScope } from "~/lib/tenant-context";
import { formatMinutesAhead, minutesBetween } from "~/lib/home-clock";
import { timetableOperationsApi } from "~/lib/timetable-operations-api";
import type { PlannedTimetableInstance } from "~/lib/timetable-operations-types";
import { useSWRAuth } from "~/lib/swr";
import { homeKeys } from "~/lib/swr/portal-keys";
import { useCarePlanTodayTarget } from "~/lib/hooks/use-day-plan-href";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import {
  BlockRowBody,
  blockRowState,
  NowLine,
} from "~/components/home/home-block-row";
import {
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
 *
 * Bewusst `scope: "day"` statt des Standardfensters: das liefert nur, was in
 * den nächsten 15 Minuten beginnt, und lässt einen gerade laufenden Block
 * ganz weg.
 *
 * Bewusst ohne Kinderlisten: die Startseite ist eine Übersicht, und die
 * Namen gehören in den Termin (GDPR).
 */
export function DayFlowBlock() {
  const { opensPlan, dayHref, blockHref } = useCarePlanTodayTarget();
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
  const loadError = useSwrLoadError(
    error,
    "die Karte „Betreuungsplan heute“",
    () => mutate(),
  );

  const now = useBerlinClock();
  // Eigene Blöcke sind in ihrer Farbe hinterlegt wie im Tagesplan (#4350),
  // aber nur, wo eigene und fremde nebeneinander stehen.
  const showMine = useOperationalOverviewScope() === "all_staff";
  const blocks = data ?? [];
  // Ab dem Block, der gerade läuft: sonst stünde um 16 Uhr immer noch die
  // Frühbetreuung oben in der Karte. Ist der Tag vorbei, bleiben die letzten
  // Blöcke stehen: „heute war das" ist eine Antwort, eine leere Karte keine.
  const { items: open, allPast } = upcomingFirst(blocks, openUntil, now);
  // Eine Spalte und zwei Spalten kappen verschieden. Die schmale Auswahl ist
  // immer Teil der breiten: dieselbe Liste, vom selben Ende her gekürzt.
  const narrow = useHomeCardRows(open, COLUMN_ROWS, { preferLatest: allPast });
  const wide = useHomeCardRows(open, WIDE_ROWS, { preferLatest: allPast });
  const inNarrow = new Set(narrow.shown.map((block) => block.id));
  // Zwei Spalten nur, wenn eine nicht reicht: zwei oder drei Blöcke
  // nebeneinander läse man quer statt erst nach unten.
  const columns =
    open.length > COLUMN_ROWS
      ? "@3xl:columns-2 @3xl:gap-x-6 @3xl:[column-rule:1px_solid_var(--color-gray-200)]"
      : "";
  const today = blocks[0]?.date;
  // Was vor jetzt lag, steht nicht mehr als Zeile da. Die Karte nennt die
  // Zahl, damit drei Zeilen am Nachmittag nicht wie der ganze Tag aussehen.
  const earlier = allPast ? 0 : blocks.length - open.length;
  const label = opensPlan ? "Plan öffnen" : "Heute öffnen";

  return (
    <HomeCard
      title="Betreuungsplan heute"
      leading={<HomeCardIcon concept={carePlanConcept} />}
      inlineActions
      actions={
        <HomeCardLink
          href={dayHref(today)}
          label={`Betreuungsplan heute: ${label}`}
          tooltip={
            opensPlan
              ? "Öffnet den Betreuungsplan von heute."
              : "Öffnet deinen Tagesplan für heute."
          }
        >
          {label}
        </HomeCardLink>
      }
    >
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
        return (
          <div className="@container" data-home-card-fit="">
            {/* Die Jetzt-Linie steht über beiden Spalten: in der Liste stünde
                sie nur über der linken und verschöbe deren Zeilen gegen die
                rechte. Ohne Uhr (erstes Rendern) gibt es keine Linie. */}
            {now !== "" && !allPast ? (
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
            {/* Der Tag ist vorbei: die Linie steht unter dem letzten Block. */}
            {now !== "" && allPast ? (
              <div className="mt-1.5">
                <NowLine now={now} />
              </div>
            ) : null}
          </div>
        );
      })()}
    </HomeCard>
  );
}

/**
 * Bis wann ein Block für die Karte offen ist. Ein Block, der laut Server
 * noch läuft, zählt als „jetzt", auch wenn seine geplante Endzeit vorbei ist:
 * die Jetzt-Zone zählt ihn ebenfalls mit. Ein vorzeitig beendeter Block ist
 * vorbei, auch wenn seine geplante Zeit noch läuft.
 */
export function openUntil(
  block: Pick<PlannedTimetableInstance, "status" | "endTime">,
): string {
  if (block.status === "active") return "24:00";
  if (block.status === "completed") return "00:00";
  return block.endTime;
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
        <BlockRowBody block={block} now={now} />
        {/* Named by what the row shows (WCAG 2.5.3, #7112); the mark and
            the target follow hidden. */}
        <span className="sr-only">{`${mine ? ", Mein Block" : ""}, ${opensPlan ? "im Betreuungsplan öffnen" : "unter Heute öffnen"}`}</span>
      </ListRow>
    </li>
  );
}

/**
 * Der Zustand eines Blocks relativ zur Uhr — dieselben Wörter wie im
 * Tagesplan („Läuft", „Nicht gestartet", „Fällt aus"), und für das Kommende
 * die Zeit bis zum Beginn statt eines „Geplant", das nichts sagt. „Mein Tag"
 * nutzt dieselbe Marke, damit beide Karten dieselbe Sprache sprechen.
 */
export function BlockState({
  block,
  now,
}: {
  readonly block: PlannedTimetableInstance;
  readonly now: string;
}) {
  if (block.status === "cancelled") {
    return <StatusBadge tone="red" label="Fällt aus" />;
  }
  if (block.status === "active") {
    return <StatusBadge tone="green" label="Läuft" />;
  }
  if (block.status === "completed") {
    return <StatusBadge tone="gray" label="Beendet" />;
  }
  // Ein Dienst (#3822) wird nie gestartet; "Nicht gestartet" wäre falsch.
  if (block.isDuty === true && (block.isOverdue || block.startTime <= now)) {
    return null;
  }
  if (block.isOverdue || (now !== "" && block.startTime <= now)) {
    return <StatusBadge tone="warning" label="Nicht gestartet" />;
  }
  // Ohne Uhr (vor dem ersten Rendern im Browser) gibt es keinen Abstand.
  if (now === "") return null;
  return (
    <StatusBadge
      tone="blue"
      label={formatMinutesAhead(minutesBetween(now, block.startTime))}
    />
  );
}
