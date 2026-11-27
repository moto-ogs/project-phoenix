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
  invoice: "gray",
  fee_notice: "gray",
  confirmation: "gray",
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
 * How a document refers to another one: „zu“ beside a Storno or a
 * Gutschrift, „ersetzt“ beside an invoice issued again.
 */
export function journalReferenceWord(reference: JournalReference): string {
  return labelOf(REFERENCE_LABELS, reference.kind, "zu");
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

/**
 * The runs as the filter names them. Two runs of one period, month or year
 * share a name; their issue day tells them apart, and the run number does
 * where even that is the same.
 */
export function journalRunChoiceLabels(
  runs: readonly JournalRun[],
): readonly string[] {
  const count = (labels: readonly string[], label: string) =>
    labels.filter((other) => other === label).length;
  const names = runs.map(journalRunLabel);
  const dated = runs.map((run, i) => {
    const name = names[i] ?? "";
    return count(names, name) > 1 && run.issuedOn
      ? `${name}, ausgestellt am ${formatDate(run.issuedOn)}`
      : name;
  });
  return runs.map((run, i) => {
    const label = dated[i] ?? "";
    return count(dated, label) > 1 ? `${label} (Lauf ${run.id})` : label;
  });
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

/**
 * A gap in words and figures. `first` and `last` are the missing numbers as
 * documents would carry them („FE-2026-0005“), or the running numbers when
 * the range does not let them be written. The missing numbers lead; the
 * documents beside the gap follow in brackets, by number and not by „the
 * last document“: the list shows the newest number first.
 */
export interface JournalGapWording {
  /** „Es fehlen die Nummern“, „Es fehlt die laufende Nummer“. */
  readonly lead: string;
  readonly first: string;
  /** „und“ or „bis“ before `last`; empty for one number. */
  readonly joint: "" | "und" | "bis";
  readonly last: string;
  /** „nach“, „vor“ or „zwischen“. */
  readonly place: string;
  /** The documents beside the gap: one, or two joined by „und“. */
  readonly anchors: readonly string[];
}

/** „Es fehlen die Nummern FE-0005 und FE-0006 (nach FE-0004).“ in parts. */
export function journalGapWording(gap: JournalNumberGap): JournalGapWording {
  const written = gap.firstMissingNumber !== "";
  const one = gap.missingCount === 1;
  const kind = written ? "" : one ? "laufende " : "laufenden ";
  let place = "zwischen";
  let anchors = [gap.afterNumber, gap.beforeNumber];
  if (gap.beforeNumber === "") {
    place = "nach";
    anchors = [gap.afterNumber];
  } else if (gap.afterNumber === "") {
    place = "vor";
    anchors = [gap.beforeNumber];
  }
  return {
    lead: one ? `Es fehlt die ${kind}Nummer` : `Es fehlen die ${kind}Nummern`,
    first: written ? gap.firstMissingNumber : String(gap.firstMissing),
    joint: one ? "" : gap.missingCount === 2 ? "und" : "bis",
    last: one
      ? ""
      : written
        ? gap.lastMissingNumber
        : String(gap.firstMissing + gap.missingCount - 1),
    place,
    anchors,
  };
}

/** The wording of a gap as one sentence. */
export function journalGapText(gap: JournalNumberGap): string {
  const { lead, first, joint, last, place, anchors } = journalGapWording(gap);
  const numbers = joint ? `${first} ${joint} ${last}` : first;
  return `${lead} ${numbers} (${place} ${anchors.join(" und ")}).`;
}

/** „2 Nummern fehlen“, „1 Nummer fehlt“. */
export function journalMissingCountLabel(count: number): string {
  return count === 1 ? "1 Nummer fehlt" : `${count} Nummern fehlen`;
}

/**
 * The key of a document as a gap names it: the document after the gap, or
 * the last document of a range whose counter went on.
 */
export function journalGapAnchor(
  issuerKey: string,
  service: JournalService | undefined,
  year: number,
  number: string,
): string {
  return `${issuerKey}|${service ?? ""}|${year}|${number}`;
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
