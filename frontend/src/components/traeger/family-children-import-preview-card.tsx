"use client";

// Vorschau zum Nachtragen der Kinderzahl (#7356): jede Zeile der Datei mit
// ihrem Stand, dem Kind, der Zahl und dem, was sie aufhält. Übernommen
// werden nur die bereiten Zeilen; eine schon bestätigte Zahl bleibt.

import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { SectionCard } from "~/components/ui/section-card";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { StatusBadge } from "~/components/ui/status-badge";
import { formatDate } from "~/lib/date-helpers";
import type {
  FamilyImportResult,
  FamilyImportRow,
} from "~/lib/traeger-family-children-import-api";
import { childrenLabel } from "./family-children-format";
import {
  FAMILY_IMPORT_STATUS,
  type FamilyImportFilter,
  familyImportChild,
  familyImportOutcomeText,
  familyImportProblemText,
  matchesFamilyImportFilter,
  numberCountLabel,
} from "./family-children-import-format";

const IMPORT_PAGE_SIZE = 50;

function NotesCell({ row }: Readonly<{ row: FamilyImportRow }>) {
  const lines = row.problems.map((problem) =>
    familyImportProblemText(problem, row),
  );
  const outcome = familyImportOutcomeText(row);
  if (outcome) lines.push(outcome);
  if (lines.length === 0) return <span className="text-gray-500">–</span>;
  return (
    <ul className="space-y-0.5 text-sm text-gray-700">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function footerText(result: FamilyImportResult): string {
  const { counts } = result;
  const left = counts.conflict + counts.invalid + counts.differs;
  if (counts.ready === 0 && left === 0 && counts.same > 0) {
    return "Alle Zahlen der Datei sind schon bestätigt.";
  }
  if (left > 0) {
    return `${left === 1 ? "1 Zeile bleibt" : `${left} Zeilen bleiben`} draußen. Korrigieren Sie die Datei und laden Sie sie noch einmal.`;
  }
  return "Jede Zahl gilt als von Ihnen bestätigt, ab dem ersten Tag des Vertrags.";
}

export function FamilyChildrenImportPreviewCard({
  result,
  applying,
  disabled = false,
  onApply,
}: Readonly<{
  result: FamilyImportResult;
  applying: boolean;
  disabled?: boolean;
  onApply: () => void;
}>) {
  const [filter, setFilter] = useState<FamilyImportFilter>("all");
  const counts = result.counts;
  const shown = useMemo(
    () => result.rows.filter((row) => matchesFamilyImportFilter(row, filter)),
    [result.rows, filter],
  );
  const filters: { value: FamilyImportFilter; label: string }[] = [
    { value: "all", label: `Alle ${result.rows.length}` },
    { value: "ready", label: `Bereit ${counts.ready + counts.imported}` },
    {
      value: "problems",
      label: `Offen ${counts.conflict + counts.invalid + counts.differs}`,
    },
    { value: "unchanged", label: `Bestätigt ${counts.same}` },
  ];

  const columns: DataTableColumn<FamilyImportRow>[] = [
    {
      key: "child",
      header: "Kind",
      render: (row) => (
        <span className="block min-w-0">
          <span className="block font-medium wrap-anywhere text-gray-900">
            {familyImportChild(row)}
          </span>
          <span className="block text-xs text-gray-500 sm:whitespace-nowrap">
            {`Zeile ${row.line} · ${
              row.childBirthDate
                ? `geb. ${formatDate(row.childBirthDate)}`
                : "ohne Geburtsdatum"
            }`}
          </span>
        </span>
      ),
      // The file's own order is the start; the name sorts on request.
      sortValue: (row) => `${row.childLastName} ${row.childFirstName}`,
      stacked: "title",
    },
    {
      key: "status",
      header: "Stand",
      render: (row) => (
        <StatusBadge
          tone={FAMILY_IMPORT_STATUS[row.status].tone}
          label={FAMILY_IMPORT_STATUS[row.status].label}
        />
      ),
      stacked: "meta",
    },
    {
      key: "school",
      header: "Schule",
      render: (row) => (
        <span className="wrap-anywhere text-gray-900">
          {row.schoolName || "–"}
        </span>
      ),
      sortValue: (row) => row.schoolName,
    },
    {
      key: "children",
      header: "Kinderzahl",
      render: (row) =>
        row.children === null ? (
          <span className="text-gray-500">–</span>
        ) : (
          <span className="block min-w-0">
            <span className="block font-semibold whitespace-nowrap text-gray-900 tabular-nums">
              {childrenLabel(row.children)}
            </span>
            {row.validFrom ? (
              <span className="block text-xs whitespace-nowrap text-gray-500 tabular-nums">
                {`ab ${formatDate(row.validFrom)}`}
              </span>
            ) : null}
          </span>
        ),
      sortValue: (row) => row.children ?? 0,
    },
    {
      key: "notes",
      header: "Hinweis",
      render: (row) => <NotesCell row={row} />,
    },
  ];

  return (
    <SectionCard
      title="Prüfen und übernehmen"
      description={
        disabled
          ? "Die Vorschau zeigt den letzten geprüften Stand. Übernehmen ist erst nach der Prüfung möglich."
          : "So würde moto jede Zeile übernehmen. Gespeichert wird erst, wenn Sie übernehmen."
      }
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-600">{footerText(result)}</p>
          <Button
            type="button"
            variant="success"
            size="md"
            onClick={onApply}
            disabled={disabled || counts.ready === 0}
            disabledReason={
              disabled
                ? "Übernehmen geht erst, wenn moto die Datei geprüft hat."
                : "In der Datei ist keine Zeile bereit zum Übernehmen."
            }
            tooltip="Bestätigt die Kinderzahl der bereiten Zeilen sofort für ihre Familien."
            isLoading={applying}
            loadingText="Wird übernommen …"
          >
            {numberCountLabel(counts.ready)} übernehmen
          </Button>
        </div>
      }
    >
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
        columns={columns}
        rows={[...shown]}
        getRowKey={(row) => row.line}
        stackedOnMobile
        stackedLayout="lines"
        dense
        // A file may hold 5.000 rows: show them in pages; the counts and the
        // import still cover every row.
        pageSize={IMPORT_PAGE_SIZE}
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
