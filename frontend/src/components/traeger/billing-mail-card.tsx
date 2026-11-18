"use client";

// Der Versand der Bestätigungsschreiben eines Laufs (#4670): jede Familie
// bekommt ihr Schreiben als PDF im Anhang einer Mail, an alle auf einmal
// oder einzeln. Je Familie steht, ob die Mail raus ist; eine Mail, die nicht
// ankam, lässt sich über das Menü ihrer Zeile erneut senden. Alle Schreiben
// lassen sich in einer Datei drucken, für Familien ohne E-Mail. Aufbau wie
// der Versand der übrigen Läufe (#7406).

import { useState } from "react";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import {
  type OverflowMenuItem,
  OverflowMenu,
} from "~/components/ui/page-header/OverflowMenu";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { downloadBlob } from "~/lib/file-download";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import {
  REFRESH_WHILE_QUEUED_MS,
  traegerBillingRunKeys,
} from "~/lib/swr/traeger-billing-run-keys";
import {
  fetchLetterMailings,
  type LetterMailing,
  type LetterSeries,
  mailBillingLetter,
  mailBillingLetters,
  printBillingLetters,
} from "~/lib/traeger-billing-api";
import { BILLING_DOCUMENT_KIND_LABELS } from "./billing-format";
import { canSendMail, letterSendCounts } from "./billing-mail-status";
import { LetterDeliveryCard } from "./letter-delivery-card";
import { LetterSendCell } from "./letter-send-cell";
import { type LetterSendCounts, lettersToSend } from "./letter-send-state";
import { useTraegerResource } from "./use-traeger-resource";

const logger = createLogger({ component: "BillingMailCard" });

function seriesMessage(series: LetterSeries): string {
  const parts: string[] = [];
  if (series.queued > 0) {
    parts.push(
      series.queued === 1
        ? "1 Mail wird jetzt gesendet."
        : `${series.queued} Mails werden jetzt gesendet.`,
    );
  } else {
    parts.push("Es gab keine neue Mail zu senden.");
  }
  if (series.withoutEmail > 0) {
    parts.push(
      series.withoutEmail === 1
        ? "1 Familie hat keine Mail-Adresse: Bitte drucke ihr Schreiben."
        : `${series.withoutEmail} Familien haben keine Mail-Adresse: Bitte drucke deren Schreiben.`,
    );
  }
  return parts.join(" ");
}

/** Why „An alle senden“ has nothing to send. */
function sendAllBlockReason(summary: LetterSendCounts): string {
  if (summary.letters === 0) return "Es gibt noch kein Schreiben zum Senden.";
  if (summary.notSent > 0) {
    return "Den übrigen Familien fehlt eine Mail-Adresse. Drucke deren Schreiben.";
  }
  return "Alle Schreiben mit Mail-Adresse sind schon gesendet.";
}

/** „Storno FE-0004“; an invoice goes by its number alone. */
function letterName(mailing: LetterMailing): string {
  return mailing.kind === "cancellation" || mailing.kind === "credit"
    ? `${BILLING_DOCUMENT_KIND_LABELS[mailing.kind]} ${mailing.number}`
    : mailing.number;
}

function rowMenuItems(
  mailing: LetterMailing,
  busy: boolean,
  onSend: (mailing: LetterMailing) => void,
): OverflowMenuItem[] {
  if (busy || !canSendMail(mailing)) return [];
  return [
    {
      label: mailing.status === "not_sent" ? "Senden" : "Erneut senden",
      description:
        mailing.status === "not_sent"
          ? "Sendet der Familie sofort ihr Schreiben per Mail."
          : "Sendet der Familie sofort ihr Schreiben noch einmal per Mail.",
      onClick: () => onSend(mailing),
    },
  ];
}

function mailColumns(
  busy: boolean,
  onSend: (mailing: LetterMailing) => void,
): DataTableColumn<LetterMailing>[] {
  return [
    {
      key: "family",
      header: "Familie",
      stacked: "title",
      render: (mailing) => (
        <div className="min-w-0">
          <p className="font-medium text-gray-900">
            {mailing.recipientFirstName} {mailing.recipientLastName}
          </p>
          <p className="text-xs break-all text-gray-600">
            {mailing.recipientEmail || "Keine Mail-Adresse"}
          </p>
        </div>
      ),
    },
    {
      key: "letter",
      header: "Schreiben",
      stacked: "field",
      className: "tabular-nums text-gray-900",
      render: letterName,
    },
    {
      key: "send",
      header: "An die Familie",
      stacked: "field",
      className: "w-56 align-top",
      render: (mailing) => (
        <LetterSendCell
          letter={mailing}
          printInstruction="Bitte drucke das Schreiben."
        />
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      stacked: "meta",
      stackedLabel: false,
      className: "align-top",
      render: (mailing) => {
        const items = rowMenuItems(mailing, busy, onSend);
        return items.length > 0 ? (
          <OverflowMenu
            ariaLabel={`Aktionen für das Schreiben an ${mailing.recipientFirstName} ${mailing.recipientLastName}`}
            triggerSize="sm"
            items={items}
          />
        ) : null;
      },
    },
  ];
}

export function BillingMailCard({ runId }: Readonly<{ runId: string }>) {
  // While a mail waits, the card looks again until it is sent or failed.
  const {
    data: mailings,
    error: loadError,
    reload: refresh,
  } = useTraegerResource(
    traegerBillingRunKeys.letterMailings(runId),
    () => fetchLetterMailings(runId),
    "der Versand per Mail",
    {
      refreshInterval: (latest) =>
        latest?.some((mailing) => mailing.status === "queued")
          ? REFRESH_WHILE_QUEUED_MS
          : 0,
    },
  );
  const [sendingAll, setSendingAll] = useState(false);
  const [sendingOne, setSendingOne] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const actionErrors = useApiErrorDisplay();
  const { success } = useToast();
  const invalidateFamily = useInvalidateFamily();
  // The history of an invoice lists its mails.
  const refreshAfterSend = () => {
    refresh();
    void invalidateFamily(traegerBillingRunKeys.invoiceHistoryFamily);
  };

  const sendAll = async () => {
    setSendingAll(true);
    try {
      success(seriesMessage(await mailBillingLetters(runId)));
    } catch (err) {
      logger.error("traeger_letter_series_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void actionErrors.show(err, { object: "die Mails" });
    } finally {
      setSendingAll(false);
      refreshAfterSend();
    }
  };

  const sendOne = async (mailing: LetterMailing) => {
    setSendingOne(mailing.documentId);
    try {
      await mailBillingLetter(runId, mailing.documentId);
      success(
        `Die Mail an Familie ${mailing.recipientLastName} wird jetzt gesendet.`,
      );
    } catch (err) {
      logger.error("traeger_letter_mail_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void actionErrors.show(err, { object: "die Mail" });
    } finally {
      setSendingOne(null);
      refreshAfterSend();
    }
  };

  const print = async () => {
    setPrinting(true);
    try {
      const file = await printBillingLetters(runId);
      downloadBlob(file.blob, file.filename);
    } catch (err) {
      logger.error("traeger_letters_print_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void actionErrors.show(err, { object: "das Senden der Schreiben" });
    } finally {
      setPrinting(false);
    }
  };

  const summary = mailings ? letterSendCounts(mailings) : null;
  const toSend = summary ? lettersToSend(summary) : 0;

  return (
    <LetterDeliveryCard
      title="Versand per Mail"
      description="Jede Familie bekommt ihr Schreiben als PDF im Anhang einer Mail. Hat sie mit dieser Adresse ein Konto in der Eltern-App, liegt es auch dort unter „Dokumente“. Familien ohne E-Mail gibst du das gedruckte Schreiben."
      summary={summary}
      loadError={loadError}
      printAriaLabel="Schreiben drucken"
      printItems={[
        {
          label: "Alle Schreiben drucken",
          description: "Lädt alle Schreiben in einer PDF zum Drucken herunter",
          onClick: () => void print(),
        },
      ]}
      printing={printing}
      sendAll={{
        sending: sendingAll,
        disabledReason: summary ? sendAllBlockReason(summary) : "",
        tooltip:
          "moto fragt vorher nach, dann gehen die Schreiben per Mail an die Familien.",
        confirmText:
          toSend === 1 ? "1 Schreiben senden" : `${toSend} Schreiben senden`,
        confirmBody: (
          <>
            <p>
              {toSend === 1
                ? "1 Schreiben geht jetzt per Mail an die Familie."
                : `${toSend} Schreiben gehen jetzt per Mail an die Familien.`}{" "}
              Mit einem Konto in der Eltern-App liegt es auch dort unter
              „Dokumente“.
            </p>
            {summary && summary.withoutEmail > 0 ? (
              <p>
                {summary.withoutEmail === 1
                  ? "1 Familie ohne Mail-Adresse bekommt nichts."
                  : `${summary.withoutEmail} Familien ohne Mail-Adresse bekommen nichts.`}{" "}
                Drucke deren Schreiben über „Drucken“.
              </p>
            ) : null}
          </>
        ),
        onConfirm: sendAll,
      }}
    >
      <p className="text-sm text-gray-700">
        „An alle senden“ schickt nur Mails, die noch nicht gesendet sind.
        {summary && summary.failed > 0
          ? " Kam eine Mail nicht an, sende sie über das Menü ihrer Zeile erneut. Stimmt die Adresse nicht, drucke das Schreiben."
          : null}
      </p>
      {mailings ? (
        <DataTable
          columns={mailColumns(
            sendingOne !== null || sendingAll,
            (mailing) => void sendOne(mailing),
          )}
          rows={[...mailings]}
          getRowKey={(mailing) => mailing.documentId}
          stackedOnMobile
          caption="Jede Zeile ist das Schreiben an eine Familie."
        />
      ) : null}
    </LetterDeliveryCard>
  );
}
