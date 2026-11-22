"use client";

// Die bisher nachgepflegten Vertragsangaben (#7767): welche Liste, wann, von
// wem und wie viele Verträge sie geändert hat. Nur zur Information; die
// Datei selbst bewahrt moto nicht auf.

import { useMemo } from "react";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { SectionCard } from "~/components/ui/section-card";
import { formatBerlinDate, formatBerlinTime } from "~/lib/date-helpers";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { fetchTraegerBuero } from "~/lib/traeger-api";
import type { ContractCorrectionLogEntry } from "~/lib/traeger-contract-correction-api";
import { useTraegerResource } from "./use-traeger-resource";

export function CareContractCorrectionLogCard({
  entries,
}: Readonly<{ entries: readonly ContractCorrectionLogEntry[] }>) {
  // Die Personen des Träger-Büros nennen die Konten; ohne Leserecht
  // bleibt die Kontonummer, ohne Fehlermeldung.
  const { data: buero } = useTraegerResource(
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

  const columns: DataTableColumn<ContractCorrectionLogEntry>[] = [
    {
      key: "file",
      header: "Datei",
      render: (entry) => (
        <span className="font-medium wrap-anywhere text-gray-900">
          {entry.file || "–"}
        </span>
      ),
      stacked: "title",
    },
    {
      key: "at",
      header: "Geändert am",
      render: (entry) =>
        `${formatBerlinDate(entry.correctedAt)}, ${formatBerlinTime(entry.correctedAt)} Uhr`,
      sortValue: (entry) => entry.correctedAt,
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
      title="Bisher nachgepflegt"
      description="Nur zur Information. Jeder geänderte Vertrag zeigt seine Änderung mit dem Beleg."
    >
      {entries.length === 0 ? (
        <EmptyState
          variant="compact"
          title="Noch nichts nachgepflegt"
          description="Hier steht jede Liste, die Verträge geändert hat."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={[...entries]}
          getRowKey={(entry) =>
            `${entry.file}|${entry.correctedAt}|${entry.accountId ?? ""}`
          }
          stackedOnMobile
          stackedLayout="lines"
          dense
        />
      )}
    </SectionCard>
  );
}
