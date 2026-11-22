"use client";

// Kinder eines Monatslaufs, die moto über den Namen zusammenlegt (ADR 0158,
// Nachtrag Schulwechsel, #7874): Ein Kind wechselt die Schule und hat an
// jeder Schule eine eigene Kinderakte. Gleiche Familie, gleicher Name und
// gleiches Geburtsdatum bei Verträgen, die nacheinander laufen, machen sie
// zu einem Kind. Die Karte zeigt dem Büro, wo der Name entschieden hat und
// keine Kinderakte.

import { ChevronDown, ChevronUp, Users } from "lucide-react";
import { useState } from "react";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
  ResponsiveRowActions,
} from "~/components/ui/responsive-action-list";
import { Button, ButtonLink } from "~/components/ui/button";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import type { CareJoinedChild } from "~/lib/traeger-care-billing-api";
import { traegerPath } from "~/lib/traeger-url";

/** Rows shown before „N weitere anzeigen“. */
const INITIAL_ROWS = 5;

const DESCRIPTION =
  "Diese Kinder haben die Schule gewechselt und an jeder Schule eine eigene Kinderakte. Name, Geburtstag und Familie sind gleich. moto rechnet jedes Kind darum nur einmal ab. Sind es doch zwei Kinder, gib den Lauf nicht frei und schreib dem moto-Support.";

export function CareJoinedChildrenCard({
  childrenJoined,
}: Readonly<{
  /** The children of the run joined by their name across schools. */
  childrenJoined: readonly CareJoinedChild[];
}>) {
  const [expanded, setExpanded] = useState(false);
  if (childrenJoined.length === 0) return null;
  const count = childrenJoined.length;
  const shown = expanded
    ? childrenJoined
    : childrenJoined.slice(0, INITIAL_ROWS);
  return (
    <SectionCard
      title="Ein Kind an zwei Schulen"
      titleBadge={
        <StatusBadge
          tone="gray"
          label={count === 1 ? "1 Kind" : `${count} Kinder`}
        />
      }
      description={DESCRIPTION}
      leading={
        <Users
          className="mt-0.5 size-5 shrink-0 text-gray-500"
          aria-hidden="true"
        />
      }
    >
      <ResponsiveActionList>
        {shown.map((joined) => {
          const child =
            `${joined.childFirstName} ${joined.childLastName}`.trim();
          const key = joined.contracts.map((c) => c.contractId).join("-");
          return (
            <ResponsiveActionRow key={key}>
              <div className="min-w-0">
                <p className="text-sm font-semibold wrap-anywhere text-gray-900">
                  {child}
                </p>
                <p className="mt-0.5 text-sm wrap-anywhere text-gray-600">
                  {joined.contracts
                    .map((contract) => contract.schoolName)
                    .join(", dann ")}
                </p>
              </div>
              <ResponsiveRowActions>
                {joined.contracts.map((contract, index) => {
                  const label = `Vertrag ${index + 1}`;
                  return (
                    <ButtonLink
                      key={contract.contractId}
                      href={traegerPath(
                        `/traeger/vertraege/${contract.contractId}`,
                      )}
                      variant="surface"
                      size="compact"
                      aria-label={`${label} von ${child} öffnen: ${contract.schoolName}`}
                      tooltip="Öffnet diesen Vertrag des Kindes."
                    >
                      {label} · {contract.schoolName}
                    </ButtonLink>
                  );
                })}
              </ResponsiveRowActions>
            </ResponsiveActionRow>
          );
        })}
      </ResponsiveActionList>
      {count > INITIAL_ROWS ? (
        <Button
          type="button"
          variant="ghost"
          size="compact"
          className="mt-3"
          aria-expanded={expanded}
          tooltip={
            expanded
              ? "Zeigt wieder nur die ersten Kinder der Liste."
              : "Zeigt alle Kinder, die moto als ein Kind abrechnet."
          }
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? (
            <>
              <ChevronUp className="size-4" aria-hidden="true" />
              Weniger anzeigen
            </>
          ) : (
            <>
              <ChevronDown className="size-4" aria-hidden="true" />
              {count - INITIAL_ROWS} weitere anzeigen
            </>
          )}
        </Button>
      ) : null}
    </SectionCard>
  );
}
