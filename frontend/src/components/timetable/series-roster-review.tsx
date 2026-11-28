"use client";

import { Button } from "~/components/ui/button";
import type { RosterDeviation } from "~/lib/roster-deviation";
import { cn } from "~/lib/utils";

import type { ExpiredRosterSource } from "~/lib/timetable-types";

import { ExpiredSourceHint } from "./expired-source-hint";
import { RosterDeviationHint } from "./roster-deviation-hint";

/**
 * The roster decision of a Regeltermin in the occurrence details and on the
 * series card (#5103):
 * the deviation hint with both decisions, or, after „Liste so lassen“, one
 * quiet line with the way back. A source of an ended phase (#8203) shows its
 * own note with the connection to the new offering. Shows nothing otherwise.
 */
export function SeriesRosterReview({
  deviation,
  manualRosterConfirmed,
  busy = false,
  className = "mt-2",
  onConnect,
  onSetManualRoster,
  expiredSources,
  expiredConnection,
}: Readonly<{
  deviation?: RosterDeviation;
  manualRosterConfirmed: boolean;
  busy?: boolean;
  className?: string;
  onConnect?: (deviation: RosterDeviation) => void;
  onSetManualRoster?: (confirmed: boolean) => void;
  /** Source offerings of an ended phase (#8203). */
  expiredSources?: readonly ExpiredRosterSource[];
  /** The connection to the new offering; `onConnect` opens it. */
  expiredConnection?: RosterDeviation | null;
}>) {
  if (deviation) {
    return (
      <RosterDeviationHint
        deviation={deviation}
        busy={busy}
        className={className}
        onConnect={onConnect ? () => onConnect(deviation) : undefined}
        onKeepManual={
          onSetManualRoster ? () => onSetManualRoster(true) : undefined
        }
      />
    );
  }
  if (expiredConnection && expiredSources && expiredSources.length > 0) {
    return (
      <ExpiredSourceHint
        expired={expiredSources}
        connection={expiredConnection}
        busy={busy}
        className={className}
        onConnect={onConnect}
      />
    );
  }
  if (!manualRosterConfirmed) return null;
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-2 text-sm text-gray-600",
        className,
      )}
    >
      <span>Die Kinderliste bleibt bewusst so.</span>
      {onSetManualRoster ? (
        <Button
          type="button"
          variant="ghost"
          size="compact"
          disabled={busy}
          onClick={() => onSetManualRoster(false)}
          tooltip="Zeigt sofort wieder, wo die Kinderliste von den Anmeldungen abweicht."
        >
          Hinweis wieder zeigen
        </Button>
      ) : null}
    </p>
  );
}
