"use client";

// Die Versionen eines Betreuungsvertrags (#4681). Gibt die Schule eine
// Änderung der Betreuung frei, die Eltern beantragt haben, bekommt der
// Vertrag eine neue Version mit Wirkdatum. Ältere Versionen bleiben lesbar,
// jede mit ihrem PDF. Eine Änderung, die die Eltern nicht selbst beantragt
// haben, wartet als eigene Version auf ihre Unterschrift (#4816). Die Liste folgt dem Muster „mehrere Einträge mit
// Aktionen“ des UI-Kits: eine Karte, weiße Zeilen, eine bündige Spalte mit
// gleichrangigen Knöpfen.

import { Download } from "lucide-react";
import { useState } from "react";
import {
  formatService,
  serviceDays,
} from "~/components/traeger/care-contract-format";
import { Button } from "~/components/ui/button";
import { DataField, DataGrid } from "~/components/ui/data-field";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
  ResponsiveRowActions,
} from "~/components/ui/responsive-action-list";
import { SectionCard } from "~/components/ui/section-card";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "~/components/ui/status-badge";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { formatBerlinDate, formatDate } from "~/lib/date-helpers";
import { downloadBlob } from "~/lib/file-download";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { createLogger } from "~/lib/logger";
import {
  type ContractService,
  type ContractVersion,
  type ContractVersionSignature,
  downloadCareContractVersion,
  type Weekday,
} from "~/lib/traeger-care-contracts-api";
import { changeHistoryConcept } from "~/lib/concepts/changeHistory";
import { CONTRACT_VERSIONS_SECTION_ID } from "./care-contract-detail-tabs";
import { labelOf } from "~/lib/label-of";

const logger = createLogger({ component: "CareContractVersions" });

/** Woher eine Version kommt, in einem Wort für die Liste. */
const VERSION_SOURCE_LABELS: Record<
  NonNullable<ContractVersion["source"]>,
  string
> = {
  abschluss: "Vertragsabschluss",
  buchungsaenderung: "Änderung der Betreuung",
  import: "Aus einer Datei importiert",
  angebotskorrektur: "Module neu zugeordnet",
};

/** Where a version stands on a day, for its badge. */
export type VersionPhase =
  | "current"
  | "planned"
  | "past"
  | "pending"
  | "awaiting"
  | "overtaken"
  | "rejected"
  | "replaced"
  | "ended"
  | "withdrawn";

/** How the contract itself ended (#4682); it cuts every version. */
export type ContractEnd = Readonly<{
  withdrawn: boolean;
  /** Last day of a terminated contract ("YYYY-MM-DD"). */
  endsOn: string | null;
}>;

const PHASE_TONES: Record<VersionPhase, StatusBadgeTone> = {
  current: "green",
  planned: "blue",
  past: "outline",
  pending: "gray",
  awaiting: "warning",
  overtaken: "outline",
  rejected: "red",
  replaced: "outline",
  ended: "outline",
  withdrawn: "red",
};

/** The phase of a version on the Berlin day `today` ("YYYY-MM-DD"). */
export function versionPhase(
  version: ContractVersion,
  today: string,
  end?: ContractEnd,
): VersionPhase {
  // A changed version waits for the parents' signature (#4816); the first
  // version of a draft or sent contract is simply not in force yet.
  if (version.status === "beantragt") {
    return version.number > 1 ? "awaiting" : "pending";
  }
  // Nobody signed it: a newer version overtook it, or its change was taken
  // back. It holds on no day.
  if (version.status === "ueberholt") return "overtaken";
  if (version.status === "abgelehnt") return "rejected";
  // Replaced by a change on its own first day: it holds on no day.
  if (version.status === "ersetzt") return "replaced";
  // A withdrawal undoes the contract from its first day, so no version
  // held; a termination ends every version on its last day. The versions
  // read from the contract are already cut at that day, so the last one
  // runs until it, and only an earlier version was replaced.
  if (end?.withdrawn) return "withdrawn";
  if (
    end?.endsOn &&
    (version.effectiveFrom > end.endsOn ||
      (end.endsOn < today &&
        (version.validUntil === null || version.validUntil >= end.endsOn)))
  ) {
    return "ended";
  }
  if (version.effectiveFrom > today) return "planned";
  if (version.validUntil !== null && version.validUntil < today) return "past";
  return "current";
}

function phaseLabel(version: ContractVersion, phase: VersionPhase): string {
  switch (phase) {
    case "current":
      return "Gilt jetzt";
    case "planned":
      return `Gilt ab ${formatDate(version.effectiveFrom)}`;
    case "past":
      return "Abgelöst";
    case "pending":
      return "Noch nicht wirksam";
    case "awaiting":
      return "Wartet auf Unterschrift";
    case "overtaken":
      return "Überholt";
    case "rejected":
      return "Abgelehnt";
    case "replaced":
      return "Ersetzt";
    case "ended":
      return "Vertrag beendet";
    case "withdrawn":
      return "Widerrufen";
  }
}

/** „01.03.2027 bis 31.07.2027“, or „ab 01.03.2027“ while it holds on. */
function formatValidity(version: ContractVersion): string {
  if (version.status === "ersetzt") {
    return `ab ${formatDate(version.effectiveFrom)} vorgesehen, gilt an keinem Tag`;
  }
  if (version.status === "ueberholt") {
    return `ab ${formatDate(version.effectiveFrom)} vorgesehen, nie unterschrieben`;
  }
  if (version.status === "beantragt" && version.number > 1) {
    return `ab ${formatDate(version.effectiveFrom)}, sobald die Eltern unterschrieben haben`;
  }
  const until = version.validUntil ?? version.endsOn;
  return until
    ? `${formatDate(version.effectiveFrom)} bis ${formatDate(until)}`
    : `ab ${formatDate(version.effectiveFrom)}`;
}

function dayText(services: readonly ContractService[]): string {
  return services.map((service) => formatService(service)).join(", ");
}

/**
 * The weekdays whose booked care differs from the previous version: another
 * module, another end time, or care added or dropped.
 */
export function changedWeekdays(
  version: ContractVersion,
  previous: ContractVersion | undefined,
): Set<Weekday> {
  const changed = new Set<Weekday>();
  if (!previous) return changed;
  const key = (services: readonly ContractService[], weekday: Weekday) =>
    services
      .filter((service) => service.weekday === weekday)
      .map((service) => `${service.careOfferingId}|${service.endsAt}`)
      .sort()
      .join(",");
  // Every weekday of both versions, so care dropped on a weekend counts too.
  const weekdays = new Set<Weekday>(
    [...version.services, ...previous.services].map((s) => s.weekday),
  );
  for (const weekday of weekdays) {
    if (key(version.services, weekday) !== key(previous.services, weekday)) {
      changed.add(weekday);
    }
  }
  return changed;
}

/**
 * The next planned change of the care, if any: the earliest version from a
 * change that is not yet in force, from an approved change of the care or
 * from a new assignment of the modules (#7764). A contract that only starts
 * later is no change.
 */
export function plannedVersion(
  versions: readonly ContractVersion[],
  today: string,
): ContractVersion | undefined {
  return versions
    .filter(
      (version) =>
        (version.source === "buchungsaenderung" ||
          version.source === "angebotskorrektur") &&
        versionPhase(version, today) === "planned",
    )
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
}

/** The notice above a contract with a planned version, by its source. */
export function plannedVersionText(version: ContractVersion): string {
  const reason =
    version.source === "angebotskorrektur"
      ? "Die Buchungen gehören dann zu anderen Modulen."
      : "Eine Änderung der Betreuung ist freigegeben.";
  return `Ab ${formatDate(version.effectiveFrom)} gilt Version ${version.number}. ${reason} Was sich ändert, steht unter „Versionen“.`;
}

/** How the parents agreed to a version, in one line under its dates. */
export function signatureText(signature: ContractVersionSignature): string {
  const day = formatBerlinDate(signature.signedAt);
  switch (signature.method) {
    case "request":
      return `Von den Eltern selbst beantragt am ${day}. Der Antrag gilt als Unterschrift.`;
    case "paper":
      return `Auf Papier unterschrieben, erfasst am ${day}.`;
    default:
      return `Online unterschrieben am ${day} von ${signature.signerName}.`;
  }
}

const NO_SIGNATURES: readonly ContractVersionSignature[] = [];

/** Versions that never held on a day are no base to compare with. */
function heldOnADay(version: ContractVersion): boolean {
  return (
    version.status !== "ersetzt" &&
    version.status !== "ueberholt" &&
    version.status !== "beantragt"
  );
}

export function CareContractVersions({
  contractId,
  versions,
  signatures = NO_SIGNATURES,
  end,
}: Readonly<{
  contractId: string;
  versions: readonly ContractVersion[];
  /** How the parents agreed to each signed version (#4816). */
  signatures?: readonly ContractVersionSignature[];
  end?: ContractEnd;
}>) {
  const today = useBerlinToday();
  const actionError = useApiErrorDisplay();
  const [loading, setLoading] = useState<number | null>(null);

  const download = async (number: number) => {
    setLoading(number);
    try {
      const file = await downloadCareContractVersion(contractId, number);
      downloadBlob(file.blob, file.filename);
    } catch (err) {
      logger.error("traeger_care_contract_version_download_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void actionError.show(err, { object: `das PDF von Version ${number}` });
    } finally {
      setLoading(null);
    }
  };

  // Latest effective date first: the office looks for what changes next. A
  // change may go in front of a planned version, so the numbers need not
  // follow the dates (#4681).
  const ordered = [...versions].sort(
    (a, b) =>
      b.effectiveFrom.localeCompare(a.effectiveFrom) || b.number - a.number,
  );

  return (
    <SectionCard
      id={CONTRACT_VERSIONS_SECTION_ID}
      title="Versionen"
      concept={changeHistoryConcept}
      titleBadge={
        versions.length > 1 ? (
          <StatusBadge label={`${versions.length} Versionen`} tone="gray" />
        ) : null
      }
      description="Ändert sich die Betreuung oder ordnest du die Module neu zu, entsteht eine neue Version. Haben die Eltern die Änderung selbst beantragt, gilt sie sofort. Sonst wartet sie auf ihre Unterschrift. Frühere Versionen bleiben hier lesbar."
    >
      <ResponsiveActionList>
        {ordered.map((version, index) => {
          const phase = versionPhase(version, today, end);
          // Compared with the version that holds before it; a replaced
          // version held on no day.
          const changed = changedWeekdays(
            version,
            ordered.slice(index + 1).find(heldOnADay),
          );
          const signature = signatures.find(
            (entry) => entry.versionNumber === version.number,
          );
          return (
            <ResponsiveActionRow
              key={version.number}
              align="start"
              className="py-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Version {version.number}
                  </h3>
                  <StatusBadge
                    label={phaseLabel(version, phase)}
                    tone={PHASE_TONES[phase]}
                  />
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  {formatValidity(version)} ·{" "}
                  {labelOf(VERSION_SOURCE_LABELS, version.source, "–")}
                  {changed.size > 0
                    ? ` · ${changed.size === 1 ? "1 Tag" : `${changed.size} Tage`} geändert`
                    : null}
                </p>
                {signature ? (
                  <p className="mt-1 text-sm text-gray-600">
                    {signatureText(signature)}
                  </p>
                ) : null}
                {version.agreedFrom ? (
                  <p className="mt-1 text-sm text-gray-600">
                    Im Vertrag steht {formatDate(version.agreedFrom)}. Die
                    Eltern haben später unterschrieben. Deshalb gilt die Version
                    ab {formatDate(version.effectiveFrom)}.
                  </p>
                ) : null}
                {/* Every version lists its days, also the only one: the
                    card is the contract's history, read on its own. */}
                <div className="mt-3">
                  <DataGrid>
                    {serviceDays(version.services, [...changed]).map((day) => (
                      <DataField key={day.weekday} label={day.label}>
                        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                          {day.services.length === 0 ? (
                            <span className="font-normal text-gray-500">
                              Keine Betreuung
                            </span>
                          ) : (
                            <span>{dayText(day.services)}</span>
                          )}
                          {changed.has(day.weekday) ? (
                            <StatusBadge
                              label="Geändert"
                              tone="orange"
                              size="xs"
                            />
                          ) : null}
                        </span>
                      </DataField>
                    ))}
                  </DataGrid>
                </div>
              </div>
              <ResponsiveRowActions>
                <Button
                  type="button"
                  variant="surface"
                  size="compact"
                  aria-label={`PDF von Version ${version.number} herunterladen`}
                  disabled={loading !== null}
                  isLoading={loading === version.number}
                  loadingText="Wird geladen …"
                  tooltip="Lädt den Vertrag in dieser Version als PDF herunter."
                  onClick={() => void download(version.number)}
                >
                  <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  PDF
                </Button>
              </ResponsiveRowActions>
            </ResponsiveActionRow>
          );
        })}
      </ResponsiveActionList>
    </SectionCard>
  );
}
