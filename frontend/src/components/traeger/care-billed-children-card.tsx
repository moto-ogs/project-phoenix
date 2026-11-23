"use client";

// Kinder, die ein Lauf zurückhält, weil für den Monat schon eine Rechnung
// ausgestellt ist (ADR 0158, Nachtrag „Schon abgerechnet je Kind“, #7892):
// Ein anderer Vertrag des Kindes hat den Monat abgerechnet, oder die
// Rechnung des Vertrags enthält nur die Mensa und sperrt seine Betreuung.
// Der Lauf stellt für das Kind keine weitere Rechnung aus. Die Karte nennt
// die vorhandene Rechnung, damit das Büro sie prüft und, wenn sie falsch
// ist, storniert. Ein freigegebener Lauf zeigt, was seine Freigabe
// gespeichert hat.

import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { useState } from "react";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
  ResponsiveRowActions,
} from "~/components/ui/responsive-action-list";
import { Button, ButtonLink } from "~/components/ui/button";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import type {
  CareBilledChild,
  CareBilledInvoice,
} from "~/lib/traeger-care-billing-api";
import { traegerPath } from "~/lib/traeger-url";

/** Rows shown before „N weitere anzeigen“. */
const INITIAL_ROWS = 5;

/** „Rechnung“, „Bescheid“ (a monthly invoice issued as one) or „Jahresbescheid“. */
function documentLabel(invoice: CareBilledInvoice): string {
  if (invoice.source === "care_notice_run") return "Jahresbescheid";
  return invoice.documentKind === "fee_notice" ? "Bescheid" : "Rechnung";
}

/** „Rechnung MB-2027-0007 · OGS Ispringen“. */
function documentText(invoice: CareBilledInvoice): string {
  return [
    `${documentLabel(invoice)} ${invoice.number}`.trim(),
    invoice.schoolName,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Where the office opens the document; undefined without its run. */
function documentHref(invoice: CareBilledInvoice): string | undefined {
  if (!invoice.runId || !invoice.contractId) return undefined;
  return invoice.source === "care_notice_run"
    ? `/traeger/abrechnung/jahresbescheide/${invoice.runId}/bescheid/${invoice.contractId}`
    : `/traeger/abrechnung/monatsbeitraege/${invoice.runId}/rechnung/${invoice.contractId}`;
}

function descriptionText(
  children: readonly CareBilledChild[],
  released: boolean,
  yearly: boolean,
): string {
  const noticed = children.some((child) =>
    child.invoices.some((invoice) => invoice.source === "care_notice_run"),
  );
  const found = yearly
    ? "Für diese Kinder gibt es in einem Monat des Jahres schon eine Rechnung."
    : released
      ? "Für diese Kinder gab es in diesem Monat schon eine Rechnung."
      : "Für diese Kinder gibt es in diesem Monat schon eine Rechnung.";
  const follows = yearly
    ? "Der Jahreslauf nimmt diesen Monat nicht in ihren Bescheid."
    : released
      ? "Der Lauf hat für sie keine weitere ausgestellt."
      : "Der Lauf stellt für sie keine weitere aus.";
  const next = yearly
    ? "Danach nimmt ein neuer Jahreslauf den Monat auf."
    : "Danach rechnet ein neuer Monatslauf das Kind ab.";
  return [
    found,
    follows,
    "Stimmt die Rechnung, musst du nichts tun.",
    "Ist sie falsch, storniere sie.",
    next,
    noticed
      ? "Einen Jahresbescheid änderst du mit einem neuen Jahreslauf."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function CareBilledChildrenCard({
  childrenBilled,
  released = false,
  yearly = false,
}: Readonly<{
  /** The children the run holds back for an issued invoice. */
  childrenBilled: readonly CareBilledChild[];
  /** A released monthly run: it shows what its release stored. */
  released?: boolean;
  /** A run of Jahresbescheide: it leaves the month out of the notice. */
  yearly?: boolean;
}>) {
  const [expanded, setExpanded] = useState(false);
  if (childrenBilled.length === 0) return null;
  const count = childrenBilled.length;
  const shown = expanded
    ? childrenBilled
    : childrenBilled.slice(0, INITIAL_ROWS);
  return (
    <SectionCard
      title={
        released
          ? "Nicht abgerechnet – Kind hatte schon eine Rechnung"
          : "Kind hat schon eine Rechnung – bitte prüfen"
      }
      titleBadge={
        <StatusBadge
          tone="warning"
          label={count === 1 ? "1 Kind" : `${count} Kinder`}
        />
      }
      description={descriptionText(childrenBilled, released, yearly)}
      leading={
        <TriangleAlert
          className="text-moto-orange-strong mt-0.5 size-5 shrink-0"
          aria-hidden="true"
        />
      }
    >
      <ResponsiveActionList>
        {shown.map((billed) => {
          const child =
            `${billed.childFirstName} ${billed.childLastName}`.trim();
          const key = billed.contracts.map((c) => c.contractId).join("-");
          return (
            <ResponsiveActionRow key={`${billed.reason ?? ""}-${key}`}>
              <div className="min-w-0">
                <p className="text-sm font-semibold wrap-anywhere text-gray-900">
                  {child}
                </p>
                <p className="mt-0.5 text-sm wrap-anywhere text-gray-600">
                  {billed.invoices.map(documentText).join(", ")}
                  {billed.reason === "meal_only_invoice"
                    ? " · nur Mensa, die Betreuung fehlt"
                    : ""}
                </p>
              </div>
              <ResponsiveRowActions>
                {billed.invoices.map((invoice) => {
                  const href = documentHref(invoice);
                  if (!href) return null;
                  const label = documentLabel(invoice);
                  return (
                    <ButtonLink
                      key={`${invoice.source ?? ""}-${invoice.contractId}`}
                      href={traegerPath(href)}
                      variant="surface"
                      size="compact"
                      aria-label={`${label} ${invoice.number} von ${child} öffnen`}
                      tooltip={
                        invoice.source === "care_notice_run"
                          ? "Öffnet den Jahresbescheid, der den Monat schon abrechnet."
                          : "Öffnet die Rechnung, die den Monat schon abrechnet."
                      }
                    >
                      {label} öffnen
                    </ButtonLink>
                  );
                })}
                {billed.contracts.map((contract, index) => {
                  const label =
                    billed.contracts.length === 1
                      ? "Vertrag"
                      : `Vertrag ${index + 1}`;
                  return (
                    <ButtonLink
                      key={contract.contractId}
                      href={traegerPath(
                        `/traeger/vertraege/${contract.contractId}`,
                      )}
                      variant="surface"
                      size="compact"
                      aria-label={`${label} von ${child} öffnen: ${contract.schoolName}`}
                      tooltip="Öffnet den Vertrag, für den der Lauf keine Rechnung ausstellt."
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
              : "Zeigt alle Kinder, die schon eine Rechnung haben."
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
