"use client";

// Kinder, die ein Lauf zurückhält, weil für den Monat schon eine Rechnung
// ausgestellt ist (ADR 0158, Nachtrag „Schon abgerechnet je Kind“, #7892).
// Zwei Fälle, je eine Karte, weil das Büro Verschiedenes tut:
// Ein anderer Vertrag des Kindes hat den Monat abgerechnet. Der Lauf stellt
// keine zweite Rechnung aus; stimmt die vorhandene, ist nichts zu tun.
// Oder die Rechnung des Vertrags enthält nur die Mensa und sperrt seine
// Betreuung. Die Betreuung ist dann nicht abgerechnet, und das Büro muss die
// Rechnung stornieren. Ein freigegebener Lauf zeigt, was seine Freigabe
// gespeichert hat. Im Jahreslauf kommt eine dritte Karte dazu (#7952): Einem
// Vertrag des Kindes fehlt ein Preis, sein bisheriger Bescheid gilt weiter und
// rechnet Tage ab, die ein anderer Vertrag neu festsetzen würde. Das Büro
// trägt den Preis ein.

import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
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
import { splitBilledChildren } from "./care-billed-children-format";

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

/** The month has an invoice already: check it, nothing to do if right. */
function billedText(
  children: readonly CareBilledChild[],
  released: boolean,
  yearly: boolean,
): string {
  const one = children.length === 1;
  const documents = children.flatMap((child) => child.invoices);
  const noticed = documents.some(
    (invoice) => invoice.source === "care_notice_run",
  );
  const invoiced = documents.some(
    (invoice) => invoice.source !== "care_notice_run",
  );
  const who = one ? "dieses Kind" : "diese Kinder";
  const found = yearly
    ? `Für ${who} ist ein Monat des Jahres schon abgerechnet.`
    : `Für ${who} ${released ? "war" : "ist"} der Monat schon abgerechnet.`;
  // A Jahreslauf keeps what an earlier notice set for the month (S11).
  const follows = yearly
    ? "Der Jahreslauf rechnet diesen Monat nicht noch einmal ab."
    : released
      ? "Der Lauf hat keine zweite Rechnung ausgestellt."
      : "Der Lauf stellt keine zweite Rechnung aus.";
  // An open run computes again when it opens, so it bills the child
  // itself once the document is cancelled; a released one needs a new run.
  const them = one ? "das Kind" : "die Kinder";
  const next = yearly
    ? "Danach nimmt diese Vorschau den Monat auf."
    : released
      ? `Danach rechnet ein neuer Monatslauf ${them} ab.`
      : `Danach rechnet dieser Lauf ${them} ab.`;
  return [
    found,
    follows,
    "Stimmt das, musst du nichts tun.",
    invoiced ? "Ist eine Rechnung falsch, storniere sie." : "",
    noticed
      ? "Ist ein Jahresbescheid falsch, ändere ihn mit einem neuen Jahreslauf."
      : "",
    next,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * A contract without a price keeps its notice for the whole month, also for
 * days another contract runs now: that one waits for the price (#7952).
 */
function unpricedNoticeText(children: readonly CareBilledChild[]): string {
  const one = children.length === 1;
  return [
    one
      ? "Für einen Vertrag dieses Kindes fehlt ein Preis."
      : "Für jedes dieser Kinder fehlt bei einem Vertrag der Preis.",
    one
      ? "Sein bisheriger Jahresbescheid gilt weiter, auch für Tage eines anderen Vertrags."
      : "Ihre bisherigen Jahresbescheide gelten weiter, auch für Tage anderer Verträge.",
    one
      ? "Damit dieser Lauf keinen Tag doppelt abrechnet, bekommt der andere Vertrag keinen neuen Bescheid."
      : "Damit dieser Lauf keinen Tag doppelt abrechnet, bekommen die anderen Verträge keinen neuen Bescheid.",
    "Trage den Preis in der Preisliste ein, dann rechnet diese Vorschau neu.",
  ].join(" ");
}

/** The invoice carries only the Mensa: the care is open until its Storno. */
function mealOnlyText(
  children: readonly CareBilledChild[],
  released: boolean,
  yearly: boolean,
): string {
  const one = children.length === 1;
  // A Storno can bring an older invoice to light that still holds the
  // child, so no text promises the invoice (ADR 0158, S5).
  const them = one ? "das Kind" : "die Kinder";
  const next = yearly
    ? "Danach rechnet diese Vorschau den Monat neu und zeigt, was noch offen ist."
    : released
      ? `Danach rechnet ein neuer Monatslauf ${them} neu und zeigt, was noch offen ist.`
      : `Danach rechnet dieser Lauf ${them} neu und zeigt, was noch offen ist.`;
  return [
    one
      ? "Die Rechnung dieses Kindes enthält nur die Mensa."
      : "Die Rechnungen dieser Kinder enthalten nur die Mensa.",
    "Die Betreuung ist noch nicht abgerechnet.",
    one ? "Storniere die Rechnung." : "Storniere die Rechnungen.",
    next,
  ].join(" ");
}

/**
 * The children a run holds back for an issued invoice: one card for those
 * whose month is billed already, one in a Jahreslauf for those whose contract
 * without a price keeps its notice, one for those whose invoice carries only
 * the Mensa.
 */
export function CareBilledChildrenCard({
  childrenBilled,
  released = false,
  yearly = false,
}: Readonly<{
  /** The children the run holds back for an issued invoice. */
  childrenBilled: readonly CareBilledChild[];
  /** A released monthly run: it shows what its release stored. */
  released?: boolean;
  /** A run of Jahresbescheide: it keeps the month as it was assessed. */
  yearly?: boolean;
}>) {
  const { billed, mealOnly, unpricedNotice } =
    splitBilledChildren(childrenBilled);
  return (
    <>
      <BilledCard
        childrenBilled={billed}
        title={
          released
            ? "Nicht abgerechnet – Kind hatte schon eine Rechnung"
            : "Kind hat schon eine Rechnung – bitte prüfen"
        }
        description={billedText(billed, released, yearly)}
      />
      <BilledCard
        childrenBilled={unpricedNotice}
        kind="unpricedNotice"
        title="Preis fehlt – Kind bekommt keinen neuen Bescheid"
        description={unpricedNoticeText(unpricedNotice)}
        action={
          <ButtonLink
            href={traegerPath("/traeger/abrechnung/preise")}
            variant="surface"
            tooltip="Öffnet die Preisliste, dort trägst du die Preise ein."
          >
            Preisliste öffnen
          </ButtonLink>
        }
      />
      <BilledCard
        childrenBilled={mealOnly}
        kind="mealOnly"
        title="Betreuung noch nicht abgerechnet – Rechnung nur mit Mensa"
        description={mealOnlyText(mealOnly, released, yearly)}
      />
    </>
  );
}

/** Why the children of a card are held, and so what the office does. */
type BilledCardKind = "billed" | "mealOnly" | "unpricedNotice";

/** What the button of a document in the way opens. */
function documentTooltip(
  kind: BilledCardKind,
  invoice: CareBilledInvoice,
): string {
  if (kind === "mealOnly") {
    return "Öffnet die Rechnung, die nur die Mensa enthält.";
  }
  if (kind === "unpricedNotice") {
    return "Öffnet den Jahresbescheid, der weiter gilt.";
  }
  return invoice.source === "care_notice_run"
    ? "Öffnet den Jahresbescheid, der den Monat schon abrechnet."
    : "Öffnet die Rechnung, die den Monat schon abrechnet.";
}

function BilledCard({
  childrenBilled,
  title,
  description,
  kind = "billed",
  action,
}: Readonly<{
  childrenBilled: readonly CareBilledChild[];
  title: string;
  description: string;
  kind?: BilledCardKind;
  /** The one step the card leads to, in its head. */
  action?: ReactNode;
}>) {
  const [expanded, setExpanded] = useState(false);
  if (childrenBilled.length === 0) return null;
  const count = childrenBilled.length;
  const shown = expanded
    ? childrenBilled
    : childrenBilled.slice(0, INITIAL_ROWS);
  return (
    <SectionCard
      title={title}
      titleBadge={
        <StatusBadge
          tone="warning"
          label={count === 1 ? "1 Kind" : `${count} Kinder`}
        />
      }
      description={description}
      action={action}
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
                      aria-label={`${label} öffnen: ${invoice.number}, ${child}`}
                      tooltip={documentTooltip(kind, invoice)}
                    >
                      {label} öffnen
                    </ButtonLink>
                  );
                })}
                {/* The contract whose price is missing: the notice is its own. */}
                {kind === "unpricedNotice"
                  ? billed.invoices.map((invoice) =>
                      invoice.contractId ? (
                        <ButtonLink
                          key={`unpriced-${invoice.contractId}`}
                          href={traegerPath(
                            `/traeger/vertraege/${invoice.contractId}`,
                          )}
                          variant="surface"
                          size="compact"
                          aria-label={`Vertrag ohne Preis · ${invoice.schoolName}: ${child}`}
                          tooltip="Öffnet den Vertrag, für den ein Preis fehlt."
                        >
                          Vertrag ohne Preis · {invoice.schoolName}
                        </ButtonLink>
                      ) : null,
                    )
                  : null}
                {billed.contracts.map((contract, index) => {
                  // Next to „Vertrag ohne Preis“ the held one is the other
                  // contract the card text names.
                  const noun =
                    kind === "unpricedNotice" ? "Anderer Vertrag" : "Vertrag";
                  const label =
                    billed.contracts.length === 1
                      ? noun
                      : `${noun} ${index + 1}`;
                  return (
                    <ButtonLink
                      key={contract.contractId}
                      href={traegerPath(
                        `/traeger/vertraege/${contract.contractId}`,
                      )}
                      variant="surface"
                      size="compact"
                      aria-label={`${label} · ${contract.schoolName}: ${child}`}
                      tooltip={
                        kind === "unpricedNotice"
                          ? "Öffnet den Vertrag, der noch keinen neuen Bescheid bekommt."
                          : "Öffnet den Vertrag, für den der Lauf keine Rechnung ausstellt."
                      }
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
              : "Zeigt alle Kinder dieser Liste."
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
