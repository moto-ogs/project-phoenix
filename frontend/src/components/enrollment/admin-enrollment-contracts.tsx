"use client";

import { useMemo } from "react";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import {
  CONTRACT_STATUS_LABELS,
  contractStatusTone,
  formatConclusion,
  formatServiceDays,
} from "~/components/traeger/care-contract-format";
import { getApplicationContracts } from "~/lib/application-contracts-api";
import { careContractsConcept } from "~/lib/concepts/careContracts";
import type { ApplicationContractResponse } from "~/lib/contract/care-contracts.generated";
import { formatBerlinDate, formatDate } from "~/lib/date-helpers";
import type { AdminRequestChild } from "~/lib/enrollment-admin-api";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { notBookedModuleOf } from "~/lib/module-not-booked";
import { useSWRAuth } from "~/lib/swr";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import type {
  CareContractStatus,
  ConclusionMethod,
  ContractService,
  Weekday,
} from "~/lib/traeger-care-contracts-api";

const STATUSES = new Set<string>(Object.keys(CONTRACT_STATUS_LABELS));
const METHODS = new Set<string>([
  "mit_anmeldung",
  "einfach_elektronisch",
  "papier",
]);

function knownStatus(value: string): CareContractStatus | null {
  return STATUSES.has(value) ? (value as CareContractStatus) : null;
}

function services(contract: ApplicationContractResponse): ContractService[] {
  return (contract.services ?? []).map((service) => ({
    weekday: service.weekday as Weekday,
    careOfferingId: "",
    moduleName: service.module_name,
    endsAt: service.ends_at,
    lastDay: service.last_day,
  }));
}

/** What the contract's state means for the school, in one line. */
export function contractStateLine(
  contract: ApplicationContractResponse,
): string {
  const concluded = contract.concluded;
  if (concluded && METHODS.has(concluded.method)) {
    const line = `Abgeschlossen: ${formatConclusion({
      method: concluded.method as ConclusionMethod,
      at: concluded.at,
    })}.`;
    if (contract.status === "gekuendigt") {
      return contract.ends_on
        ? `${line} Gekündigt zum ${formatDate(contract.ends_on)}.`
        : `${line} Gekündigt, das Enddatum legt der Träger fest.`;
    }
    return line;
  }
  switch (contract.status) {
    case "versendet":
      return contract.sent_at
        ? `Am ${formatBerlinDate(contract.sent_at)} an die Eltern geschickt. Die Eltern müssen ihn noch unterschreiben.`
        : "An die Eltern geschickt. Die Eltern müssen ihn noch unterschreiben.";
    case "widerrufen":
      return "Die Eltern haben den Vertrag widerrufen.";
    case "beendet":
      return "Der Vertrag ist beendet.";
    default:
      return "";
  }
}

/**
 * The care contracts the Träger made from this application (#4788, ADR 0088
 * section 7), one row per child. Read-only: the Träger manages contracts in
 * its portal. Stays away while no child has a contract, and where the school
 * did not book the module Online-Anmeldung the read belongs to.
 */
export function AdminEnrollmentContracts({
  requestId,
  childList,
}: Readonly<{ requestId: string; childList: readonly AdminRequestChild[] }>) {
  const ids = useMemo(() => childList.map((child) => child.id), [childList]);
  const { data, error, mutate } = useSWRAuth(
    ids.length > 0 ? enrollmentKeys.applicationContracts(requestId) : null,
    () => getApplicationContracts(ids),
  );
  const notBooked = notBookedModuleOf(error) !== null;
  const load = useSwrResourceLoadError(
    [{ data, error: notBooked ? undefined : error }],
    "die Betreuungsverträge",
    () => mutate(),
  );
  if (notBooked) return null;
  if (load.error) return <LoadErrorAlert error={load.error} />;
  const contracts = data ?? [];
  if (contracts.length === 0) return null;
  const byChild = new Map(
    contracts.map((contract) => [contract.request_child_id, contract]),
  );

  return (
    <SectionCard
      title="Betreuungsverträge"
      leading={<MotoConceptIcon concept={careContractsConcept} size={18} />}
      description="Nur zur Ansicht. Die Verträge erstellt und verwaltet der Träger."
      bodyClassName="mt-4"
    >
      <DataGrid>
        {childList.map((child) => {
          const contract = byChild.get(child.id);
          const name = `${child.first_name} ${child.last_name}`.trim();
          if (!contract) {
            return (
              <DataField key={child.id} label={name} fullWidth>
                Noch kein Vertrag. Den Vertrag erstellt der Träger.
              </DataField>
            );
          }
          const status = knownStatus(contract.status);
          const booked = services(contract);
          return (
            <DataField key={child.id} label={name} fullWidth>
              <span className="flex flex-col gap-1">
                {status ? (
                  <StatusBadge
                    tone={contractStatusTone({
                      status,
                      endsOn: contract.ends_on,
                    })}
                    compact
                    label={CONTRACT_STATUS_LABELS[status]}
                    className="self-start"
                  />
                ) : null}
                <span>{contractStateLine(contract)}</span>
                {booked.length > 0 ? (
                  <span className="text-gray-600">
                    {contract.effective_from
                      ? `Gebucht ab ${formatDate(contract.effective_from)}: `
                      : "Gebucht: "}
                    {formatServiceDays(booked)}
                  </span>
                ) : null}
              </span>
            </DataField>
          );
        })}
      </DataGrid>
    </SectionCard>
  );
}
