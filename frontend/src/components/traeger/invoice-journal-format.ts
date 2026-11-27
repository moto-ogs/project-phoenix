/** Display helpers of the Rechnungsausgangsbuch (#4819). */

import type { StatusBadgeTone } from "~/components/ui/status-badge";
import { formatDate } from "~/lib/date-helpers";
import type {
  JournalDocumentType,
  JournalIssuer,
  JournalNumberGap,
  JournalNumberRange,
  JournalRangeFilter,
  JournalReference,
  JournalRun,
  JournalRunFilter,
  JournalService,
} from "~/lib/traeger-invoice-journal-api";
import { labelOf } from "~/lib/label-of";
import { traegerPath } from "~/lib/traeger-url";
import { formatMonth } from "./care-billing-format";

/** The document types as the runs and letters name them. */
export const JOURNAL_DOCUMENT_TYPE_LABELS: Readonly<
  Record<JournalDocumentType, string>
> = {
  invoice: "Rechnung",
  fee_notice: "Gebührenbescheid",
  confirmation: "Bestätigung und Rechnung",
  cancellation: "Storno",
  credit: "Gutschrift",
};

/** The order of the document types in the filter. */
export const JOURNAL_DOCUMENT_TYPES: readonly JournalDocumentType[] = [
  "invoice",
  "fee_notice",
  "confirmation",
  "cancellation",
  "credit",
];

/**
 * A document that asks for money stays neutral; one that takes money back
 * carries the colour the families page gives it.
 */
export const JOURNAL_DOCUMENT_TYPE_TONES: Readonly<
  Record<JournalDocumentType, StatusBadgeTone>
> = {
  invoice: "outline",
  fee_notice: "outline",
  confirmation: "outline",
  cancellation: "red",
  credit: "blue",
};

/** The number ranges as the Abrechnungsvorgaben name them. */
const JOURNAL_SERVICE_LABELS: Readonly<Record<JournalService, string>> = {
  holiday: "Ferienbetreuung",
  care: "Monatsbeiträge",
};

const REFERENCE_LABELS: Readonly<
  Record<NonNullable<JournalReference["kind"]>, string>
> = {
  cancels: "zu",
  credits: "zu",
  replaces: "ersetzt",
  amends: "ändert",
};

/** The Träger issues under its own name; a body under the name it stored. */
export function journalIssuerLabel(issuer: JournalIssuer): string {
  return issuer.key === "" ? "Träger" : issuer.name || issuer.key;
}

/**
 * „zu FE-0001“ beside a Storno or a Gutschrift, „ersetzt FE-0001“ beside an
 * invoice issued again; empty without a reference.
 */
export function journalReferenceLabel(
  reference: JournalReference | null,
): string {
  if (!reference) return "";
  return `${labelOf(REFERENCE_LABELS, reference.kind, "zu")} ${reference.number}`;
}

/** A run as the lists of the runs name it. */
export function journalRunLabel(run: JournalRun): string {
  switch (run.kind) {
    case "care":
      return run.month
        ? `Monatsbeiträge ${formatMonth(run.month)}`
        : "Monatsbeiträge";
    case "care_notice":
      return `Jahresbescheide ${run.year}`;
    default:
      return run.name || "Lauf";
  }
}

/** The page of a run; null for a kind of run this build does not know. */
export function journalRunHref(run: JournalRun): string | null {
  const id = encodeURIComponent(run.id);
  switch (run.kind) {
    case "holiday":
      return traegerPath(`/traeger/abrechnung/${id}`);
    case "care":
      return traegerPath(`/traeger/abrechnung/monatsbeitraege/${id}`);
    case "care_notice":
      return traegerPath(`/traeger/abrechnung/jahresbescheide/${id}`);
    default:
      return null;
  }
}

/**
 * „Ferienbetreuung 2026“; a range that counts through the years has no
 * year. `withIssuer` adds who issues, once the Träger has several issuers.
 */
export function journalRangeLabel(
  range: Pick<JournalNumberRange, "issuer" | "service" | "year">,
  withIssuer: boolean,
): string {
  const service = labelOf(
    JOURNAL_SERVICE_LABELS,
    range.service,
    "Nummernkreis",
  );
  const name = range.year > 0 ? `${service} ${range.year}` : service;
  return withIssuer ? `${name} · ${journalIssuerLabel(range.issuer)}` : name;
}

/** The value of a number range in a select; "" for none. */
export function journalRangeValue(range: JournalRangeFilter | null): string {
  return range ? `${range.service}|${range.year}|${range.issuerKey}` : "";
}

/** The number range a select value names among the ranges of the Träger. */
export function journalRangeOf(
  value: string,
  ranges: readonly JournalNumberRange[],
): JournalRangeFilter | null {
  for (const range of ranges) {
    if (!range.service) continue;
    const filter = {
      issuerKey: range.issuer.key,
      service: range.service,
      year: range.year,
    };
    if (journalRangeValue(filter) === value) return filter;
  }
  return null;
}

/** The value of a run in a select; "" for none. */
export function journalRunValue(run: JournalRunFilter | null): string {
  return run ? `${run.kind}|${run.id}` : "";
}

/** The run a select value names among the runs of the Träger. */
export function journalRunOf(
  value: string,
  runs: readonly JournalRun[],
): JournalRunFilter | null {
  for (const run of runs) {
    if (!run.kind) continue;
    const filter = { kind: run.kind, id: run.id };
    if (journalRunValue(filter) === value) return filter;
  }
  return null;
}

/** The issuers of the number ranges, the Träger first. */
export function journalIssuers(
  ranges: readonly JournalNumberRange[],
): readonly JournalIssuer[] {
  const byKey = new Map<string, JournalIssuer>();
  for (const range of ranges) {
    if (!byKey.has(range.issuer.key)) byKey.set(range.issuer.key, range.issuer);
  }
  return [...byKey.values()].sort((a, b) =>
    a.key === "" || b.key === ""
      ? Number(b.key === "") - Number(a.key === "")
      : journalIssuerLabel(a).localeCompare(journalIssuerLabel(b), "de"),
  );
}

/** „Es fehlen 2 Nummern zwischen FE-0004 und FE-0007.“ */
export function journalGapText(gap: JournalNumberGap): string {
  const count =
    gap.missingCount === 1
      ? "Es fehlt 1 Nummer"
      : `Es fehlen ${gap.missingCount} Nummern`;
  if (gap.afterNumber === "") return `${count} vor ${gap.beforeNumber}.`;
  if (gap.beforeNumber === "") return `${count} nach ${gap.afterNumber}.`;
  return `${count} zwischen ${gap.afterNumber} und ${gap.beforeNumber}.`;
}

/** „01.01.2026 bis 31.12.2026“, „ab 01.01.2026“ or „bis 31.12.2026“. */
export function journalPeriodLabel(from: string, to: string): string {
  if (from && to) {
    return from === to
      ? formatDate(from)
      : `${formatDate(from)} bis ${formatDate(to)}`;
  }
  if (from) return `ab ${formatDate(from)}`;
  return to ? `bis ${formatDate(to)}` : "";
}
