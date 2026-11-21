"use client";

// Vorschau des Personal-Imports (#4724): oben die Zahlen der Datei, darunter
// jede Zeile mit ihrem Stand, der Person, den Bank- und Steuerwerten (nur
// verdeckt) und dem Grund, warum sie draußen bleibt. Übernommen werden nur
// neue und ergänzende Zeilen; eine Zeile, die nicht zu ihrer Akte passt,
// ändert nichts.

import {
  CheckCircleIcon,
  NotePencilIcon,
  UserPlusIcon,
  WarningIcon,
} from "@phosphor-icons/react";
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
  StaffImportResult,
  StaffImportRow,
} from "~/lib/traeger-staff-import-api";
import {
  STAFF_IMPORT_STATUS,
  type StaffImportFilter,
  matchesStaffImportFilter,
  staffImportProblemText,
  staffImportRowsLabel,
  staffImportStatusNote,
  staffImportTakes,
} from "./staff-import-format";

const IMPORT_PAGE_SIZE = 50;

/** A state this build does not know: no claim about the row. */
const UNKNOWN_STATUS = { label: "–", tone: "gray" } as const;

function PersonCell({ row }: Readonly<{ row: StaffImportRow }>) {
  const name = `${row.firstName} ${row.lastName}`.trim();
  return (
    <span className="block min-w-0">
      <span className="block font-medium wrap-anywhere text-gray-900">
        {name || "Ohne Namen"}
      </span>
      <span className="block text-sm text-gray-500 tabular-nums">
        {row.personnelNumber ? `Nr. ${row.personnelNumber}` : "Ohne Nummer"}
        {row.birthday ? ` · geboren am ${formatDate(row.birthday)}` : ""}
      </span>
    </span>
  );
}

function FinancialCell({ row }: Readonly<{ row: StaffImportRow }>) {
  const parts = [
    row.ibanMasked,
    row.taxIdMasked ? "Steuer-ID" : "",
    row.socialSecurityNumberMasked ? "SV-Nummer" : "",
  ].filter(Boolean);
  if (parts.length === 0) return <span className="text-gray-500">–</span>;
  return (
    <span className="block text-sm text-gray-700">
      {row.ibanMasked ? (
        <span className="block font-mono text-gray-900 sm:whitespace-nowrap">
          {row.ibanMasked}
        </span>
      ) : null}
      {parts.length > (row.ibanMasked ? 1 : 0) ? (
        <span className="block text-xs text-gray-500">
          {parts.slice(row.ibanMasked ? 1 : 0).join(" · ")}
        </span>
      ) : null}
    </span>
  );
}

function NotesCell({ row }: Readonly<{ row: StaffImportRow }>) {
  const note = staffImportStatusNote(row);
  const lines = [
    ...(note ? [note] : []),
    ...row.problems.map(staffImportProblemText),
  ];
  if (lines.length === 0) return <span className="text-gray-500">–</span>;
  return (
    <ul className="space-y-0.5 text-sm text-gray-700">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

const COLUMNS: DataTableColumn<StaffImportRow>[] = [
  {
    key: "line",
    header: "Zeile",
    render: (row) => (
      <span className="text-gray-500 tabular-nums">{row.line}</span>
    ),
    sortValue: (row) => row.line,
  },
  {
    key: "person",
    header: "Person",
    render: (row) => <PersonCell row={row} />,
    sortValue: (row) => `${row.lastName} ${row.firstName}`.toLowerCase(),
    stacked: "title",
  },
  {
    key: "status",
    header: "Was moto tut",
    render: (row) => (
      <StatusBadge
        tone={labelOf(STAFF_IMPORT_STATUS, row.status, UNKNOWN_STATUS).tone}
        label={labelOf(STAFF_IMPORT_STATUS, row.status, UNKNOWN_STATUS).label}
      />
    ),
    sortValue: (row) => row.status ?? "",
    stacked: "meta",
  },
  {
    key: "financial",
    header: "Bank und Steuer",
    render: (row) => <FinancialCell row={row} />,
  },
  {
    key: "notes",
    header: "Hinweis",
    render: (row) => <NotesCell row={row} />,
  },
];

export function StaffImportPreviewCard({
  result,
  applying,
  disabled = false,
  onApply,
}: Readonly<{
  result: StaffImportResult;
  applying: boolean;
  disabled?: boolean;
  onApply: () => void;
}>) {
  const counts = result.counts;
  const takes = staffImportTakes(counts);
  const problems = counts.conflict + counts.invalid;
  const [filter, setFilter] = useState<StaffImportFilter>("all");
  const shown = useMemo(
    () => result.rows.filter((row) => matchesStaffImportFilter(row, filter)),
    [result.rows, filter],
  );
  const filters: { value: StaffImportFilter; label: string }[] = [
    { value: "all", label: `Alle ${result.rows.length}` },
    { value: "takes", label: `Übernimmt ${takes}` },
    { value: "skipped", label: `Vorhanden ${counts.duplicate}` },
    { value: "problems", label: `Zu prüfen ${problems}` },
  ];

  return (
    <SectionCard
      title="Prüfen und übernehmen"
      description={
        disabled
          ? "Die Vorschau zeigt den letzten geprüften Stand. Übernehmen geht erst nach der Prüfung."
          : "So würde moto jede Zeile übernehmen. Geändert wird erst, wenn du übernimmst."
      }
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-600">
            {problems > 0
              ? `${staffImportRowsLabel(problems)} ${problems === 1 ? "bleibt" : "bleiben"} draußen. Korrigiere die Datei und lade sie neu.`
              : "Jede Zeile passt. Bestehende Werte ändert moto nie."}
          </p>
          <Button
            type="button"
            variant="success"
            size="md"
            onClick={onApply}
            disabled={disabled || takes === 0}
            disabledReason={
              disabled
                ? "Übernehmen geht erst, wenn moto die Datei geprüft hat."
                : "In der Datei ist keine neue oder ergänzende Zeile."
            }
            tooltip="Legt die neuen Akten sofort an und ergänzt fehlende Bank- und Steuerdaten."
            isLoading={applying}
            loadingText="Wird übernommen …"
          >
            {staffImportRowsLabel(takes)} übernehmen
          </Button>
        </div>
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          variant="inline"
          label="Neue Akten"
          value={counts.new}
          icon={<UserPlusIcon className="h-4 w-4" aria-hidden="true" />}
        />
        <StatCard
          variant="inline"
          label="Ergänzt"
          value={counts.complete}
          icon={<NotePencilIcon className="h-4 w-4" aria-hidden="true" />}
        />
        <StatCard
          variant="inline"
          label="Schon vorhanden"
          value={counts.duplicate}
          icon={<CheckCircleIcon className="h-4 w-4" aria-hidden="true" />}
        />
        <StatCard
          variant="inline"
          label="Zu prüfen"
          value={
            <span className={problems > 0 ? "text-moto-red" : undefined}>
              {problems}
            </span>
          }
          icon={
            <WarningIcon
              className={problems > 0 ? "text-moto-red h-4 w-4" : "h-4 w-4"}
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
          minSegmentWidth={140}
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
