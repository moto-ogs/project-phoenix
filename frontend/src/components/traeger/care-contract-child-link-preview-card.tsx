"use client";

// Vorschau der Verknüpfung mit der Kinderakte (#7760, ADR 0307): jede Zeile
// der Datei mit dem Vertrag, der Kinderakte, der Schule und dem, was sie
// aufhält. Verknüpft werden nur die bereiten Zeilen; unklare bleiben, wie
// sie sind, und lassen sich einzeln auf der Seite des Vertrags verknüpfen.
// Nach dem Lauf bleibt die Tabelle als Arbeitsliste stehen.

import { Download } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { SectionCard } from "~/components/ui/section-card";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { StatusBadge } from "~/components/ui/status-badge";
import { downloadBlob } from "~/lib/file-download";
import { labelOf } from "~/lib/label-of";
import type {
  ChildLinkPerson,
  ChildLinkResult,
  ChildLinkRow,
} from "~/lib/traeger-contract-child-links-api";
import { traegerPath } from "~/lib/traeger-url";
import {
  CHILD_LINK_STATUS,
  type ChildLinkDifference,
  type ChildLinkFilter,
  childLinkBirth,
  childLinkContractCount,
  childLinkDifference,
  childLinkDifferenceText,
  childLinkName,
  childLinkRowTexts,
  defaultChildLinkFilter,
  matchesChildLinkFilter,
  openChildLinkRows,
  openChildLinkRowsCsv,
} from "./care-contract-child-link-format";

const UNKNOWN_STATUS = { label: "–", tone: "gray" } as const;

const PAGE_SIZE = 50;

/** Ob die Zeile Name oder Geburtsdatum als abweichend meldet. */
function differs(row: ChildLinkRow): boolean {
  return row.problems.some((problem) => problem.code === "differs");
}

/**
 * Name und Geburtsdatum eines Kindes. Was von der anderen Seite abweicht,
 * steht fett; der Hinweis darunter sagt es in Worten, nicht nur in Farbe.
 */
function PersonLines({
  person,
  difference,
}: Readonly<{ person: ChildLinkPerson; difference: ChildLinkDifference }>) {
  return (
    <>
      <span
        className={`block wrap-anywhere text-gray-900 ${difference.name ? "font-semibold" : ""}`}
      >
        {childLinkName(person)}
      </span>
      <span
        className={`block text-xs ${difference.birthDate ? "font-semibold text-gray-900" : "text-gray-500"}`}
      >
        {childLinkBirth(person)}
      </span>
    </>
  );
}

const SAME: ChildLinkDifference = { name: false, birthDate: false };

function ContractCell({ row }: Readonly<{ row: ChildLinkRow }>) {
  const known = row.contract.firstName !== "" || row.contract.lastName !== "";
  const difference = differs(row)
    ? childLinkDifference(row.contract, row.student)
    : SAME;
  return (
    <span className="block min-w-0">
      <span className="block text-xs text-gray-500 tabular-nums">
        {/* The line has its own column from the tablet on. */}
        <span className="sm:hidden">{`Zeile ${row.line} · `}</span>
        {row.contractId === null ? (
          "Keine gültige Nummer"
        ) : known ? (
          // A new tab keeps the preview of the file on this page.
          <Link
            href={traegerPath(`/traeger/vertraege/${row.contractId}`)}
            target="_blank"
            rel="noopener"
            className="font-medium text-gray-700 underline"
          >
            <span className="sr-only">Vertrag </span>
            {`Nr. ${row.contractId}`}
            <span className="sr-only"> (öffnet in einem neuen Tab)</span>
          </Link>
        ) : (
          `Nr. ${row.contractId}`
        )}
      </span>
      {known ? (
        <PersonLines person={row.contract} difference={difference} />
      ) : null}
      {row.schoolName ? (
        <span className="hidden text-xs text-gray-500 md:block xl:hidden">
          {row.schoolName}
        </span>
      ) : null}
    </span>
  );
}

function StudentCell({ row }: Readonly<{ row: ChildLinkRow }>) {
  const difference = differs(row)
    ? childLinkDifference(row.contract, row.student)
    : SAME;
  return (
    <span className="block min-w-0">
      <span className="block text-xs text-gray-500 tabular-nums">
        {row.studentId === null
          ? "Keine gültige Nummer"
          : `Nr. ${row.studentId}`}
      </span>
      {row.student ? (
        <>
          <PersonLines person={row.student} difference={difference} />
          {difference.name || difference.birthDate ? (
            <StatusBadge
              tone="warning"
              size="xs"
              label={childLinkDifferenceText(difference)}
              className="mt-1"
            />
          ) : null}
        </>
      ) : row.problems.some(
          (problem) => problem.field === "child" && problem.code === "unknown",
        ) ? (
        <span className="block text-gray-500">Keine Kinderakte gefunden</span>
      ) : null}
    </span>
  );
}

function NotesCell({ row }: Readonly<{ row: ChildLinkRow }>) {
  const lines = childLinkRowTexts(row);
  if (lines.length === 0) return <span className="text-gray-500">–</span>;
  return (
    <ul className="space-y-0.5 text-sm text-gray-700">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function footerText(result: ChildLinkResult): string {
  const { counts } = result;
  const open = counts.conflict + counts.invalid;
  if (counts.ready === 0 && open === 0 && counts.linked > 0) {
    return "Alle Verträge der Datei sind schon verknüpft. Hier ist nichts zu tun.";
  }
  if (open > 0) {
    return `${open === 1 ? "1 Zeile bleibt" : `${open} Zeilen bleiben`} offen. moto ändert an ihnen nichts. Bei jeder Zeile steht, was zu tun ist.`;
  }
  return "Es ändert sich nur die Verknüpfung. Eltern bekommen keine Nachricht, und es startet kein Rechnungslauf.";
}

const COLUMNS: DataTableColumn<ChildLinkRow>[] = [
  {
    key: "line",
    header: "Zeile",
    render: (row) => <span className="tabular-nums">{row.line}</span>,
    sortValue: (row) => row.line,
    stacked: "hidden",
  },
  {
    key: "contract",
    // Name and date stay on their lines; the note column takes the rest.
    className: "min-w-32",
    header: "Vertrag",
    render: (row) => <ContractCell row={row} />,
    sortValue: (row) =>
      `${row.contract.lastName} ${row.contract.firstName}`.trim() || null,
    stacked: "title",
  },
  {
    key: "student",
    // Name and date stay on their lines; the note column takes the rest.
    className: "min-w-32",
    header: "Kinderakte",
    render: (row) => <StudentCell row={row} />,
  },
  {
    key: "school",
    // On a tablet the school moves under the contract, so the note keeps
    // room to be read.
    className: "max-xl:hidden",
    headerClassName: "max-xl:hidden",
    header: "Schule",
    render: (row) => (
      <span className="wrap-anywhere">{row.schoolName || "–"}</span>
    ),
    sortValue: (row) => row.schoolName || null,
  },
  {
    key: "status",
    header: "Stand",
    render: (row) => (
      <StatusBadge
        tone={labelOf(CHILD_LINK_STATUS, row.status, UNKNOWN_STATUS).tone}
        label={labelOf(CHILD_LINK_STATUS, row.status, UNKNOWN_STATUS).label}
      />
    ),
    stacked: "meta",
  },
  {
    key: "notes",
    header: "Hinweis",
    className: "min-w-48",
    render: (row) => <NotesCell row={row} />,
    // The line says itself what it is; on a phone it takes the full width.
    stackedLabel: false,
  },
];

export function CareContractChildLinkPreviewCard({
  result,
  fileName,
  applying = false,
  disabled = false,
  onApply,
}: Readonly<{
  result: ChildLinkResult;
  /** Name der Datei, für den Namen der Arbeitsliste. */
  fileName: string;
  applying?: boolean;
  /** Die Vorschau zeigt einen älteren Stand: Verknüpfen wartet. */
  disabled?: boolean;
  /** Fehlt nach dem Lauf: Dann bleibt die Tabelle als Arbeitsliste. */
  onApply?: () => void;
}>) {
  const { counts, applied } = result;
  // The first look shows the rows that need work; a new file starts there
  // again.
  const [chosen, setChosen] = useState<{
    readonly for: ChildLinkResult;
    readonly filter: ChildLinkFilter;
  } | null>(null);
  const filter =
    chosen?.for === result ? chosen.filter : defaultChildLinkFilter(counts);
  const shown = useMemo(
    () => result.rows.filter((row) => matchesChildLinkFilter(row, filter)),
    [result.rows, filter],
  );
  const open = openChildLinkRows(result);
  const filters: { value: ChildLinkFilter; label: string }[] = [
    { value: "all", label: `Alle ${result.rows.length}` },
    {
      value: "ready",
      label: `${applied ? "Verknüpft" : "Bereit"} ${counts.ready + counts.stored}`,
    },
    { value: "linked", label: `Schon verknüpft ${counts.linked}` },
    { value: "conflict", label: `Unklar ${counts.conflict}` },
    { value: "invalid", label: `Nicht möglich ${counts.invalid}` },
  ];

  const downloadOpen = () =>
    downloadBlob(
      new Blob(["﻿", openChildLinkRowsCsv(open)], {
        type: "text/csv;charset=utf-8",
      }),
      `offen-${fileName.replace(/\.(csv|txt)$/i, "")}.csv`,
    );

  return (
    <SectionCard
      title={applied ? "Zeilen der Datei" : "Prüfen und verknüpfen"}
      description={
        applied
          ? "So steht jede Zeile nach dem Verknüpfen. Die offenen Zeilen sind deine Arbeitsliste."
          : disabled
            ? "Die Vorschau zeigt den letzten geprüften Stand. Verknüpfen geht erst nach der Prüfung."
            : "So würde moto jede Zeile verknüpfen. Gespeichert wird erst, wenn du verknüpfst."
      }
      action={
        open.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={downloadOpen}
            tooltip="Speichert die offenen Zeilen mit dem Grund als CSV-Datei."
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Offene Zeilen herunterladen
          </Button>
        ) : null
      }
      footer={
        onApply ? (
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
                  ? "Verknüpfen geht erst, wenn moto die Datei geprüft hat."
                  : counts.linked > 0 && counts.conflict + counts.invalid === 0
                    ? "Alle Verträge der Datei sind schon verknüpft."
                    : "In der Datei ist keine Zeile bereit zum Verknüpfen."
              }
              tooltip="Verknüpft die bereiten Verträge sofort mit ihrer Kinderakte."
              isLoading={applying}
              loadingText="Wird verknüpft …"
            >
              {childLinkContractCount(counts.ready)} verknüpfen
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="mb-4">
        <SegmentedControl
          ariaLabel="Zeilen zeigen"
          fullWidth
          wrap
          items={filters}
          value={filter}
          onChange={(next) => setChosen({ for: result, filter: next })}
        />
      </div>
      <DataTable
        columns={COLUMNS}
        rows={[...shown]}
        getRowKey={(row) => row.line}
        stackedOnMobile
        stackedLayout="lines"
        dense
        // A file may hold thousands of rows: show them in pages; the counts
        // and the run still cover every row.
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
