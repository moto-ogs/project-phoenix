"use client";

// Die geänderte Fassung eines aktiven Betreuungsvertrags, die auf die
// Unterschrift der Eltern wartet (#4816). Haben Schule oder Träger die
// Betreuung geändert, gilt die neue Version erst mit der Unterschrift. Bis
// dahin gilt die bisherige Version. Die Karte sagt, wer jetzt handelt, zeigt
// die Erinnerungen dieser Version und nimmt den Papiervertrag an.

import { Upload } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { changeHistoryConcept } from "~/lib/concepts/changeHistory";
import {
  formatBerlinDate,
  formatBerlinTime,
  formatDate,
} from "~/lib/date-helpers";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import type {
  CareContractDetail,
  ContractVersion,
} from "~/lib/traeger-care-contracts-api";
import {
  CONTRACT_CHANGE_SECTION_ID,
  CONTRACT_VERSIONS_SECTION_ID,
  ContractSectionJump,
} from "./care-contract-detail-tabs";

const PaperSignatureModal = dynamic(
  () =>
    import("./care-contract-paper-modal").then(
      (module) => module.PaperSignatureModal,
    ),
  { ssr: false },
);

/** The changed version of an active contract that waits for the signature. */
export function waitingChange(
  contract: Pick<CareContractDetail, "changeAwaitsSignature" | "versions">,
): ContractVersion | undefined {
  return contract.changeAwaitsSignature
    ? contract.versions.find((version) => version.status === "beantragt")
    : undefined;
}

/** The notice above the tabs of a contract whose change waits. */
export function waitingChangeText(
  waiting: ContractVersion,
  inForce: number,
): string {
  return `Eine geänderte Fassung wartet auf die Unterschrift der Eltern. Bis dahin gilt Version ${inForce}. Version ${waiting.number} gilt ab ${formatDate(waiting.effectiveFrom)}, frühestens ab der Unterschrift.`;
}

export function CareContractWaitingChangeCard({
  contract,
  waiting,
  onChanged,
}: Readonly<{
  contract: CareContractDetail;
  waiting: ContractVersion;
  onChanged: () => Promise<void>;
}>) {
  const [paperOpen, setPaperOpen] = useState(false);
  const afterPaper = useRefreshAfterWrite(
    "die Anzeige des Vertrags",
    onChanged,
  );
  const reminders = contract.reminders.filter(
    (reminder) => reminder.versionNumber === waiting.number,
  );
  // The newest mail went out for this version when it is not older than it.
  const mailed = (contract.mailings[0]?.sentAt ?? "") >= waiting.createdAt;

  return (
    <>
      <SectionCard
        id={CONTRACT_CHANGE_SECTION_ID}
        concept={changeHistoryConcept}
        title="Geänderte Fassung"
        description={`Die Betreuung hat sich geändert. Version ${waiting.number} gilt ab ${formatDate(waiting.effectiveFrom)}, sobald die Eltern unterschrieben haben. Bis dahin gilt Version ${contract.version.number}.`}
        titleBadge={<StatusBadge label="Wartet auf Eltern" tone="warning" />}
        action={
          <Button
            type="button"
            variant="outline"
            size="md"
            tooltip="Öffnet ein Fenster, um die unterschriebene Fassung als PDF hochzuladen."
            onClick={() => setPaperOpen(true)}
          >
            <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
            Papiervertrag erfassen
          </Button>
        }
      >
        <LoadErrorAlert error={afterPaper.error} className="mb-4" />
        <div className="space-y-3">
          {mailed ? (
            <p className="text-sm text-gray-600">
              Die Eltern haben die neue Fassung per Mail und in der Eltern-App
              bekommen. Dort sehen sie, was sich ändert, und unterschreiben. Bis
              zur Unterschrift bekommen sie Erinnerungen per Mail.
            </p>
          ) : (
            <Alert
              type="warning"
              message="Die Eltern haben für diese Fassung keine Mail bekommen. Lade das PDF unter „Versionen“ herunter und gib es den Eltern. Hast du es unterschrieben zurück? Dann wähle „Papiervertrag erfassen“."
              action={
                <ContractSectionJump
                  targetId={CONTRACT_VERSIONS_SECTION_ID}
                  tooltip="Springt zu den Versionen. Dort lädst du das PDF der neuen Fassung."
                >
                  Zu den Versionen
                </ContractSectionJump>
              }
            />
          )}
          {reminders.length > 0 ? (
            <ol className="space-y-2">
              {reminders.map((reminder) => (
                <li
                  key={reminder.number}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="font-medium text-gray-900">
                    {reminder.number}. Erinnerung
                  </span>
                  <span className="text-gray-500">
                    {formatBerlinDate(reminder.sentAt)},{" "}
                    {formatBerlinTime(reminder.sentAt)} Uhr
                  </span>
                </li>
              ))}
            </ol>
          ) : mailed ? (
            <p className="text-sm text-gray-500">
              Noch keine Erinnerung geschickt.
            </p>
          ) : null}
        </div>
      </SectionCard>
      {paperOpen ? (
        <PaperSignatureModal
          contract={contract}
          change
          onClose={() => setPaperOpen(false)}
          onSaved={() => {
            setPaperOpen(false);
            return afterPaper.refresh();
          }}
        />
      ) : null}
    </>
  );
}
