"use client";

// Der Versand der Bestätigungsschreiben eines Laufs (#4670): jede Familie
// bekommt ihr Schreiben als PDF im Anhang einer Mail, an alle auf einmal
// oder einzeln. Je Familie steht, ob die Mail raus ist; eine Mail, die nicht
// ankam, lässt sich erneut senden. Alle Schreiben lassen sich in einer Datei
// drucken, für Familien ohne E-Mail.

import { useState } from "react";
import { Button } from "~/components/ui/button";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { Loading } from "~/components/ui/loading";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
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
import {
  canSendMail,
  mailBadge,
  mailStatusDetail,
} from "./billing-mail-status";
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

  const failed = mailings?.some((mailing) => mailing.status === "failed");

  return (
    <SectionCard
      title="Versand per Mail"
      description="Jede Familie bekommt ihr Schreiben als PDF im Anhang einer Mail. Hat sie mit dieser Adresse ein Konto in der Eltern-App, liegt es auch dort unter „Dokumente“. Familien ohne E-Mail gibst du das gedruckte Schreiben."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="md"
            isLoading={printing}
            loadingText="Wird erstellt …"
            tooltip="Lädt alle Schreiben in einer PDF zum Drucken herunter."
            onClick={() => void print()}
          >
            Alle Schreiben drucken
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            isLoading={sendingAll}
            loadingText="Wird gesendet …"
            disabled={!mailings}
            tooltip="Sendet jeder Familie mit Mail-Adresse sofort ihr noch nicht gesendetes Schreiben."
            onClick={() => void sendAll()}
          >
            An alle Familien senden
          </Button>
        </div>
      }
    >
      {loadError ? (
        <LoadErrorAlert error={loadError} />
      ) : mailings ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            „An alle Familien senden“ schickt nur Mails, die noch nicht gesendet
            sind.
            {failed
              ? " Kam eine Mail nicht an, sende sie erneut. Stimmt die Adresse nicht, drucke das Schreiben."
              : null}
          </p>
          <ul className="divide-y divide-gray-100">
            {mailings.map((mailing) => (
              <li
                key={mailing.documentId}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {mailing.recipientFirstName} {mailing.recipientLastName}
                    <span className="ml-2 font-normal text-gray-500">
                      {mailing.kind === "cancellation" ||
                      mailing.kind === "credit"
                        ? `${BILLING_DOCUMENT_KIND_LABELS[mailing.kind]} ${mailing.number}`
                        : mailing.number}
                    </span>
                  </p>
                  <p className="truncate text-sm text-gray-600">
                    {mailing.recipientEmail ||
                      "Keine Mail-Adresse: Bitte drucke das Schreiben."}
                  </p>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <StatusBadge {...mailBadge(mailing)} />
                  {mailStatusDetail(mailing) ? (
                    <span className="text-sm text-gray-600">
                      {mailStatusDetail(mailing)}
                    </span>
                  ) : null}
                  {canSendMail(mailing) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="compact"
                      isLoading={sendingOne === mailing.documentId}
                      loadingText="Wird gesendet …"
                      disabled={sendingOne !== null || sendingAll}
                      tooltip={
                        mailing.status === "not_sent"
                          ? "Sendet der Familie sofort ihr Schreiben per Mail."
                          : "Sendet der Familie sofort ihr Schreiben noch einmal per Mail."
                      }
                      onClick={() => void sendOne(mailing)}
                    >
                      {mailing.status === "not_sent"
                        ? "Senden"
                        : "Erneut senden"}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Loading />
      )}
    </SectionCard>
  );
}
