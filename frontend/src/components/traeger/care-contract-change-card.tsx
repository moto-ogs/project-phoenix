"use client";

// Änderungswunsch der Eltern (#5979): Eltern beantragen in der Eltern-App
// andere Tage oder Module. Das Träger-Büro sieht den Wunsch auf der
// Vertragsseite und gibt ihn selbst frei oder lehnt ihn ab, wie die Schule.
// Nach der Freigabe folgt der Vertrag mit einer neuen Version.

import { ArrowLeftRight } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { DataField, DataGrid } from "~/components/ui/detail-modal-components";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { NoticeCardJump } from "~/components/traeger/care-contract-notice-card";
import { OfferingRequestChanges } from "~/components/students/offering-request-changes";
import {
  describeAdjustment,
  formatWeekdayAdverbs,
  type RosterImpact,
} from "~/lib/roster-impact";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import {
  contractChangeReview,
  type ContractChangeOutcome,
  type ContractChangeRequest,
  type ContractChanges,
} from "~/lib/care-contract-changes";
import { fetchContractChanges } from "~/lib/care-contract-changes-api";
import { formatBerlinDate, formatDate } from "~/lib/date-helpers";
import { traegerContractKeys } from "~/lib/swr/traeger-contract-keys";
import { useTraegerResource } from "./use-traeger-resource";

// The decision form carries the date picker; it loads when the office
// opens it, so the contract page stays as light as before.
const DecideChangeModal = dynamic(
  () =>
    import("./care-contract-change-modal").then(
      (module) => module.DecideChangeModal,
    ),
  { ssr: false },
);

/** What a decision or a conflict left on the card, with its contract. */
interface CardNote {
  readonly contractId: string;
  readonly impact: RosterImpact | null;
  readonly refreshed: boolean;
}

export function CareContractChangeCard({
  contractId,
  onDecided,
}: Readonly<{
  contractId: string;
  /** The contract page reads again: the next version follows the decision. */
  onDecided: () => void;
}>) {
  const {
    data: changes,
    error,
    mutate,
  } = useTraegerResource(
    traegerContractKeys.changes(contractId),
    () => fetchContractChanges(contractId),
    "der Änderungswunsch",
  );
  // A note belongs to the contract it was made for, never to the next one.
  const [note, setNote] = useState<CardNote | null>(null);
  const [deciding, setDeciding] = useState<{
    contractId: string;
    request: ContractChangeRequest;
    approve: boolean;
  } | null>(null);
  const current = note?.contractId === contractId ? note : null;
  const impact = current?.impact ?? null;
  const refreshed = current?.refreshed ?? false;

  const onConflict = useCallback(() => {
    setDeciding(null);
    setNote({ contractId, impact: null, refreshed: true });
    // The stale request goes at once: no decision on it until the new one is read.
    void mutate(undefined);
  }, [contractId, mutate]);
  const request = changes?.pending[0] ?? null;

  return (
    <SectionCard
      icon={ArrowLeftRight}
      title="Änderungswunsch der Eltern"
      titleBadge={
        request ? (
          <StatusBadge tone="warning" label="Wartet auf Entscheidung" />
        ) : undefined
      }
      description={
        request
          ? "Die Eltern möchten die gebuchte Betreuung ändern. Sie oder die Schule entscheiden."
          : "Eltern beantragen andere Tage oder Module in der Eltern-App. Sie oder die Schule entscheiden."
      }
      loading={changes === null && !error}
      loadingRows={3}
      footer={
        request && changes?.decidable ? (
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline_danger"
              size="md"
              tooltip="Öffnet ein Fenster, um den Wunsch mit Begründung für die Eltern abzulehnen."
              onClick={() =>
                setDeciding({ contractId, request, approve: false })
              }
            >
              Ablehnen
            </Button>
            {request.endsAllCare ? null : (
              <Button
                type="button"
                variant="success"
                size="md"
                tooltip="Öffnet ein Fenster, um den Wunsch ab einem Tag freizugeben."
                onClick={() =>
                  setDeciding({ contractId, request, approve: true })
                }
              >
                Freigeben
              </Button>
            )}
          </div>
        ) : null
      }
    >
      {error ? <LoadErrorAlert error={error} /> : null}
      {refreshed ? (
        <Alert
          type="info"
          message="Der Änderungswunsch wurde inzwischen geändert oder entschieden. Bitte prüfen Sie den aktuellen Stand."
        />
      ) : null}
      {changes && request ? <PendingChange request={request} /> : null}
      {changes && !request ? (
        <LastDecision outcome={changes.lastDecision} />
      ) : null}
      {impact ? (
        <div className="space-y-3">
          {impact.notAdjusted.length > 0 ||
          impact.pickupOverrides.length > 0 ? (
            <Alert
              type="warning"
              message="Bitte geben Sie diese Hinweise an die Schule weiter. Die Schule muss Regeltermine und Abholzeiten prüfen."
            />
          ) : null}
          <ChangeFollowUp impact={impact} />
        </div>
      ) : null}
      {deciding?.contractId === contractId ? (
        <DecideChangeModal
          isOpen
          onClose={() => setDeciding(null)}
          contractId={contractId}
          request={deciding.request}
          approve={deciding.approve}
          reasonRequired={changes?.reasonRequired ?? true}
          onConflict={onConflict}
          onDecided={(next: ContractChanges) => {
            void mutate(next, { revalidate: false });
            setNote({
              contractId,
              impact: next.rosterImpact ?? null,
              refreshed: false,
            });
            setDeciding(null);
            onDecided();
          }}
        />
      ) : null}
    </SectionCard>
  );
}

/** The open request: from when, what changes per module, the parents' note. */
function PendingChange({
  request,
}: Readonly<{ request: ContractChangeRequest }>) {
  return (
    <div className="space-y-5">
      <DataGrid>
        <DataField label="Gewünscht ab">
          {formatDate(request.effectiveFrom)}
        </DataField>
        <DataField label="Eingegangen am">
          {formatBerlinDate(request.submittedAt)}
        </DataField>
      </DataGrid>
      {request.endsAllCare ? (
        <Alert
          type="warning"
          message="Die Eltern melden damit die ganze Betreuung ab. Das ist eine Kündigung. Tragen Sie sie unter „Vertrag beenden“ ein. Hier können Sie den Wunsch nur ablehnen."
          action={<NoticeCardJump />}
        />
      ) : null}
      <OfferingRequestChanges row={contractChangeReview(request)} />
    </div>
  );
}

/** No open request: the last decision, if any, so the office sees the end. */
function LastDecision({
  outcome,
}: Readonly<{ outcome: ContractChangeOutcome | null }>) {
  if (!outcome) {
    return (
      <p className="text-sm text-gray-500">Kein offener Änderungswunsch.</p>
    );
  }
  return (
    <DataGrid columns={1}>
      <DataField label="Zuletzt entschieden">
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge
            tone={outcome.approved ? "green" : "gray"}
            label={outcome.approved ? "Freigegeben" : "Abgelehnt"}
          />
          <span>
            {outcome.approved
              ? `Gilt ab ${formatDate(outcome.effectiveFrom)}`
              : `Am ${formatBerlinDate(outcome.decidedAt)}`}
          </span>
        </span>
        {outcome.reason ? (
          <span className="mt-1 block text-sm font-normal wrap-anywhere text-gray-500">
            {outcome.reason}
          </span>
        ) : null}
      </DataField>
    </DataGrid>
  );
}

/**
 * What the approval did to the child's Regeltermine and pickup times, as a
 * plain list the office passes on: the school acts on it in its own plan.
 */
function ChangeFollowUp({ impact }: Readonly<{ impact: RosterImpact }>) {
  const lines = [
    ...impact.adjusted.map(
      (template) =>
        `${template.name}: ${describeAdjustment(template)}. Das hat moto schon angepasst.`,
    ),
    ...impact.notAdjusted.map(
      (template) =>
        `${template.name}: ${formatWeekdayAdverbs(template.weekdays)} noch eingetragen. Die Schule prüft den Regeltermin.`,
    ),
    ...impact.pickupOverrides.map(
      (override) =>
        `Abholzeit ${formatWeekdayAdverbs([override.weekday])} ab ${formatDate(override.date)}: eingetragen ${override.storedTime} Uhr, gebucht ${override.bookedTime} Uhr. Die Schule gleicht sie an.`,
    ),
  ];
  if (lines.length === 0) return null;
  return (
    <ul className="space-y-1.5 text-sm wrap-anywhere text-gray-700">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}
