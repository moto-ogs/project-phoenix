"use client";

// Die Abbuchungen einer Familie je Rechnung (#4697): was in welcher
// Lastschriftdatei war, was noch offen ist und was nicht abgebucht werden
// darf. Nur zur Information; eingereicht wird auf der Seite des Laufs.

import { useEffect, useRef } from "react";
import { formatEuro } from "~/components/traeger/contribution-format";
import {
  SEPA_DEBIT_LEFT_LABELS,
  SEPA_SEQUENCE_BADGES,
  debitDocumentLabel,
} from "~/components/traeger/sepa-debit-format";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { formatDate } from "~/lib/date-helpers";
import { traegerBillingRunKeys } from "~/lib/swr/traeger-billing-run-keys";
import type { SepaMandate } from "~/lib/traeger-sepa-api";
import {
  type SepaDebit,
  fetchSepaMandateCollections,
} from "~/lib/traeger-sepa-debits-api";
import { useTraegerResource } from "./use-traeger-resource";

function debitState(debit: SepaDebit) {
  if (debit.status === "submitted") {
    return (
      <span className="flex flex-col items-start gap-1">
        <StatusBadge label="Bei der Bank eingereicht" tone="green" size="xs" />
        {debit.submittedAt ? (
          <span className="text-xs text-gray-500 tabular-nums">
            am {formatDate(debit.submittedAt)}
          </span>
        ) : null}
      </span>
    );
  }
  if (debit.left) {
    return (
      <span className="flex flex-col items-start gap-1">
        <StatusBadge label="Nicht in der Datei" tone="red" size="xs" />
        <span className="text-xs text-gray-600">
          {SEPA_DEBIT_LEFT_LABELS[debit.left]}
        </span>
      </span>
    );
  }
  return (
    <StatusBadge label="Noch nicht eingereicht" tone="warning" size="xs" />
  );
}

const columns: DataTableColumn<SepaDebit>[] = [
  {
    key: "invoice",
    header: "Rechnung oder Bescheid",
    stacked: "title",
    render: (debit) => (
      <span className="font-medium text-gray-900 tabular-nums">
        {debitDocumentLabel(debit)}
      </span>
    ),
  },
  {
    key: "amount",
    header: "Betrag",
    align: "right",
    stacked: "meta",
    render: (debit) => (
      <span className="tabular-nums">{formatEuro(debit.amountCents)}</span>
    ),
  },
  {
    key: "due",
    header: "Abbuchung am",
    render: (debit) => (
      <span className="tabular-nums">
        {formatDate(debit.collectOn ?? debit.dueOn)}
      </span>
    ),
  },
  {
    key: "sequence",
    header: "Art",
    render: (debit) => {
      const badge = SEPA_SEQUENCE_BADGES[debit.sequenceType];
      return <StatusBadge label={badge.label} tone={badge.tone} size="xs" />;
    },
  },
  {
    key: "state",
    header: "Stand",
    render: debitState,
  },
];

export function SepaCollectionsCard({
  mandates,
}: Readonly<{ mandates: readonly SepaMandate[] }>) {
  const ids = mandates.map((mandate) => mandate.id);
  const {
    data: debits,
    error,
    reload,
  } = useTraegerResource(
    ids.length > 0 ? traegerBillingRunKeys.sepaMandateCollections(ids) : null,
    async () => {
      const lists = await Promise.all(
        ids.map((id) => fetchSepaMandateCollections(id)),
      );
      return lists.flat().sort((a, b) => b.dueOn.localeCompare(a.dueOn));
    },
    "die Abbuchungen",
  );
  // A revoked mandate keeps its ID; its debits change all the same.
  const mandateState = JSON.stringify(mandates);
  const shownState = useRef(mandateState);
  useEffect(() => {
    if (shownState.current === mandateState) return;
    shownState.current = mandateState;
    reload();
  }, [mandateState, reload]);

  if (mandates.length === 0) return null;
  return (
    <SectionCard
      title="Abbuchungen"
      description="Jede Rechnung und jede Rate eines Bescheids, die per Lastschrift abgebucht wird. Nur zur Information: Die Datei für die Bank lädst du auf der Seite des Laufs."
      loading={debits === null && !error}
    >
      {error ? (
        <LoadErrorAlert error={error} actionLayout="responsive" />
      ) : debits && debits.length > 0 ? (
        <DataTable
          columns={columns}
          rows={debits}
          getRowKey={(debit) => debit.id}
          stackedOnMobile
        />
      ) : debits ? (
        <EmptyState
          variant="compact"
          title="Noch keine Abbuchung"
          description="Sobald ein Lauf mit diesem Mandat freigegeben ist, steht die Rechnung hier."
        />
      ) : null}
    </SectionCard>
  );
}
