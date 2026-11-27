"use client";

// Schnellaktionen der Kindakte in der App (#8070): Die Leiste über der Pill
// trägt die Hauptaktion, die zum Zustand des Kindes passt (Abmelden oder
// Anmelden). Alle übrigen Tagesaktionen (Krank melden, Entschuldigen,
// Klassenfahrt) stehen als kleine Kacheln direkt unter der Kopfkarte, mit
// denselben Symbolen wie die Kacheln am Desktop: wichtig und sichtbar, nicht
// im „···“ der Kopfkarte (Feedback 27.11.).
//
// Die Handler sind dieselben wie die der Kacheln am Desktop: Rückfragen,
// Rechte und Fehlerwege gibt es nur einmal.

import { LogIn } from "lucide-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { ActionBar } from "~/components/ui/action-bar";
import { Button } from "~/components/ui/button";
import { SpinnerIcon } from "~/components/ui/icons";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { TileCard } from "~/components/ui/tile-card";
import { classTripConcept } from "~/lib/concepts/classTrip";
import { excusedConcept } from "~/lib/concepts/excused";
import { homeConcept } from "~/lib/concepts/home";
import { sickConcept } from "~/lib/concepts/sick";

export interface StudentAppActionBarProps {
  readonly showCheckout: boolean;
  readonly showCheckin: boolean;
  readonly canSickExcused: boolean;
  readonly canPlanAbsence: boolean;
  readonly isSick: boolean;
  readonly isExcused: boolean;
  readonly isClassTrip: boolean;
  readonly onCheckout: () => void;
  readonly onCheckin: () => void;
  readonly onSick: () => void;
  readonly onExcused: () => void;
  readonly onClassTrip: () => void;
  readonly sickLoading: boolean;
  readonly excusedLoading: boolean;
  readonly plannedStatusLoading: boolean;
}

export interface StudentQuickAction {
  readonly key: string;
  readonly label: string;
  readonly run: () => void;
  readonly loading?: boolean;
  /** Ein Satz: was die Aktion bewirkt (Hinweis am Knopf der Leiste). */
  readonly hint: string;
  /** Symbol der Kachel, dasselbe wie an der Kachel am Desktop. */
  readonly icon: ReactNode;
}

const TILE_ICON_SIZE = 24;

/**
 * Die Tagesaktionen der Kindakte in fester Reihenfolge, wie die Kacheln am
 * Desktop. Die erste steht in der Leiste, alle weiteren in der
 * Kachelzeile unter der Kopfkarte.
 */
export function studentAppQuickActions(
  props: StudentAppActionBarProps,
  /** Wie die Kacheln am Desktop: An- und Abmelden nur mit Anwesenheit im Web. */
  attendanceWebEnabled: boolean,
): readonly StudentQuickAction[] {
  const entries: StudentQuickAction[] = [];
  if (props.showCheckout && attendanceWebEnabled)
    entries.push({
      key: "abmelden",
      label: "Abmelden",
      run: props.onCheckout,
      hint: "Meldet das Kind ab, moto fragt vorher nach.",
      icon: <MotoConceptIcon concept={homeConcept} size={TILE_ICON_SIZE} />,
    });
  if (props.showCheckin && attendanceWebEnabled)
    entries.push({
      key: "anmelden",
      label: "Anmelden",
      run: props.onCheckin,
      hint: "Meldet das Kind für heute an, moto fragt vorher nach.",
      icon: <LogIn className="text-moto-green size-5" aria-hidden />,
    });
  if (props.canSickExcused) {
    entries.push({
      key: "krank",
      label: props.isSick ? "Gesund melden" : "Krank melden",
      hint: props.isSick
        ? "Beendet die Krankmeldung, moto fragt vorher nach."
        : "Meldet das Kind krank, moto fragt vorher nach.",
      run: props.onSick,
      loading: props.sickLoading,
      icon: <MotoConceptIcon concept={sickConcept} size={TILE_ICON_SIZE} />,
    });
    entries.push({
      key: "entschuldigen",
      label: props.isExcused ? "Entschuldigung aufheben" : "Entschuldigen",
      hint: props.isExcused
        ? "Nimmt die Entschuldigung zurück, moto fragt vorher nach."
        : "Das Kind fehlt aus einem anderen Grund als Krankheit, moto fragt vorher nach.",
      run: props.onExcused,
      loading: props.excusedLoading,
      icon: <MotoConceptIcon concept={excusedConcept} size={TILE_ICON_SIZE} />,
    });
  }
  if (props.canPlanAbsence)
    entries.push({
      key: "klassenfahrt",
      label: props.isClassTrip
        ? "Klassenfahrt bearbeiten"
        : "Klassenfahrt planen",
      hint: "Setzt einen Zeitraum, in dem das Kind nicht kommt.",
      run: props.onClassTrip,
      loading: props.plannedStatusLoading,
      icon: (
        <MotoConceptIcon concept={classTripConcept} size={TILE_ICON_SIZE} />
      ),
    });
  return entries;
}

/**
 * Wie viele der Tagesaktionen in der Leiste stehen: nur die Hauptaktion.
 * Die übrigen stehen sichtbar in der Kachelzeile unter der Kopfkarte.
 */
function studentAppBarCount(entries: readonly StudentQuickAction[]): number {
  return Math.min(1, entries.length);
}

/**
 * Die Tagesaktionen, die nicht in der Leiste stehen, als Kachelzeile direkt
 * unter der Kopfkarte (#8070, Feedback 27.11.): dieselben Symbole und Wörter
 * wie die Kacheln am Desktop, nur kleiner. Lange Wörter („Entschuldigung
 * aufheben“) brechen in eine zweite Zeile, statt aus der Kachel zu laufen.
 */
export function StudentAppQuickActionRow({
  entries,
}: Readonly<{ entries: readonly StudentQuickAction[] }>) {
  const rest = entries.slice(studentAppBarCount(entries));
  if (rest.length === 0) return null;
  return (
    <div role="group" aria-label="Schnellaktionen" className="flex gap-2">
      {rest.map((action) => (
        <TileCard
          key={action.key}
          onClick={action.run}
          disabled={action.loading}
          padding="none"
          // Symbol und Wort stehen in der Mitte der Kachel, auch wenn eine
          // Nachbarkachel zweizeilig und die Zeile dadurch höher ist.
          className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 active:scale-[0.97]"
        >
          <span className="flex size-6 items-center justify-center" aria-hidden>
            {action.loading ? <SpinnerIcon className="size-5" /> : action.icon}
          </span>
          <span className="text-center text-xs leading-4 font-semibold text-balance text-gray-900">
            {action.label}
          </span>
        </TileCard>
      ))}
    </div>
  );
}

export function StudentAppActionBar({
  entries,
}: Readonly<{ entries: readonly StudentQuickAction[] }>) {
  const [primary] = entries;
  if (!primary) return null;

  // Die Seite reicht die Leiste in ihre Spalte; am iPad quer ist das die
  // Detailspalte mit eigenem Scroll und Ausblend-Maske. Die Maske gilt auch
  // für feste Kinder und blendete die Leiste ganz aus. Darum hängt sie am
  // Dokument; ihre Lage liest sie weiter aus der Spalte (`column`).
  const bar = (
    <ActionBar column="detail">
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={primary.run}
        isLoading={primary.loading}
        tooltip={primary.hint}
      >
        {primary.label}
      </Button>
    </ActionBar>
  );

  return typeof document === "undefined"
    ? bar
    : createPortal(bar, document.body);
}
