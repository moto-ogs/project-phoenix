import { Fragment, type ReactNode } from "react";

import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { StatusBadge } from "~/components/ui/status-badge";
import { blockStaffNames } from "~/components/timetable/block-row-parts";
import {
  blockChildrenLabel,
  blockEndLine,
  hasOpenEnd,
} from "~/lib/block-children";
import { formatMinutesAhead, minutesBetween } from "~/lib/home-clock";
import type { PlannedTimetableInstance } from "~/lib/timetable-operations-types";
import { roomsConcept } from "~/lib/concepts/rooms";
import { staffConcept } from "~/lib/concepts/staff";

/**
 * Die Blockzeile der Startseite (#2180, #8134): „Mein Tag“ und
 * „Betreuungsplan heute“ zeigen denselben Block, also mit derselben Zeile.
 * Links Beginn und Ende, daneben der Name und darunter, was man zum Block
 * wissen muss: Raum, Gruppe, Kinder und Team. Was rechts steht (Zustand,
 * Starten-Knopf) und wohin die Zeile führt, entscheidet die Karte.
 */

/** Wo ein Block relativ zur Uhr steht, für beide Karten gleich gerechnet. */
export function blockRowState(block: PlannedTimetableInstance, now: string) {
  const running = block.status === "active";
  const cancelled = block.status === "cancelled";
  // Ein Dienst (#3822) wird nie gestartet und hat keine Kinder.
  const isDuty = block.isDuty === true;
  const ended =
    block.status === "planned" && now !== "" && block.endTime <= now;
  // Vorbei ist vorbei: ausgegraut über Schrift in gray-500 statt Deckkraft
  // (WCAG 1.4.3, #7110), damit das Laufende und Kommende von selbst
  // hervortritt, wie im Tagesplan.
  const over = block.status === "completed" || ended;
  return { running, cancelled, isDuty, ended, missed: ended && !isDuty, over };
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
 * Wie `openUntil`, aber ohne Regel für `completed`: „Mein Tag“ ist älter als
 * #8134, ein vorzeitig beendeter eigener Block bleibt dort bis zu seiner Endzeit.
 */
export function openUntilKeepingCompleted(
  block: Pick<PlannedTimetableInstance, "status" | "endTime">,
): string {
  return block.status === "active" ? "24:00" : block.endTime;
}

/** „13:00 bis 14:00“ oder „seit 15:16“, für den vorgelesenen Namen. */
export function blockSpokenTime(block: PlannedTimetableInstance): string {
  return hasOpenEnd(block)
    ? `seit ${block.startTime}`
    : `${block.startTime} bis ${block.endTime}`;
}

/**
 * Die Jetzt-Linie: dieselbe wie im Tagesplan, nur schmaler. Grüne Linie und
 * grüne Uhrzeit, damit die Stelle im Tag beim Überfliegen hängen bleibt.
 * `before` steht links vor der Linie: was vor jetzt liegt und hier nicht
 * mehr als Zeile steht.
 */
export function NowLine({
  now,
  before,
}: {
  readonly now: string;
  readonly before?: ReactNode;
}) {
  return (
    <span className="flex items-center gap-2 px-1 text-xs">
      {before}
      <span className="bg-moto-green h-px flex-1" aria-hidden="true"></span>
      <span
        className="text-moto-green-strong font-semibold tabular-nums"
        aria-label={`Jetzt, ${now} Uhr`}
      >
        Jetzt · {now} Uhr
      </span>
      {/* Am Handy bleibt neben `before` kein Platz für zwei Linien: zwei
          Stummel sähen aus wie Gedankenstriche. */}
      <span
        className={`bg-moto-green h-px flex-1 ${before ? "max-sm:hidden" : ""}`}
        aria-hidden="true"
      ></span>
    </span>
  );
}

/**
 * Zeit, Name und Metazeile eines Blocks. Was vorbei ist, steht als Wort in
 * der Metazeile, nicht als Marke rechts: auf dem Handy nähme die Marke dem
 * Namen den Platz, und „Beendet“ muss niemandem ins Auge springen.
 */
export function BlockRowBody({
  block,
  now,
  titleAddon,
  metaLines = 1,
}: {
  readonly block: PlannedTimetableInstance;
  readonly now: string;
  /** Hinter dem Namen, etwa „Vertretung“ am eigenen Block. */
  readonly titleAddon?: ReactNode;
  /**
   * So viele Zeilen darf die Metazeile ab `sm` haben. Eine Karte mit fester
   * Höhe bleibt bei einer; eine, die mit ihrem Inhalt wächst, nimmt zwei,
   * damit der Name der Vertretung nicht bei „Claudia Wagn…“ endet.
   */
  readonly metaLines?: 1 | 2;
}) {
  const { running, cancelled, isDuty, ended, missed, over } = blockRowState(
    block,
    now,
  );
  const room =
    block.roomName ??
    (isDuty && block.roomId === "0" ? null : `Raum ${block.roomId}`);
  // Kinderzahl so knapp wie im Tagesplan: laufend „12 von 18 da“ und wer
  // gegangen ist, danach nur noch, wer da war, davor, wer erwartet wird.
  const children = cancelled
    ? null
    : isDuty
      ? "Dienst"
      : blockChildrenLabel(block);
  const staff = blockStaffNames(block);
  // Raum und Personal tragen ihre Konzeptsymbole wie im Tagesplan (#4350).
  const meta: ReactNode[] = [
    block.status === "completed" ? "Beendet" : null,
    missed ? "Nicht gestartet" : null,
    // Ein Dienst wird nie gestartet: „Beendet" und „Nicht gestartet"
    // passen nicht, er ist schlicht vorbei.
    ended && isDuty ? "Vorbei" : null,
    room ? (
      <Fragment key="room">
        <MotoConceptIcon
          concept={roomsConcept}
          tone={over ? "neutral" : undefined}
          size={14}
          className="mr-1 inline-block align-[-2px]"
        />
        {room}
      </Fragment>
    ) : null,
    block.groupName,
    children,
    staff ? (
      <Fragment key="staff">
        <MotoConceptIcon
          concept={staffConcept}
          tone={over ? "neutral" : undefined}
          size={14}
          className="mr-1 inline-block align-[-2px]"
        />
        {staff}
      </Fragment>
    ) : null,
  ].filter(Boolean);

  return (
    <>
      <span className="w-14 shrink-0 sm:w-16">
        <span
          className={`block text-sm font-semibold tabular-nums ${over ? "text-gray-500" : "text-gray-900"}`}
        >
          {block.startTime}
        </span>
        <span className="block text-xs text-gray-500 tabular-nums">
          {blockEndLine(block)}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span
          // Am Telefon bricht der Name um: abgeschnitten stünde vom Zusatz
          // dahinter nur „Dein Bl…“ da.
          className={`block text-sm sm:truncate ${over ? "text-gray-500" : "text-gray-900"} ${running ? "font-semibold" : "font-medium"}`}
        >
          {block.title}
          {titleAddon}
        </span>
        {/* Am Handy bricht die Zeile um: dort wächst die Karte mit ihrem
            Inhalt, und abgeschnitten bliebe neben der Marke oft nur der
            Raum, ohne das Team. */}
        <span
          className={`block text-xs text-gray-500 max-sm:line-clamp-3 ${metaLines === 2 ? "sm:line-clamp-2" : "sm:truncate"}`}
        >
          {/* „Fällt aus“ sagt die Marke rechts; hier steht der Grund. */}
          {cancelled && block.cancelReason
            ? block.cancelReason
            : meta.flatMap((part, index) =>
                index === 0 ? [part] : [" · ", part],
              )}
        </span>
      </span>
    </>
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
  const { running, cancelled, isDuty } = blockRowState(block, now);
  if (cancelled) {
    return <StatusBadge tone="red" label="Fällt aus" />;
  }
  if (running) {
    return <StatusBadge tone="green" label="Läuft" />;
  }
  if (block.status === "completed") {
    return <StatusBadge tone="gray" label="Beendet" />;
  }
  // Ein Dienst (#3822) wird nie gestartet; "Nicht gestartet" wäre falsch.
  if (isDuty && (block.isOverdue || block.startTime <= now)) {
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
