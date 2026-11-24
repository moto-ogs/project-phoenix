"use client";

import { LogIn, MoreVertical } from "lucide-react";
import { useAttendanceWebEnabled } from "~/lib/tenant-context";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { classTripConcept } from "~/lib/concepts/classTrip";
import { excusedConcept } from "~/lib/concepts/excused";
import { homeConcept } from "~/lib/concepts/home";
import { sickConcept } from "~/lib/concepts/sick";
import { SpinnerIcon } from "~/components/ui/icons";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { TileCard, tileCardSurface } from "~/components/ui/tile-card";
import { cn } from "~/lib/utils";

// Die Schnellaktionen stehen als gleich hohe Kacheln nebeneinander; das
// Polster ist das Kartenpolster der TileCard (#6135).
// In der App (#8070) schrumpfen die Kacheln zu einer Aktionsleiste: eine
// Zeile, Symbol über kurzem Label, ohne Erklärzeile.
const QUICK_ACTION_TILE =
  "flex flex-1 flex-col items-center gap-3 active:scale-[0.97] sm:gap-4 app:min-w-0 app:gap-1 app:px-1.5 app:py-2";
/** Symbolkreis einer Schnellaktion; in der App nur das Symbol. */
const QUICK_ACTION_ICON =
  "flex h-12 w-12 items-center justify-center rounded-full border-2 sm:h-14 sm:w-14 app:h-7 app:w-7 app:border-0";
const QUICK_ACTION_LABEL =
  "text-base font-semibold text-gray-900 app:text-xs app:leading-4 app:whitespace-nowrap";
const QUICK_ACTION_HINT =
  "mt-0.5 hidden text-xs text-gray-500 sm:block app:hidden";

interface StudentCheckoutSectionProps {
  readonly onCheckoutClick: () => void;
}

export function StudentCheckoutSection({
  onCheckoutClick,
}: StudentCheckoutSectionProps) {
  const attendanceWebEnabled = useAttendanceWebEnabled();
  if (!attendanceWebEnabled) return null;
  return (
    <TileCard onClick={onCheckoutClick} className={QUICK_ACTION_TILE}>
      <div className={cn(QUICK_ACTION_ICON, "border-gray-200")}>
        <MotoConceptIcon concept={homeConcept} size={26} />
      </div>
      <div className="text-center">
        <p className={QUICK_ACTION_LABEL}>Abmelden</p>
        <p className={QUICK_ACTION_HINT}>Aus der OGS abmelden</p>
      </div>
    </TileCard>
  );
}

// Component for check-in action (when student is at home)
interface StudentCheckinSectionProps {
  readonly onCheckinClick: () => void;
}

export function StudentCheckinSection({
  onCheckinClick,
}: StudentCheckinSectionProps) {
  const attendanceWebEnabled = useAttendanceWebEnabled();
  if (!attendanceWebEnabled) return null;
  return (
    <TileCard onClick={onCheckinClick} className={QUICK_ACTION_TILE}>
      <div
        className={cn(QUICK_ACTION_ICON, "border-moto-green text-moto-green")}
      >
        <LogIn className="h-5 w-5 sm:h-6 sm:w-6" />
      </div>
      <div className="text-center">
        <p className={QUICK_ACTION_LABEL}>Anmelden</p>
        <p className={QUICK_ACTION_HINT}>Für heute in der OGS anmelden</p>
      </div>
    </TileCard>
  );
}

// Component for sick report quick-action
interface StudentSickReportSectionProps {
  readonly isSick: boolean;
  readonly sickSince?: string;
  readonly onToggle: () => void;
  readonly isLoading: boolean;
}

export function StudentSickReportSection({
  isSick,
  sickSince,
  onToggle,
  isLoading,
}: StudentSickReportSectionProps) {
  const sickSinceDisplay = sickSince
    ? new Date(sickSince).toLocaleDateString("de-DE", {
        timeZone: "Europe/Berlin",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : null;

  const renderSickIcon = () => {
    if (isLoading) {
      return <SpinnerIcon className="h-5 w-5" />;
    }
    return <MotoConceptIcon concept={sickConcept} size={26} />;
  };

  return (
    <TileCard
      onClick={onToggle}
      disabled={isLoading}
      className={QUICK_ACTION_TILE}
    >
      <div
        className={`${QUICK_ACTION_ICON} ${
          isSick ? "border-moto-green" : "border-moto-red/30"
        }`}
      >
        {renderSickIcon()}
      </div>
      <div className="text-center">
        <p className={QUICK_ACTION_LABEL}>
          {isSick ? "Gesund melden" : "Krank melden"}
        </p>
        <p className={QUICK_ACTION_HINT}>
          {isSick && sickSinceDisplay
            ? `Krank gemeldet seit ${sickSinceDisplay}`
            : "Als krank melden"}
        </p>
      </div>
    </TileCard>
  );
}

// Component for excused (entschuldigt) quick-action
interface StudentExcusedReportSectionProps {
  readonly isExcused: boolean;
  readonly excusedSince?: string;
  readonly onToggle: () => void;
  readonly isLoading: boolean;
}

export function StudentExcusedReportSection({
  isExcused,
  excusedSince,
  onToggle,
  isLoading,
}: StudentExcusedReportSectionProps) {
  const excusedSinceDisplay = excusedSince
    ? new Date(excusedSince).toLocaleDateString("de-DE", {
        timeZone: "Europe/Berlin",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : null;

  const renderExcusedIcon = () => {
    if (isLoading) {
      return <SpinnerIcon className="h-5 w-5" />;
    }
    return <MotoConceptIcon concept={excusedConcept} size={26} />;
  };

  return (
    <TileCard
      onClick={onToggle}
      disabled={isLoading}
      className={QUICK_ACTION_TILE}
    >
      <div
        className={`${QUICK_ACTION_ICON} ${
          isExcused ? "border-moto-green" : "border-moto-purple/30"
        }`}
      >
        {renderExcusedIcon()}
      </div>
      <div className="text-center">
        <p className={QUICK_ACTION_LABEL}>
          {isExcused ? "Entschuldigung aufheben" : "Entschuldigen"}
        </p>
        <p className={QUICK_ACTION_HINT}>
          {isExcused && excusedSinceDisplay
            ? `Entschuldigt seit ${excusedSinceDisplay}`
            : "Als entschuldigt markieren"}
        </p>
      </div>
    </TileCard>
  );
}

interface StudentStatusActionsMenuProps {
  readonly isClassTrip: boolean;
  readonly classTripSince?: string;
  readonly onPlanClassTrip: () => void;
  readonly isLoading: boolean;
}

export function StudentStatusActionsMenu({
  isClassTrip,
  classTripSince,
  onPlanClassTrip,
  isLoading,
}: StudentStatusActionsMenuProps) {
  const classTripSinceDisplay = classTripSince
    ? new Date(classTripSince).toLocaleDateString("de-DE", {
        timeZone: "Europe/Berlin",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : null;

  return (
    <OverflowMenu
      ariaLabel="Weitere Statusaktionen"
      disabled={isLoading}
      wrapperClassName="shrink-0"
      triggerClassName="moto-hover-elevated h-full min-h-[116px] w-full rounded-2xl disabled:opacity-50 sm:min-h-[140px] sm:w-16 app:min-h-0 app:w-12"
      triggerContent={
        // Die Fläche sitzt innen: Ihr Schatten überdeckte sonst den Fokusring
        // des Auslösers.
        <span
          className={cn(
            tileCardSurface({ padding: "none" }),
            // self-stretch statt h-full: Die Höhe des Auslösers kommt aus der
            // Zeile (Flex-Streckung), nicht aus einer festen Angabe; eine
            // Prozenthöhe fiel deshalb am Desktop auf eine Zeile zusammen.
            "flex w-full items-center justify-center self-stretch text-gray-500 hover:text-gray-700",
          )}
        >
          {isLoading ? (
            <SpinnerIcon className="h-5 w-5" />
          ) : (
            // Auf dem Telefon ist das eine Karte so gross wie ihre Nachbarn --
            // drei Punkte allein sagen darin nichts. Neben den schmalen
            // Streifen auf dem Desktop passt kein Wort, dort bleibt es beim
            // Symbol.
            <span className="flex flex-col items-center gap-3">
              <MoreVertical className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />
              <span className="app:hidden text-base font-semibold text-gray-900 sm:hidden">
                Weitere
              </span>
            </span>
          )}
        </span>
      }
      items={[
        {
          label: isClassTrip
            ? "Klassenfahrt bearbeiten"
            : "Klassenfahrt planen",
          description:
            isClassTrip && classTripSinceDisplay
              ? `Seit ${classTripSinceDisplay}`
              : "Zeitraum für seltene Abwesenheit setzen",
          icon: <MotoConceptIcon concept={classTripConcept} size={16} />,
          onClick: onPlanClassTrip,
        },
      ]}
    />
  );
}
