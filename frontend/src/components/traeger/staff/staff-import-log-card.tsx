"use client";

// Die bisherigen Personal-Importe (#4724): welche Datei, wann, von wem, wie
// viele Akten neu und wie viele ergänzt. Nur zur Information; die Datei
// selbst bewahrt moto nicht auf.

import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { SectionCard } from "~/components/ui/section-card";
import { formatBerlinDate, formatBerlinTime } from "~/lib/date-helpers";
import type { StaffImportLogEntry } from "~/lib/traeger-staff-import-api";

// Wer importiert hat: „Ihnen“ für die eigenen Importe, sonst der Name, den
// die Person beim Träger trägt. Die Personalverwaltung darf das Träger-Büro
// nicht lesen; die Namen kommen deshalb mit dem Protokoll.
function importedBy(entry: StaffImportLogEntry): string {
  if (entry.byYou) return "Ihnen";
  return entry.accountName.trim() || "Konto ohne Namen";
}

export function StaffImportLogCard({
  entries,
}: Readonly<{ entries: readonly StaffImportLogEntry[] }>) {
  const columns: DataTableColumn<StaffImportLogEntry>[] = [
    {
      key: "file",
      header: "Datei",
      render: (entry) => (
        <span className="font-medium wrap-anywhere text-gray-900">
          {entry.file}
        </span>
      ),
      stacked: "title",
    },
    {
      key: "at",
      header: "Übernommen am",
      render: (entry) =>
        `${formatBerlinDate(entry.importedAt)}, ${formatBerlinTime(entry.importedAt)} Uhr`,
      sortValue: (entry) => entry.importedAt,
    },
    {
      key: "by",
      header: "Von",
      render: (entry) => (
        <span className="wrap-anywhere">{importedBy(entry)}</span>
      ),
    },
    {
      key: "created",
      header: "Neue Akten",
      align: "right",
      render: (entry) => <span className="tabular-nums">{entry.created}</span>,
      stacked: "meta",
    },
    {
      key: "completed",
      header: "Ergänzt",
      align: "right",
      render: (entry) => (
        <span className="tabular-nums">{entry.completed}</span>
      ),
    },
  ];

  return (
    <SectionCard
      title="Bisherige Importe"
      description="Nur zur Information. Jede Akte zeigt in ihrem Verlauf die Datei und die Zeile."
    >
      {entries.length === 0 ? (
        <p className="text-sm text-gray-600">Noch kein Personal importiert.</p>
      ) : (
        <DataTable
          columns={columns}
          rows={[...entries]}
          getRowKey={(entry) =>
            `${entry.file}|${entry.importedAt}|${entry.accountId}`
          }
          stackedOnMobile
          stackedLayout="lines"
          dense
        />
      )}
    </SectionCard>
  );
}
