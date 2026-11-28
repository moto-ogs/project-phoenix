"use client";

import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import type { RosterDeviation } from "~/lib/roster-deviation";
import type { ExpiredRosterSource } from "~/lib/timetable-types";

function quoted(names: readonly string[]): string {
  const marked = names.map((name) => `„${name}“`);
  if (marked.length <= 1) return marked[0] ?? "";
  return `${marked.slice(0, -1).join(", ")} und ${marked.at(-1)}`;
}

/**
 * The note a Regeltermin carries when its source offering belongs to an
 * enrollment phase that ended before the planning period (#8203). Nothing
 * switches the source on a phase change, because old and new phase run side
 * by side for a while; the note names the old offering and offers the new
 * one. Readers without planning rights only see it.
 */
export function ExpiredSourceHint({
  expired,
  connection,
  onConnect,
  busy = false,
  className,
}: Readonly<{
  expired: readonly ExpiredRosterSource[];
  /** The connection the dialog starts from, successors preselected. */
  connection: RosterDeviation;
  onConnect?: (connection: RosterDeviation) => void;
  busy?: boolean;
  className?: string;
}>) {
  const names = expired.map((offering) => offering.name);
  const successors = connection.offerings.map((offering) => offering.name);
  const sentences = [
    names.length === 1
      ? `${quoted(names)} gehört zu einer Anmeldephase, die vorbei ist.`
      : `${quoted(names)} gehören zu einer Anmeldephase, die vorbei ist.`,
    "Neue Anmeldungen kommen hier nicht mehr an.",
    successors.length > 0
      ? `Passend ist ${quoted(successors)} aus der aktuellen Phase.`
      : "Wähle beim Verbinden das neue Angebot aus.",
  ];
  return (
    <Alert
      type="warning"
      // A note in a list, not an event: it must not interrupt screen readers.
      announce="off"
      title="Angebot aus abgelaufener Phase"
      message={sentences.join(" ")}
      action={
        onConnect ? (
          <Button
            type="button"
            variant="surface"
            size="compact"
            onClick={() => onConnect(connection)}
            disabled={busy}
            tooltip="Öffnet ein Fenster, um die Kinder aus dem neuen Angebot zu holen."
          >
            Mit neuem Angebot verbinden
          </Button>
        ) : undefined
      }
      actionLayout="stacked"
      className={className}
    />
  );
}
