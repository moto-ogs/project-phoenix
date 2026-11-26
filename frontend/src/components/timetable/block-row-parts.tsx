// Gemeinsame Teile der Blockzeilen im Tagesbetrieb (#4350): Tagesplan,
// "Mein Tag", "Ablauf des Tages" und "Als Nächstes" in der Aufsicht zeigen
// denselben Block, also mit derselben Markierung für den eigenen Block und
// denselben Symbolen für Raum und Personal. Die farbige Kante trägt nur
// der Tagesplan; die Startseite und "Als Nächstes" tönen nur (#4413).

import type { CSSProperties } from "react";
import { TIMETABLE_UNTYPED_EDGE_COLOR } from "~/components/timetable/timetable-colors";
import { LOCATION_COLORS } from "~/lib/location-helper";
import { cn } from "~/lib/utils";
import type { PlannedTimetableInstance } from "~/lib/timetable-operations-types";

type BlockColorFields = Pick<
  PlannedTimetableInstance,
  "status" | "planningTrackColor"
>;

/** Kantenfarbe eines Blocks: rot bei Absage, sonst die Planungsspur. */
export function blockEdgeColor(block: BlockColorFields): string {
  if (block.status === "cancelled") return LOCATION_COLORS.DANGER;
  return block.planningTrackColor ?? TIMETABLE_UNTYPED_EDGE_COLOR;
}

/**
 * Die Tönung des eigenen Blocks in seiner Farbe, dieselbe wie bei PlanBlock
 * (ui/planning/plan-block.tsx); eine Absage bleibt ungetönt. `mine` setzt nur, wer
 * eigene und fremde Blöcke nebeneinander zeigt: wo alles eigen ist, sagte
 * die Tönung nichts. Ohne Kante für die Startseite und „Als Nächstes“ (#4413).
 */
export function blockTintStyle(
  block: BlockColorFields,
  mine: boolean,
): CSSProperties {
  return mine && block.status !== "cancelled"
    ? { backgroundColor: `${blockEdgeColor(block)}1A` }
    : {};
}

/** Linke Kante in der Farbe des Blocks und die Tönung des eigenen Blocks. */
export function blockRowStyle(
  block: BlockColorFields,
  mine: boolean,
): CSSProperties {
  return {
    borderLeftColor: blockEdgeColor(block),
    ...blockTintStyle(block, mine),
  };
}

/**
 * Die Tönung ist nur Farbe; Vorleseprogramme bekommen das Wort dazu. In den
 * Titel des Blocks setzen.
 */
export function OwnBlockHint({ mine }: Readonly<{ mine: boolean }>) {
  return mine ? <span className="sr-only"> · Mein Block</span> : null;
}

/** Eingeteiltes Personal als eine Zeile, Vertretungen benannt. */
export function blockStaffNames(
  block: Pick<PlannedTimetableInstance, "staffNames">,
): string | null {
  const names = block.staffNames ?? [];
  if (names.length === 0) return null;
  return names
    .map((entry) =>
      entry.isSubstitute
        ? `${entry.displayName} (Vertretung)`
        : entry.displayName,
    )
    .join(", ");
}

/** „Julia Klein“ → „Julia K.“; ein einzelnes Wort bleibt, wie es ist. */
function shortPersonName(displayName: string): string {
  const words = displayName.trim().split(/\s+/);
  const last = words.at(-1);
  if (words.length < 2 || !last) return displayName;
  return `${words.slice(0, -1).join(" ")} ${last.charAt(0)}.`;
}

/**
 * Personal kurz für eine Zeile am Telefon: „Julia K. +1“. Eine Vertretung
 * steht vorn und ist benannt („Claudia W. (Vertretung) +1“), weil sie heute
 * anders ist als der Plan. Alle Namen stehen ausgeschrieben im Blatt.
 */
export function blockStaffShort(
  block: Pick<PlannedTimetableInstance, "staffNames">,
): string | null {
  const names = block.staffNames ?? [];
  const first = names.find((entry) => entry.isSubstitute) ?? names[0];
  if (!first) return null;
  const name = shortPersonName(first.displayName);
  const label = first.isSubstitute ? `${name} (Vertretung)` : name;
  return names.length > 1 ? `${label} +${names.length - 1}` : label;
}

/** Ein Teil der Angabenzeile einer Blockzeile. */
export interface BlockRowPart {
  readonly key: string;
  readonly text: string;
  /** Ein Ausfallgrund steht rot. */
  readonly danger?: boolean;
  /**
   * Wie der Teil schrumpft, wenn die Zeile nicht reicht: `room` kürzt
   * mit „…“, `count` höchstens bis 60 % der Zeile, `staff` nie. Hat ein Teil diese
   * Angabe, entfällt keiner mehr; sonst bleibt die alte Regel (ein Teil,
   * der nicht passt, entfällt mit seinem Trenner).
   */
  readonly shrink?: "room" | "count" | "staff";
}

// Nur der Raum schrumpft mit „…“; die Kinder haben eine feste Obergrenze
// (lange Angaben wie „3 nicht mehr im Raum“), das Personal bleibt ganz.
// Schrumpften alle anteilig, kürzte schon ein halber Pixel „Julia K.“.
const SHRINK_CLASS: Record<NonNullable<BlockRowPart["shrink"]>, string> = {
  room: "min-w-0 shrink truncate",
  count: "max-w-[60%] shrink-0 truncate",
  staff: "shrink-0",
};

/**
 * Angabenzeile einer Blockzeile am Telefon: genau eine Zeile, gekürzt wird
 * an den Teilgrenzen. Ein Teil, der nicht mehr ganz passt, entfällt mit
 * seinem Trenner (statt „OGS-Raum 2 · 16 Kind…“); vorne steht das
 * Wichtigste (Raum, Kinder). Alle Angaben stehen am Ziel der Zeile.
 * Tragen Teile `shrink`, entfällt keiner: Raum und Personal kürzen mit
 * „…“, damit am SE nicht still ein Name fehlt, der am iPhone 15 steht.
 */
export function BlockRowParts({
  parts,
}: Readonly<{ parts: readonly BlockRowPart[] }>) {
  const fits = parts.some((part) => part.shrink != null);
  return (
    <span
      className={cn(
        "flex h-5 overflow-hidden",
        fits ? "min-w-0 flex-nowrap" : "flex-wrap",
      )}
    >
      {parts.map((part, index) => (
        <span
          key={part.key}
          className={cn(
            "whitespace-nowrap",
            fits
              ? part.shrink
                ? SHRINK_CLASS[part.shrink]
                : "shrink-0"
              : index === 0 && "min-w-0 truncate",
            part.danger && "text-moto-red-strong",
          )}
        >
          {index > 0 ? (
            <span className="text-gray-500">{"\u00a0·\u00a0"}</span>
          ) : null}
          {part.text}
        </span>
      ))}
    </span>
  );
}
