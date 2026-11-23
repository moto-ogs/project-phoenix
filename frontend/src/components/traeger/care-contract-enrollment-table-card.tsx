"use client";

// Die Zeilen von „Anmeldungen nachtragen“ (#7760, ADR 0309): je importiertem
// Vertrag der Schule das Kind, wie der Vertrag es nennt, neben der
// Kinderakte, die Buchungen und der Stand mit einem Satz. So fällt eine
// falsche Verknüpfung auf, bevor etwas läuft. Nach dem Lauf bleibt die
// Tabelle als Arbeitsliste der offenen Zeilen stehen.

import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { SectionCard } from "~/components/ui/section-card";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { StatusBadge } from "~/components/ui/status-badge";
import { formatDate } from "~/lib/date-helpers";
import type {
  EnrollmentBooking,
  EnrollmentCounts,
  EnrollmentRow,
} from "~/lib/traeger-contract-enrollments-api";
import { traegerPath } from "~/lib/traeger-url";
import {
  type EnrollmentFilter,
  defaultEnrollmentFilter,
  enrollmentBookingDays,
  enrollmentBookingPeriod,
  enrollmentName,
  enrollmentRowTexts,
  enrollmentStatus,
  matchesEnrollmentFilter,
} from "./care-contract-enrollment-format";

const PAGE_SIZE = 50;

/** Ob die Kinderakte anders heißt als das Kind im Vertrag. */
function nameDiffers(row: EnrollmentRow): boolean {
  if (!row.student) return false;
  const fold = (first: string, last: string) =>
    `${first} ${last}`.trim().split(/\s+/).join(" ").toLowerCase();
  return (
    fold(row.contractChild.firstName, row.contractChild.lastName) !==
    fold(row.student.firstName, row.student.lastName)
  );
}

/** Ein Link, der die Vorschau stehen lässt: Er öffnet einen neuen Tab. */
function NewTabLink({
  href,
  children,
  label,
}: Readonly<{ href: string; children: ReactNode; label: string }>) {
  return (
    <Link
      href={traegerPath(href)}
      target="_blank"
      rel="noopener"
      className="font-medium text-gray-700 underline"
    >
      <span className="sr-only">{label} </span>
      {children}
      <span className="sr-only"> (öffnet in einem neuen Tab)</span>
    </Link>
  );
}

function ContractCell({ row }: Readonly<{ row: EnrollmentRow }>) {
  return (
    <span className="block min-w-0">
      <span className="block text-xs text-gray-500 tabular-nums">
        <NewTabLink
          href={`/traeger/vertraege/${row.contractId}`}
          label="Vertrag"
        >{`Nr. ${row.contractId}`}</NewTabLink>
      </span>
      <span
        className={`block wrap-anywhere text-gray-900 ${nameDiffers(row) ? "font-semibold" : ""}`}
      >
        {enrollmentName(row.contractChild)}
      </span>
    </span>
  );
}

function StudentCell({ row }: Readonly<{ row: EnrollmentRow }>) {
  if (!row.student) {
    return (
      <span className="text-gray-500">
        {row.status === "unlinked" ? "Nicht verknüpft" : "Keine Kinderakte"}
      </span>
    );
  }
  const differs = nameDiffers(row);
  return (
    <span className="block min-w-0">
      <span className="block text-xs text-gray-500 tabular-nums">
        {`Nr. ${row.student.studentId}`}
      </span>
      <span
        className={`block wrap-anywhere text-gray-900 ${differs ? "font-semibold" : ""}`}
      >
        {enrollmentName(row.student)}
      </span>
      <span className="block text-xs text-gray-500">
        {row.student.birthDate
          ? `geb. ${formatDate(row.student.birthDate)}`
          : "ohne Geburtsdatum"}
      </span>
      {differs ? (
        <StatusBadge
          tone="warning"
          size="xs"
          label="Name weicht ab"
          className="mt-1"
        />
      ) : null}
    </span>
  );
}

function BookingLines({
  bookings,
}: Readonly<{ bookings: readonly EnrollmentBooking[] }>) {
  return (
    <>
      {bookings.map((booking) => (
        <span
          key={`${booking.careOfferingId}-${booking.validFrom ?? ""}`}
          className="block"
        >
          <span className="block font-medium text-gray-900">
            {booking.moduleName}
          </span>
          <span className="block text-gray-700">
            {enrollmentBookingDays(booking)}
          </span>
          {enrollmentBookingPeriod(booking) ? (
            <span className="block text-xs text-gray-500 tabular-nums">
              {enrollmentBookingPeriod(booking)}
            </span>
          ) : null}
        </span>
      ))}
    </>
  );
}

function BookingCell({ row }: Readonly<{ row: EnrollmentRow }>) {
  if (row.bookings.length === 0) {
    // A bound contract follows the bookings of its enrollment; the row
    // does not repeat them (the contract page shows them).
    return (
      <span className="text-gray-500">
        {row.status === "done" ? "Wie in der Anmeldung" : "–"}
      </span>
    );
  }
  return (
    <span className="block space-y-2 text-sm">
      <BookingLines bookings={row.bookings} />
      {row.changes.map((change) => (
        <span
          key={change.effectiveFrom ?? "change"}
          className="block border-t border-gray-100 pt-2"
        >
          <span className="block text-xs text-gray-500">
            {change.effectiveFrom
              ? `Geplante Änderung ab ${formatDate(change.effectiveFrom)}`
              : "Geplante Änderung"}
          </span>
          <BookingLines bookings={change.bookings} />
        </span>
      ))}
    </span>
  );
}

function NotesCell({ row }: Readonly<{ row: EnrollmentRow }>) {
  const lines = enrollmentRowTexts(row);
  return (
    <span className="block space-y-1 text-sm text-gray-700">
      {lines.map((line) => (
        <span key={line} className="block">
          {line}
        </span>
      ))}
      {row.status === "unlinked" ? (
        <span className="block">
          <Link
            href={traegerPath("/traeger/vertraege/verknuepfen")}
            className="font-medium text-gray-900 underline"
          >
            Mit Kinderakten verknüpfen
          </Link>
        </span>
      ) : null}
      {row.reason === "follows_contract" && row.followsContractId ? (
        <span className="block">
          <NewTabLink
            href={`/traeger/vertraege/${row.followsContractId}`}
            label="Früheren"
          >{`Vertrag Nr. ${row.followsContractId} öffnen`}</NewTabLink>
        </span>
      ) : null}
    </span>
  );
}

const COLUMNS: DataTableColumn<EnrollmentRow>[] = [
  {
    key: "contract",
    header: "Vertrag",
    className: "min-w-32",
    render: (row) => <ContractCell row={row} />,
    sortValue: (row) =>
      `${row.contractChild.lastName} ${row.contractChild.firstName}`.trim() ||
      null,
    stacked: "title",
  },
  {
    key: "student",
    header: "Kinderakte",
    className: "min-w-32",
    render: (row) => <StudentCell row={row} />,
  },
  {
    key: "bookings",
    header: "Betreuung",
    className: "min-w-40",
    render: (row) => <BookingCell row={row} />,
  },
  {
    key: "status",
    header: "Stand",
    render: (row) => {
      const status = enrollmentStatus(row);
      return <StatusBadge tone={status.tone} label={status.label} />;
    },
    stacked: "meta",
  },
  {
    key: "notes",
    header: "Hinweis",
    className: "min-w-56",
    render: (row) => <NotesCell row={row} />,
    stackedLabel: false,
  },
];

function filterItems(
  counts: EnrollmentCounts,
  total: number,
  afterRun: boolean,
): { value: EnrollmentFilter; label: string }[] {
  const items: { value: EnrollmentFilter; label: string }[] = [
    { value: "all", label: `Alle ${total}` },
  ];
  if (!afterRun)
    items.push({ value: "ready", label: `Bereit ${counts.ready}` });
  items.push(
    { value: "done", label: `Erledigt ${counts.done}` },
    { value: "open", label: `Zurückgestellt ${counts.held + counts.changed}` },
  );
  // A stuck row needs another way out than an open one: its own filter, only
  // when there is one.
  if (counts.stuck > 0) {
    items.push({ value: "stuck", label: `Hängt ${counts.stuck}` });
  }
  items.push({
    value: "unlinked",
    label: `Ohne Kinderakte ${counts.unlinked}`,
  });
  return items;
}

export function CareContractEnrollmentTableCard({
  title,
  description,
  rows,
  counts,
  afterRun = false,
  footer,
}: Readonly<{
  title: string;
  description: string;
  rows: readonly EnrollmentRow[];
  counts: EnrollmentCounts;
  /** Nach dem Lauf: kein Filter „Bereit“, die offenen Zeilen zuerst. */
  afterRun?: boolean;
  footer?: ReactNode;
}>) {
  // A new preview or run opens on its most useful filter again.
  const [chosen, setChosen] = useState<{
    readonly for: readonly EnrollmentRow[];
    readonly filter: EnrollmentFilter;
  } | null>(null);
  const filter =
    chosen?.for === rows
      ? chosen.filter
      : defaultEnrollmentFilter(counts, afterRun);
  const shown = useMemo(
    () => rows.filter((row) => matchesEnrollmentFilter(row, filter)),
    [rows, filter],
  );

  return (
    <SectionCard title={title} description={description} footer={footer}>
      <div className="mb-4">
        <SegmentedControl
          ariaLabel="Zeilen zeigen"
          fullWidth
          wrap
          items={filterItems(counts, rows.length, afterRun)}
          value={filter}
          onChange={(next) => setChosen({ for: rows, filter: next })}
        />
      </div>
      <DataTable
        columns={COLUMNS}
        rows={[...shown]}
        getRowKey={(row) => row.contractId}
        stackedOnMobile
        stackedLayout="lines"
        dense
        pageSize={PAGE_SIZE}
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
