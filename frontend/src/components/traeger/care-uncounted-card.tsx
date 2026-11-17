"use client";

// Rechnungen eines Monatslaufs ohne bestätigte Kinderzahl der Familie
// (#7356): Zählt eine Geschwisterregel die Familienangabe, nennt die
// Prüfung jedes Kind, dessen Familie für den Monat keine bestätigte Zahl
// hat. Dort zählt die Regel nur die Kinder mit Vertrag. Das Büro bestätigt
// die Zahl unter „Kinderzahl“, bevor es den Lauf freigibt.

import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button, ButtonLink } from "~/components/ui/button";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
} from "~/components/ui/responsive-action-list";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import type { CareUncountedContract } from "~/lib/traeger-care-billing-api";
import { traegerPath } from "~/lib/traeger-url";
import { STATUS_LABELS, STATUS_TONES } from "./family-children-format";

/** Rows shown before „N weitere anzeigen“. */
const INITIAL_ROWS = 5;

function descriptionText(families: number): string {
  const who = families === 1 ? "Für 1 Familie" : `Für ${families} Familien`;
  return `${who} gibt es in diesem Monat keine bestätigte Kinderzahl. Die Geschwisterregel zählt dort nur die Kinder mit Vertrag. Bestätigen Sie die Zahl vor der Freigabe, dann rechnet moto den Lauf neu.`;
}

export function CareUncountedCard({
  families,
  contracts,
}: Readonly<{
  /** How many families have no confirmed number for the month. */
  families: number;
  /** Their invoices in the run. */
  contracts: readonly CareUncountedContract[];
}>) {
  const [expanded, setExpanded] = useState(false);
  if (families === 0) return null;
  const shown = expanded ? contracts : contracts.slice(0, INITIAL_ROWS);
  return (
    <SectionCard
      title="Kinderzahl der Familie fehlt"
      titleBadge={
        <StatusBadge
          tone="warning"
          label={`${families} ${families === 1 ? "Familie" : "Familien"} offen`}
        />
      }
      description={descriptionText(families)}
      leading={
        <TriangleAlert
          className="text-moto-orange-strong mt-0.5 size-5 shrink-0"
          aria-hidden="true"
        />
      }
      action={
        <ButtonLink
          href={traegerPath("/traeger/abrechnung/kinderzahl")}
          variant="surface"
          size="md"
          tooltip="Öffnet die Kinderzahl der Familien zum Bestätigen."
        >
          Kinderzahl prüfen
        </ButtonLink>
      }
    >
      {contracts.length > 0 ? (
        <ResponsiveActionList>
          {shown.map((contract) => (
            <ResponsiveActionRow key={contract.contractId}>
              <div className="min-w-0">
                <p className="text-sm font-semibold wrap-anywhere text-gray-900">
                  {`${contract.childFirstName} ${contract.childLastName}`.trim()}
                </p>
                <p className="mt-0.5 text-sm wrap-anywhere text-gray-600">
                  {contract.schoolName}
                </p>
              </div>
              <StatusBadge
                tone={STATUS_TONES[contract.status]}
                label={STATUS_LABELS[contract.status]}
              />
            </ResponsiveActionRow>
          ))}
        </ResponsiveActionList>
      ) : null}
      {contracts.length > INITIAL_ROWS ? (
        <Button
          type="button"
          variant="ghost"
          size="compact"
          className="mt-3"
          aria-expanded={expanded}
          tooltip={
            expanded
              ? "Zeigt wieder nur die ersten Kinder der Liste."
              : "Zeigt alle Kinder, deren Familie keine bestätigte Kinderzahl hat."
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
              {contracts.length - INITIAL_ROWS} weitere anzeigen
            </>
          )}
        </Button>
      ) : null}
    </SectionCard>
  );
}
