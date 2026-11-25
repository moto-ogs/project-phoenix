"use client";

// Schnellaktionen der Kindakte in der App (#8070): Die Hauptaktion steht in
// Daumennähe über der Pill (An- oder Abmelden), „Krank melden“ daneben, alles
// Seltenere (Entschuldigen, Klassenfahrt) im einen „···“ der Kopfkarte. Die
// Kopfkarte bleibt so eine Zeile Name plus Statuschips.
//
// Die Handler sind dieselben wie die der Kacheln am Desktop: Rückfragen,
// Rechte und Fehlerwege gibt es nur einmal.

import { createPortal } from "react-dom";

import { ActionBar } from "~/components/ui/action-bar";
import { Button } from "~/components/ui/button";

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
  /** Eine Zeile im Kopfmenü: was die Aktion bewirkt. */
  readonly hint: string;
}

/**
 * Die Tagesaktionen der Kindakte in fester Reihenfolge. Die ersten zwei
 * stehen in der Leiste; alle weiteren führt die Seite im „···“ der
 * Kopfkarte, damit es nur ein Menü gibt.
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
    });
  if (props.showCheckin && attendanceWebEnabled)
    entries.push({
      key: "anmelden",
      label: "Anmelden",
      run: props.onCheckin,
      hint: "Meldet das Kind für heute an, moto fragt vorher nach.",
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
    });
    entries.push({
      key: "entschuldigen",
      label: props.isExcused ? "Entschuldigung aufheben" : "Entschuldigen",
      hint: props.isExcused
        ? "Nimmt die Entschuldigung zurück, moto fragt vorher nach."
        : "Markiert das Kind als entschuldigt, moto fragt vorher nach.",
      run: props.onExcused,
      loading: props.excusedLoading,
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
    });
  return entries;
}

export function StudentAppActionBar({
  entries,
}: Readonly<{ entries: readonly StudentQuickAction[] }>) {
  const [primary, second] = entries;
  if (!primary) return null;

  // Die Seite reicht die Leiste in ihre Spalte; am iPad quer ist das die
  // Detailspalte mit eigenem Scroll und Ausblend-Maske. Die Maske gilt auch
  // für feste Kinder und blendete die Leiste ganz aus. Darum hängt sie am
  // Dokument; ihre Lage liest sie weiter aus der Spalte (`column`).
  const bar = (
    <ActionBar
      column="detail"
      secondary={
        second ? (
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={second.run}
            isLoading={second.loading}
            tooltip={second.hint}
          >
            {second.label}
          </Button>
        ) : undefined
      }
    >
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
