"use client";

// Die bisherigen Vertragsimporte (#4723): welche Datei, wann, von wem und wie
// viele Verträge. Nur zur Information; die Datei selbst bewahrt moto nicht auf.

import { type ReactNode, useMemo } from "react";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { SectionCard } from "~/components/ui/section-card";
import { formatBerlinDate, formatBerlinTime } from "~/lib/date-helpers";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { fetchTraegerBuero } from "~/lib/traeger-api";
import type { ContractImportLogEntry } from "~/lib/traeger-care-contract-import-api";
import { useFreshTraegerResource } from "./use-traeger-resource";

export function CareContractImportLogCard({
  entries,
  action,
}: Readonly<{
  entries: readonly ContractImportLogEntry[];
  /** The way to complete imported contracts (#7767). */
  action?: ReactNode;
}>) {
  // Die Personen des Träger-Büros nennen die Konten; ohne Leserecht
  // bleibt die Kontonummer, ohne Fehlermeldung.
  const { data: buero } = useFreshTraegerResource(
    entries.length > 0 ? traegerKeys.buero() : null,
    fetchTraegerBuero,
    "die Personen des Träger-Büros",
  );
  const emails = useMemo(
    () =>
      new Map<string, string>(
        buero?.members.map((m) => [m.accountId, m.email] as const) ?? [],
      ),
    [buero],
  );

  const columns: DataTableColumn<ContractImportLogEntry>[] = [
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
        <span className="wrap-anywhere">
          {entry.accountId === null
            ? "Gelöschtes Konto"
            : (emails.get(entry.accountId) ?? `Konto ${entry.accountId}`)}
        </span>
      ),
    },
    {
      key: "count",
      header: "Verträge",
      align: "right",
      render: (entry) => (
        <span className="tabular-nums">{entry.contracts}</span>
      ),
      stacked: "meta",
    },
  ];

  return (
    <SectionCard
      title="Bisherige Importe"
      description="Nur zur Information. Jeder übernommene Vertrag merkt sich die Datei und die Zeile."
      action={action}
    >
      {entries.length === 0 ? (
        <p className="text-sm text-gray-600">Noch keine Verträge importiert.</p>
      ) : (
        <DataTable
          columns={columns}
          rows={[...entries]}
          getRowKey={(entry) =>
            `${entry.file}|${entry.importedAt}|${entry.accountId ?? ""}`
          }
          stackedOnMobile
          stackedLayout="lines"
          dense
        />
      )}
    </SectionCard>
  );
}
