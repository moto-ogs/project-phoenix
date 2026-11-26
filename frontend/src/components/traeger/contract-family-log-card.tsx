"use client";

// Der Verlauf der Familien ohne Mail-Adresse (#7161, ADR 0319): wann welches
// Kind zu welcher Familie kam oder aus ihr gelöst wurde, und von wem. Nur
// zur Information; die Änderung selbst steht in der Liste darüber.

import { useMemo } from "react";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { formatBerlinDate, formatBerlinTime } from "~/lib/date-helpers";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { fetchTraegerBuero } from "~/lib/traeger-api";
import type { ContractFamilyEvent } from "~/lib/traeger-contract-families-api";
import { familyEventText } from "./contract-family-format";
import { useFreshTraegerResource } from "./use-traeger-resource";

export function ContractFamilyLogCard({
  events,
  names,
}: Readonly<{
  events: readonly ContractFamilyEvent[];
  /** Der Name des Kindes je Vertrag, für „zur Familie von …“. */
  names: ReadonlyMap<string, string>;
}>) {
  // Die Personen des Träger-Büros nennen die Konten; ohne Leserecht
  // bleibt die Kontonummer, ohne Fehlermeldung.
  const { data: buero } = useFreshTraegerResource(
    events.length > 0 ? traegerKeys.buero() : null,
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

  const columns: DataTableColumn<ContractFamilyEvent>[] = [
    {
      key: "what",
      header: "Änderung",
      render: (event) => (
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge
            tone={event.action === "leave_family" ? "gray" : "green"}
            label={event.action === "leave_family" ? "Gelöst" : "Zusammen"}
          />
          <span className="font-medium text-gray-900">
            {familyEventText(event, names)}
          </span>
        </span>
      ),
      stacked: "title",
    },
    {
      key: "at",
      header: "Wann",
      render: (event) =>
        `${formatBerlinDate(event.at)}, ${formatBerlinTime(event.at)} Uhr`,
      stacked: "meta",
    },
    {
      key: "by",
      header: "Von",
      render: (event) => (
        <span className="wrap-anywhere">
          {event.accountId === null
            ? "Gelöschtes Konto"
            : (emails.get(event.accountId) ?? `Konto ${event.accountId}`)}
        </span>
      ),
    },
  ];

  return (
    <SectionCard
      title="Verlauf"
      description="Nur zur Information. Die neueste Änderung steht oben."
    >
      {events.length === 0 ? (
        <p className="text-sm text-gray-600">
          Noch keine Geschwister zusammengeführt.
        </p>
      ) : (
        <DataTable
          columns={columns}
          rows={[...events]}
          getRowKey={(event) => event.id}
          pageSize={10}
          pageNoun="Änderungen"
          stackedLayout="lines"
          dense
        />
      )}
    </SectionCard>
  );
}
