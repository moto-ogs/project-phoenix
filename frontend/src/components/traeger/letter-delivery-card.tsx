"use client";

// Der Versand der Schreiben eines Laufs an die Familien (#7406), gleich für
// Ferienlauf, Monatslauf und Jahresbescheid: „Drucken“ als Menü, „An alle
// senden“ mit Nachfrage und der Versandstand. Einzelne Schreiben sendet die
// Liste darunter über das Menü ihrer Zeile erneut.

import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "~/components/ui/button";
import type { FormErrorInput } from "~/components/ui/form-error";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { ConfirmationModal } from "~/components/ui/modal";
import {
  type OverflowMenuItem,
  OverflowMenu,
} from "~/components/ui/page-header/OverflowMenu";
import { SectionCard } from "~/components/ui/section-card";
import {
  type LetterSendCounts,
  LetterSendState,
  lettersToSend,
} from "./letter-send-state";

/** What a run sends, in the words its sentences need. */
export interface LetterNoun {
  /** After „von 1“: „Schreiben“, „Bescheid“. */
  readonly one: string;
  /** After „von N“: „Schreiben“, „Bescheiden“. */
  readonly many: string;
  /** The subject of a sentence: „die offenen Bescheide“. */
  readonly plural: string;
}

const LETTER_NOUN: LetterNoun = {
  one: "Schreiben",
  many: "Schreiben",
  plural: "Schreiben",
};

/** The print menu: all letters in one file, or only some. */
export interface LetterDeliveryPrint {
  /** The name of the menu for screen readers: „Bescheide drucken“. */
  readonly ariaLabel: string;
  readonly items: readonly OverflowMenuItem[];
  /** A print file is being made. */
  readonly running: boolean;
}

export interface LetterDeliverySendAll {
  /** The send to every family runs. */
  readonly sending: boolean;
  /** Why nothing is left to send, shown on the blocked button. */
  readonly disabledReason: string;
  /** The confirm button: „3 Bescheide senden“. */
  readonly confirmText: string;
  /** What the send does, in the question before it. */
  readonly confirmBody: ReactNode;
  /** Sends to every family; the question closes once it settles. */
  readonly onConfirm: () => Promise<void>;
}

/** The card while the letters load, or when they could not be loaded. */
export function LetterDeliveryPending({
  title,
  loadError,
}: Readonly<{ title: string; loadError?: FormErrorInput }>) {
  return loadError ? (
    <SectionCard title={title}>
      <LoadErrorAlert error={loadError} actionLayout="responsive" />
    </SectionCard>
  ) : (
    <SectionCard title={title} loading />
  );
}

export function LetterDeliveryCard({
  title,
  description,
  summary,
  loadError,
  noun = LETTER_NOUN,
  print,
  sendAll,
  children,
}: Readonly<{
  title: string;
  description: string;
  /** null while it loads. */
  summary: LetterSendCounts | null | undefined;
  loadError?: FormErrorInput;
  /** What is sent; „Schreiben“ when unset. */
  noun?: LetterNoun;
  print: LetterDeliveryPrint;
  sendAll: LetterDeliverySendAll;
  /** Notes under the state and the list of letters. */
  children?: ReactNode;
}>) {
  const [confirming, setConfirming] = useState(false);
  // A question about letters that are gone does not come back with them.
  if (!summary && confirming) setConfirming(false);

  // Loaded letters stay when a reload fails; the error stands above them.
  if (!summary) {
    return <LetterDeliveryPending title={title} loadError={loadError} />;
  }

  const toSend = lettersToSend(summary);
  return (
    <SectionCard
      title={title}
      description={description}
      overflow="visible"
      actions={
        <>
          <OverflowMenu
            ariaLabel={print.ariaLabel}
            triggerButton={{ variant: "outline", size: "md" }}
            triggerClassName="gap-2 whitespace-nowrap"
            triggerContent={
              print.running ? (
                "Wird erstellt …"
              ) : (
                <>
                  Drucken
                  <ChevronDown className="h-4 w-4" aria-hidden />
                </>
              )
            }
            disabled={print.running}
            items={print.items}
          />
          <Button
            type="button"
            variant="primary"
            size="md"
            isLoading={sendAll.sending}
            loadingText="Wird gesendet …"
            disabled={toSend === 0}
            disabledReason={sendAll.disabledReason}
            tooltip={`moto fragt vorher nach, dann gehen die offenen ${noun.plural} per E-Mail an die Familien.`}
            onClick={() => setConfirming(true)}
          >
            An alle senden
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {loadError ? (
          <LoadErrorAlert error={loadError} actionLayout="responsive" />
        ) : null}
        <LetterSendState summary={summary} noun={noun} />
        {children}
      </div>
      <ConfirmationModal
        isOpen={confirming}
        title="An alle senden?"
        confirmText={sendAll.confirmText}
        isConfirmLoading={sendAll.sending}
        loadingText="Wird gesendet …"
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          void sendAll.onConfirm().finally(() => setConfirming(false));
        }}
      >
        <div className="space-y-3 text-sm text-gray-700">
          {sendAll.confirmBody}
        </div>
      </ConfirmationModal>
    </SectionCard>
  );
}
