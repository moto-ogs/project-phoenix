"use client";

// Der Knopf „Schul-App öffnen“ (#4654, #7416): ein Bauteil für die Liste der
// Schulen, das Dashboard, die Auffälligkeiten und die Ansicht einer Schule.
// Den Ladezustand zeigt der Kit-Knopf (`isLoading`/`loadingText`), damit jede
// Stelle beim Öffnen dasselbe sagt.

import type { MouseEvent } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "~/components/ui/button";
import { SpinnerIcon } from "~/components/ui/icons";
import {
  TRAEGER_HANDOFF_OPEN,
  TRAEGER_HANDOFF_OPEN_HINT,
} from "~/lib/traeger-handoff";

/** What the button says while the school opens. */
const OPENING_TEXT = "Wird geöffnet …";

interface TraegerOpenSchoolButtonProps {
  readonly school: { readonly id: string; readonly name: string };
  /** The school that is opening right now, from `useOpenTraegerSchool`. */
  readonly opening: string | null;
  readonly onOpen: () => void;
  /**
   * `md` in a page head, `compact` in a table row or list, `icon` where a
   * table has no room for the words; the icon keeps its full name for screen
   * readers and as a tooltip.
   */
  readonly size?: "md" | "compact" | "icon";
  /**
   * In a clickable row the click opens the school app, not the row's
   * target.
   */
  readonly stopPropagation?: boolean;
  readonly className?: string;
}

/** „Schul-App öffnen“ for one school, opening it in a new tab. */
export function TraegerOpenSchoolButton({
  school,
  opening,
  onOpen,
  size = "compact",
  stopPropagation = false,
  className,
}: TraegerOpenSchoolButtonProps) {
  const isOpening = opening === school.id;
  const icon = size === "icon";
  return (
    <Button
      type="button"
      variant="surface"
      size={size}
      className={className}
      aria-label={`${TRAEGER_HANDOFF_OPEN}: ${school.name}, neuer Tab`}
      tooltip={TRAEGER_HANDOFF_OPEN_HINT}
      // An icon has no room for the words: it turns into the spinner and
      // stays locked like the others.
      isLoading={isOpening && !icon}
      loadingText={OPENING_TEXT}
      disabled={opening !== null}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (stopPropagation) event.stopPropagation();
        onOpen();
      }}
    >
      {icon ? (
        isOpening ? (
          <SpinnerIcon />
        ) : (
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        )
      ) : (
        <>
          {TRAEGER_HANDOFF_OPEN}
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </>
      )}
    </Button>
  );
}
