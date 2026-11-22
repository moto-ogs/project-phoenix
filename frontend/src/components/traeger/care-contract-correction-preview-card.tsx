"use client";

// Vorschau der nachgepflegten Vertragsangaben (#7767): oben die Zahlen der
// Datei, darunter jede Zeile mit dem Kind, den Werten vorher und nachher,
// dem Beleg und ihrem Stand. Ein Fehler steht in der Spalte, zu der er
// gehört. Geändert werden nur Zeilen ohne Fehler, die etwas ändern.

import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { SectionCard } from "~/components/ui/section-card";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { StatCard } from "~/components/ui/stat-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { labelOf } from "~/lib/label-of";
import type {
  ContractCorrectionChange,
  ContractCorrectionField,
  ContractCorrectionRow,
  ContractCorrectionRun,
} from "~/lib/traeger-contract-correction-api";
import {
  CONTRACT_CORRECTION_STATUS,
  type ContractCorrectionFilter,
  contractCorrectionProblemsOf,
  matchesContractCorrectionFilter,
} from "./care-contract-correction-format";
import { CorrectionValue } from "./care-contract-correction-value";
import { contractCountLabel } from "./care-contract-import-format";

const UNKNOWN_STATUS = { label: "–", tone: "gray" } as const;

const PAGE_SIZE = 50;

/** Der Inhalt einer Zelle mit den Fehlern ihrer Spalte darunter. */
function WithProblems({
  row,
  fields,
  children,
}: Readonly<{
  row: ContractCorrectionRow;
  fields: readonly (ContractCorrectionField | undefined)[];
  children: ReactNode;
}>) {
  const problems = contractCorrectionProblemsOf(row, fields);
  return (
    <span className="block min-w-0">
      {children}
      {problems.length > 0 ? (
        <span className="text-moto-red-strong mt-1 block space-y-0.5 text-sm">
          {problems.map((problem) => (
            <span key={problem} className="block">
              {problem}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function valueColumn(
  field: ContractCorrectionChange,
  header: string,
): DataTableColumn<ContractCorrectionRow> {
  return {
    key: field,
    header,
    render: (row) => (
      <WithProblems row={row} fields={[field]}>
        <CorrectionValue
          field={field}
          before={row.before}
          after={row.after}
          changed={row.changes.includes(field)}
        />
      </WithProblems>
    ),
  };
}

const COLUMNS: DataTableColumn<ContractCorrectionRow>[] = [
  {
    key: "child",
    header: "Kind",
    render: (row) => (
      <WithProblems row={row} fields={["contract_id", "child", undefined]}>
        <span className="block font-medium wrap-anywhere text-gray-900">
          {row.childName || "–"}
        </span>
        <span className="block text-xs wrap-anywhere text-gray-500">
          {row.schoolName
            ? `Zeile ${row.line} · ${row.schoolName}`
            : `Zeile ${row.line}`}
        </span>
      </WithProblems>
    ),
    // The file's own order is the start; the name sorts on request.
    sortValue: (row) => row.childName,
    stacked: "title",
  },
  {
    key: "status",
    header: "Status",
    render: (row) => {
      const status = labelOf(
        CONTRACT_CORRECTION_STATUS,
        row.status,
        UNKNOWN_STATUS,
      );
      return <StatusBadge tone={status.tone} label={status.label} />;
    },
    stacked: "meta",
  },
  valueColumn("parties", "Vertragsparteien"),
  valueColumn("method", "Abschlussart"),
  valueColumn("concluded_on", "Abschlussdatum"),
  {
    key: "evidence",
    header: "Beleg",
    render: (row) => (
      <WithProblems row={row} fields={["evidence"]}>
        {row.evidence ? (
          <span className="wrap-anywhere text-gray-900">{row.evidence}</span>
        ) : (
          <span className="text-gray-500">–</span>
        )}
      </WithProblems>
    ),
  },
];

function footerText(run: ContractCorrectionRun): string {
  const { counts } = run;
  if (run.applied) {
    return "Die Verträge zeigen die neuen Angaben. Eine erneut hochgeladene Liste ändert nichts mehr.";
  }
  if (counts.invalid > 0) {
    return `${counts.invalid === 1 ? "1 Zeile bleibt" : `${counts.invalid} Zeilen bleiben`} draußen. Korrigiere die Liste und lade sie noch einmal hoch.`;
  }
  if (counts.change === 0) {
    return "Alle Verträge der Liste sind schon aktuell.";
  }
  return "Es entsteht kein neuer Vertrag. Eltern bekommen keine Mail.";
}

export function CareContractCorrectionPreviewCard({
  run,
  applying,
  disabled = false,
  onApply,
  onRestart,
}: Readonly<{
  run: ContractCorrectionRun;
  applying: boolean;
  /** The preview shows an older look at the file; applying waits. */
  disabled?: boolean;
  onApply: () => void;
  onRestart: () => void;
}>) {
  const [filter, setFilter] = useState<ContractCorrectionFilter>("all");
  const { counts } = run;
  const changing = run.applied ? counts.corrected : counts.change;
  const shown = useMemo(
    () =>
      run.rows.filter((row) => matchesContractCorrectionFilter(row, filter)),
    [run.rows, filter],
  );
  const filters: { value: ContractCorrectionFilter; label: string }[] = [
    { value: "all", label: `Alle ${run.rows.length}` },
    {
      value: "change",
      label: `${run.applied ? "Geändert" : "Wird geändert"} ${changing}`,
    },
    { value: "invalid", label: `Fehler ${counts.invalid}` },
    { value: "unchanged", label: `Aktuell ${counts.unchanged}` },
  ];

  return (
    <SectionCard
      title={run.applied ? "Ergebnis" : "Prüfen und ändern"}
      description={
        run.applied
          ? "Diese Angaben stehen jetzt in den Verträgen."
          : disabled
            ? "Die Vorschau zeigt den letzten geprüften Stand. Ändern geht erst nach der Prüfung."
            : "So würde moto jeden Vertrag ändern. Gespeichert wird erst, wenn du bestätigst."
      }
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-600">{footerText(run)}</p>
          {run.applied ? (
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={onRestart}
              tooltip="Leert die Vorschau, damit du eine weitere Liste hochladen kannst."
            >
              Weitere Liste hochladen
            </Button>
          ) : (
            <Button
              type="button"
              variant="success"
              size="md"
              onClick={onApply}
              disabled={disabled || counts.change === 0}
              disabledReason={
                disabled
                  ? "Ändern geht erst, wenn moto die Liste geprüft hat."
                  : "Keine Zeile der Liste ändert etwas."
              }
              tooltip="moto fragt vorher nach, dann ändert es die Angaben der Verträge."
              isLoading={applying}
              loadingText="Wird geändert …"
            >
              {contractCountLabel(counts.change)} ändern
            </Button>
          )}
        </div>
      }
    >
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          variant="inline"
          label={run.applied ? "Geändert" : "Werden geändert"}
          value={<span className="tabular-nums">{changing}</span>}
          icon={<ArrowsClockwiseIcon className="h-4 w-4" aria-hidden="true" />}
        />
        <StatCard
          variant="inline"
          label="Bereits aktuell"
          value={<span className="tabular-nums">{counts.unchanged}</span>}
          icon={<CheckCircleIcon className="h-4 w-4" aria-hidden="true" />}
        />
        <StatCard
          variant="inline"
          label="Mit Fehler"
          value={
            <span
              className={
                counts.invalid > 0
                  ? "text-moto-red-strong tabular-nums"
                  : "tabular-nums"
              }
            >
              {counts.invalid}
            </span>
          }
          icon={
            <WarningIcon
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
          ariaLabel="Zeilen zeigen"
          fullWidth
          wrap
          items={filters}
          value={filter}
          onChange={setFilter}
        />
      </div>
      <DataTable
        columns={COLUMNS}
        rows={[...shown]}
        getRowKey={(row) => row.line}
        stackedOnMobile
        stackedLayout="lines"
        dense
        // A list may hold every imported contract: show it in pages; the
        // counts and the change still cover every row.
        pageSize={PAGE_SIZE}
        paginationResetKey={filter}
        emptyState={
          <EmptyState
            variant="compact"
            title="Keine Zeilen"
            description="In dieser Auswahl gibt es keine Zeile."
          />
        }
      />
    </SectionCard>
  );
}
