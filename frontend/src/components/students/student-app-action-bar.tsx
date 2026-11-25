"use client";

// Schnellaktionen der Kindakte in der App (#8070): Die Hauptaktion steht in
// Daumennähe über der Pill (An- oder Abmelden), „Krank melden“ daneben, alles
// Seltenere (Entschuldigen, Klassenfahrt) hinter „Mehr“ in einem Blatt. Die
// Kopfkarte bleibt so eine Zeile Name plus Statuschips.
//
// Die Handler sind dieselben wie die der Kacheln am Desktop: Rückfragen,
// Rechte und Fehlerwege gibt es nur einmal.

import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { ActionBar } from "~/components/ui/action-bar";
import { Button } from "~/components/ui/button";
import { ListRow } from "~/components/ui/list-row";
import { OverlaySheet } from "~/components/ui/overlay-sheet";
import { useAttendanceWebEnabled } from "~/lib/tenant-context";

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

interface Entry {
  readonly key: string;
  readonly label: string;
  readonly run: () => void;
  readonly loading?: boolean;
  /** Eine Zeile im Blatt „Weitere Aktionen“: was die Aktion bewirkt. */
  readonly hint: string;
}

export function StudentAppActionBar(props: StudentAppActionBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  // Wie die Kacheln am Desktop: An- und Abmelden nur mit Anwesenheit im Web.
  const attendanceWebEnabled = useAttendanceWebEnabled();
  const entries: Entry[] = [];
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
  const [primary, second, ...rest] = entries;
  if (!primary) return null;

  // Die Seite reicht die Leiste in ihre Spalte; am iPad quer ist das die
  // Detailspalte mit eigenem Scroll und Ausblend-Maske. Die Maske gilt auch
  // für feste Kinder und blendete die Leiste ganz aus. Darum hängt sie am
  // Dokument; ihre Lage liest sie weiter aus der Spalte (`column`).
  const bar = (
    <ActionBar
      column="detail"
      secondary={
        second || rest.length > 0 ? (
          <div className="flex gap-2">
            {second ? (
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
            ) : null}
            {rest.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Weitere Aktionen"
                tooltip="Zeigt weitere Aktionen für dieses Kind, etwa Entschuldigen."
                onClick={() => setMoreOpen(true)}
              >
                <MoreHorizontal className="size-5" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
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

  return (
    <>
      {typeof document === "undefined" ? bar : createPortal(bar, document.body)}
      {rest.length > 0 ? (
        <OverlaySheet
          open={moreOpen}
          onOpenChange={setMoreOpen}
          title="Weitere Aktionen"
        >
          <div className="-mx-2 flex flex-col">
            {rest.map((entry) => (
              <ListRow
                key={entry.key}
                className="min-h-12 bg-transparent text-base"
                onClick={() => {
                  setMoreOpen(false);
                  entry.run();
                }}
              >
                <span className="flex flex-col">
                  <span>{entry.label}</span>
                  <span className="text-sm text-gray-500">{entry.hint}</span>
                </span>
              </ListRow>
            ))}
          </div>
        </OverlaySheet>
      ) : null}
    </>
  );
}
