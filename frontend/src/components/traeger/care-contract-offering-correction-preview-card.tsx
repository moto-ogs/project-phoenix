"use client";

// Vorschau der neuen Zuordnung der Module (#7764): eine Zeile je Vertrag der
// Datei, mit den Buchungen, die zu einem anderen Modul wechseln, dem Tag,
// ab dem die neue Version gilt, und dem, was den Vertrag aufhält. Geändert
// werden nur die Verträge mit „Wird geändert“; moto fragt vorher nach.

import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  Clock,
  ExternalLink,
  Repeat,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { SectionCard } from "~/components/ui/section-card";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { StatCard } from "~/components/ui/stat-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { formatDate } from "~/lib/date-helpers";
import { labelOf } from "~/lib/label-of";
import type {
  OfferingCorrectionContract,
  OfferingCorrectionResult,
} from "~/lib/traeger-offering-correction-api";
import { traegerPath } from "~/lib/traeger-url";
import { contractImportWeekdays } from "./care-contract-import-format";
import {
  OFFERING_CORRECTION_STATUS,
  type OfferingCorrectionFilter,
  contractCount,
  correctionChild,
  correctionNotes,
  matchesCorrectionFilter,
} from "./care-contract-offering-correction-format";

const UNKNOWN_STATUS = { label: "–", tone: "gray" } as const;

const PAGE_SIZE = 50;

function ContractCell({
  contract,
}: Readonly<{ contract: OfferingCorrectionContract }>) {
  const child = correctionChild(contract);
  const name =
    child || (contract.reference ? `Vertrag „${contract.reference}“` : "–");
  const meta = [
    contract.contractId ? `Nr. ${contract.contractId}` : null,
    contract.schoolName || null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="block min-w-0">
      {contract.contractId ? (
        // A new tab keeps the checked file and the preview on this page.
        <Link
          href={traegerPath(`/traeger/vertraege/${contract.contractId}`)}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 font-medium wrap-anywhere text-gray-900 underline-offset-2 hover:underline"
        >
          {name}
          <ExternalLink
            className="h-3.5 w-3.5 shrink-0 text-gray-500"
            aria-hidden="true"
          />
          <span className="sr-only"> (öffnet in einem neuen Tab)</span>
        </Link>
      ) : (
        <span className="block font-medium wrap-anywhere text-gray-900">
          {name}
        </span>
      )}
      <span className="block text-xs wrap-anywhere text-gray-500">
        {meta || `Zeile ${contract.line}`}
      </span>
    </span>
  );
}

function ChangeCell({
  contract,
}: Readonly<{ contract: OfferingCorrectionContract }>) {
  if (contract.changes.length === 0) {
    return <span className="text-gray-500">–</span>;
  }
  return (
    <ul className="space-y-2">
      {contract.changes.map((change) => (
        <li
          key={`${change.weekdays.join(",")}|${change.from}|${change.to}`}
          className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-2 text-sm"
        >
          <span className="pt-px text-xs leading-5 font-medium text-gray-700 tabular-nums">
            {contractImportWeekdays(change.weekdays)}
          </span>
          {/* The old module stays quiet, the new one carries the weight;
              the arrow never parts from its target when the cell wraps. */}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="wrap-anywhere text-gray-500">{change.from}</span>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <ArrowRight
                className="h-3.5 w-3.5 shrink-0 text-gray-500"
                aria-hidden="true"
              />
              <span className="sr-only">wird zu</span>
              {change.to ? (
                <span className="font-medium wrap-anywhere text-gray-900">
                  {change.to}
                </span>
              ) : (
                <StatusBadge tone="orange" size="xs" label="noch offen" />
              )}
            </span>
            {change.from === change.to && (
              // A renamed module whose old name a new module took: the
              // names match, the modules and their prices do not.
              <span className="basis-full text-xs text-gray-500">
                Anderes Modul mit gleichem Namen
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function EffectiveCell({
  contract,
}: Readonly<{ contract: OfferingCorrectionContract }>) {
  if (!contract.effectiveFrom) return <span className="text-gray-500">–</span>;
  return (
    <span className="block sm:whitespace-nowrap">
      <span className="block text-gray-900 tabular-nums">
        {formatDate(contract.effectiveFrom)}
      </span>
      {contract.hints.includes("start_moved") ? (
        <span className="block text-xs text-gray-500">Vertragsbeginn</span>
      ) : null}
    </span>
  );
}

function NotesCell({
  contract,
}: Readonly<{ contract: OfferingCorrectionContract }>) {
  const lines = correctionNotes(contract);
  if (lines.length === 0) return <span className="text-gray-500">–</span>;
  return (
    <ul className="space-y-0.5 text-sm text-gray-700">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function footerText(result: OfferingCorrectionResult): string {
  const { counts } = result;
  if (counts.ready > 0) {
    return `Neue Version ab ${formatDate(result.effectiveFrom)}. Frühere Versionen bleiben. Eltern bekommen keine Nachricht.`;
  }
  if (counts.invalid + counts.held === 0 && counts.unchanged > 0) {
    return "Alle Verträge der Datei buchen schon die neuen Module.";
  }
  return "Kein Vertrag kann geändert werden. Korrigiere die Datei und lade sie noch einmal.";
}

export function CareContractOfferingCorrectionPreviewCard({
  result,
  applying,
  disabled = false,
  onApply,
}: Readonly<{
  result: OfferingCorrectionResult;
  applying: boolean;
  disabled?: boolean;
  onApply: () => void;
}>) {
  const [filter, setFilter] = useState<OfferingCorrectionFilter>("all");
  const { counts } = result;
  const shown = useMemo(
    () =>
      result.contracts.filter((contract) =>
        matchesCorrectionFilter(contract, filter),
      ),
    [result.contracts, filter],
  );
  const filters: { value: OfferingCorrectionFilter; label: string }[] = [
    { value: "all", label: `Alle ${result.contracts.length}` },
    { value: "ready", label: `Wird geändert ${counts.ready}` },
    { value: "unchanged", label: `Schon zugeordnet ${counts.unchanged}` },
    { value: "held", label: `Zurückgestellt ${counts.held}` },
    { value: "invalid", label: `Nicht möglich ${counts.invalid}` },
  ];

  const columns: DataTableColumn<OfferingCorrectionContract>[] = [
    {
      key: "contract",
      header: "Vertrag",
      render: (contract) => <ContractCell contract={contract} />,
      sortValue: (contract) =>
        `${contract.childLastName} ${contract.childFirstName}`,
      stacked: "title",
      className: "lg:min-w-52",
    },
    {
      key: "status",
      header: "Status",
      render: (contract) => {
        const status = labelOf(
          OFFERING_CORRECTION_STATUS,
          contract.status,
          UNKNOWN_STATUS,
        );
        return <StatusBadge tone={status.tone} label={status.label} />;
      },
      stacked: "meta",
    },
    {
      key: "change",
      header: "Änderung",
      className: "lg:min-w-80",
      // On a phone the change and the note name themselves and take the
      // full width; a contract without one has no line for it.
      stackedLabel: false,
      render: (contract) =>
        contract.changes.length > 0 ? <ChangeCell contract={contract} /> : null,
    },
    {
      key: "effective",
      header: "Gilt ab",
      render: (contract) => <EffectiveCell contract={contract} />,
      sortValue: (contract) => contract.effectiveFrom,
    },
    {
      key: "notes",
      header: "Hinweis",
      stackedLabel: false,
      render: (contract) =>
        correctionNotes(contract).length > 0 ? (
          <NotesCell contract={contract} />
        ) : null,
    },
  ];

  return (
    <SectionCard
      title="Prüfen und ändern"
      description={
        disabled
          ? "Die Vorschau zeigt den letzten geprüften Stand. Ändern geht erst nach der Prüfung."
          : "So würde moto jeden Vertrag ändern. Gespeichert wird erst, wenn du bestätigst."
      }
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-600">{footerText(result)}</p>
          <Button
            type="button"
            variant="success"
            size="md"
            className="shrink-0"
            onClick={onApply}
            disabled={disabled || counts.ready === 0}
            disabledReason={
              disabled
                ? "Ändern geht erst, wenn moto die Datei geprüft hat."
                : "Kein Vertrag der Datei steht auf „Wird geändert“."
            }
            tooltip="Gibt den Verträgen eine neue Version. moto fragt vorher nach."
            isLoading={applying}
            loadingText="Wird geändert …"
          >
            {contractCount(counts.ready)} ändern
          </Button>
        </div>
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          variant="inline"
          label="Wird geändert"
          value={counts.ready}
          icon={<Repeat className="h-4 w-4" aria-hidden="true" />}
        />
        <StatCard
          variant="inline"
          label="Schon zugeordnet"
          value={counts.unchanged}
          icon={<CircleCheck className="h-4 w-4" aria-hidden="true" />}
        />
        <StatCard
          variant="inline"
          label="Zurückgestellt"
          value={counts.held}
          icon={<Clock className="h-4 w-4" aria-hidden="true" />}
        />
        <StatCard
          variant="inline"
          label="Nicht möglich"
          value={
            <span className={counts.invalid > 0 ? "text-moto-red" : undefined}>
              {counts.invalid}
            </span>
          }
          icon={
            <CircleAlert
              className={
                counts.invalid > 0 ? "text-moto-red h-4 w-4" : "h-4 w-4"
              }
              aria-hidden="true"
            />
          }
        />
      </div>
      <div className="mb-4">
        <SegmentedControl
          ariaLabel="Verträge zeigen"
          fullWidth
          wrap
          minSegmentWidth={140}
          items={filters}
          value={filter}
          onChange={setFilter}
        />
      </div>
      <DataTable
        columns={columns}
        rows={[...shown]}
        getRowKey={(contract) => `${contract.line}|${contract.reference}`}
        stackedOnMobile
        stackedLayout="lines"
        dense
        pageSize={PAGE_SIZE}
        pageNoun="Verträge"
        paginationResetKey={filter}
        emptyState={
          <EmptyState
            variant="compact"
            title="Keine Verträge"
            description="In dieser Auswahl gibt es keinen Vertrag."
          />
        }
      />
    </SectionCard>
  );
}
