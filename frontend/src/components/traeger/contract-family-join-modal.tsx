"use client";

// Die Bestätigung, bevor das Träger-Büro Familien zusammenführt (#7161, ADR
// 0319). Sie nennt die Kinder, lässt den führenden Vertrag wählen und sagt,
// was danach gilt. moto führt nichts ohne diese Bestätigung zusammen.

import { UsersRound } from "lucide-react";
import { ChoiceTile } from "~/components/ui/choice-tile";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { IconTile } from "~/components/ui/icon-tile";
import { InsetPanel } from "~/components/ui/inset-panel";
import { ConfirmationModal } from "~/components/ui/modal";
import { Radio } from "~/components/ui/radio";
import { SectionLabel } from "~/components/ui/section-label";
import type { FormErrorInput } from "~/components/ui/form-error";
import { formatDate } from "~/lib/date-helpers";
import {
  type ContractFamily,
  childName,
  childrenLabel,
} from "./contract-family-format";

export function ContractFamilyJoinModal({
  families,
  lead,
  onLeadChange,
  onClose,
  onConfirm,
  busy,
  error,
}: Readonly<{
  /** Die ausgewählten Familien; ohne Auswahl ist das Fenster zu. */
  families: readonly ContractFamily[];
  lead: string;
  onLeadChange: (leadId: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  error: FormErrorInput;
}>) {
  const children = families.flatMap((family) => family.members);
  return (
    <ConfirmationModal
      isOpen={families.length > 1}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Zu einer Familie zusammenführen"
      icon={
        <IconTile tone="green" size="sm" icon={<UsersRound aria-hidden />} />
      }
      confirmText="Zusammenführen"
      confirmVariant="success"
      confirmTooltip="Führt die Kinder sofort zu einer Familie zusammen. Eltern bekommen keine Nachricht."
      isConfirmLoading={busy}
      loadingText="Wird zusammengeführt …"
      isConfirmDisabled={!lead}
      confirmDisabledReason="Wähle zuerst den Vertrag, der die Familie führt."
      mobileSheet
    >
      <div className="space-y-5">
        <FormErrorAlert message={error} />
        <p className="text-sm text-gray-700">
          {childrenLabel(children.length)} werden eine Familie. Im nächsten
          Monatslauf zählen sie als Geschwister.
        </p>
        <fieldset className="space-y-2">
          <legend className="mb-2">
            <SectionLabel as="p">Wer führt die Familie?</SectionLabel>
          </legend>
          {families.map((family) => (
            <ChoiceTile
              key={family.leadId}
              selected={lead === family.leadId}
              className="items-start px-4 py-3"
            >
              <Radio
                name="contract-family-lead"
                value={family.leadId}
                checked={lead === family.leadId}
                onChange={() => onLeadChange(family.leadId)}
              />
              <span className="min-w-0">
                <span className="block font-medium text-gray-900">
                  {family.members.map(childName).join(", ")}
                </span>
                <span className="block text-sm text-gray-600">
                  Vertrag Nr. {family.leadId}
                  {family.lead.partyName ? ` · ${family.lead.partyName}` : ""}
                  {family.lead.childBirthDate
                    ? ` · geb. ${formatDate(family.lead.childBirthDate)}`
                    : ""}
                </span>
              </span>
            </ChoiceTile>
          ))}
        </fieldset>
        <InsetPanel padding="md">
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
            <li>
              Debitorennummer, Zahlungsweg und SEPA-Mandat der Familie kommen
              vom führenden Vertrag.
            </li>
            <li>
              Hat nur ein Kind ein SEPA-Mandat? Dann wähle seinen Vertrag. Das
              Mandat der anderen Verträge gilt nicht, solange sie in der Familie
              sind.
            </li>
            <li>
              Was bei den anderen Verträgen steht, bleibt gespeichert. Es gilt
              wieder, wenn du ein Kind aus der Familie löst.
            </li>
            <li>Eine Debitorennummer pro Kind bleibt beim Kind.</li>
            <li>Ausgestellte Rechnungen ändern sich nicht.</li>
          </ul>
        </InsetPanel>
      </div>
    </ConfirmationModal>
  );
}
