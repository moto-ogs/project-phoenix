"use client";

// Schreiben und Versand eines freigegebenen Monatslaufs (#4684): die
// Schreiben an die Familien erstellen, per E-Mail und in die Eltern-App
// senden, drucken und eine Rechnung stornieren. Ein neuer Lauf für denselben
// Monat stellt eine stornierte Rechnung neu aus. Die Seite des Laufs zeigt
// davon nur den Stand, damit sie diesen Code nicht lädt.

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  BillingCorrectionModal,
  type BillingCorrectionTarget,
} from "~/components/traeger/billing-correction-modal";
import {
  CARE_RUN_STATUS_LABELS,
  CARE_RUN_STATUS_TONES,
  formatMonth,
} from "~/components/traeger/care-billing-format";
import { CareLetterPanel } from "~/components/traeger/care-letter-panel";
import {
  CareLettersCard,
  familyCount,
} from "~/components/traeger/care-letters-card";
import { careLetterKey } from "~/components/traeger/care-run-invoices";
import { CareRunLetterInvoices } from "~/components/traeger/care-run-letter-invoices";
import { formatEuro } from "~/components/traeger/contribution-format";
import { useRefusalGuard } from "~/components/traeger/use-traeger-confirmed-resource";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { downloadBlob } from "~/lib/file-download";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { useSWRRequestGuard } from "~/lib/swr/hooks";
import {
  REFRESH_WHILE_QUEUED_MS,
  traegerBillingRunKeys,
} from "~/lib/swr/traeger-billing-run-keys";
import {
  type CareLetterMailing,
  type CareLetterSeries,
  downloadCareLetter,
  fetchCareLetters,
  fetchCareRun,
  fetchCareRuns,
  mailCareLetter,
  mailCareLetters,
  printCareLetters,
  startCareRun,
} from "~/lib/traeger-care-billing-api";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerCareRunLettersPage" });

/** The success toast of „An alle senden“. */
function seriesMessage(series: CareLetterSeries): string {
  const parts = [
    series.queued === 0
      ? "Es gab kein neues Schreiben zu senden."
      : series.queued === 1
        ? "1 Schreiben wird jetzt gesendet."
        : `${series.queued} Schreiben werden jetzt gesendet.`,
  ];
  if (series.withoutEmail > 0) {
    parts.push(
      `${familyCount(series.withoutEmail)} ohne E-Mail-Adresse: Bitte drucke deren Schreiben.`,
    );
  }
  if (series.recipientChanged > 0) {
    parts.push(
      `${series.recipientChanged === 1 ? "1 Schreiben ging" : `${series.recipientChanged} Schreiben gingen`} nicht raus: Die Person steht nicht mehr im Vertrag. Storniere diese Rechnung. Ein neuer Lauf stellt sie neu aus.`,
    );
  }
  return parts.join(" ");
}

export default function TraegerCareRunLettersPage() {
  const params = useParams<{ id: string }>();
  const runId = params?.id ?? "";
  const runPath = traegerPath(`/traeger/abrechnung/monatsbeitraege/${runId}`);
  const {
    data: run,
    loading,
    error: loadError,
  } = useTraegerResource(
    runId ? traegerBillingRunKeys.careRun(runId) : null,
    () => fetchCareRun(runId),
    "der Monatslauf",
  );
  const actionErrors = useApiErrorDisplay();
  const { success } = useToast();
  const router = useRouter();
  const invalidateFamily = useInvalidateFamily();
  const [sendingAll, setSendingAll] = useState(false);
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [printing, setPrinting] = useState<"all" | "without_email" | null>(
    null,
  );
  const [shownLetter, setShownLetter] = useState<CareLetterMailing | null>(
    null,
  );
  const [cancelling, setCancelling] = useState<BillingCorrectionTarget | null>(
    null,
  );
  const [reissuing, setReissuing] = useState(false);

  const released = run?.status === "released";
  // A mail on its way: look again until it is sent or failed.
  const {
    data: letters,
    error: lettersError,
    mutate: mutateLetters,
    reload: loadLetters,
  } = useTraegerResource(
    released ? traegerBillingRunKeys.careLetters(runId) : null,
    () => fetchCareLetters(runId),
    "die Liste der Schreiben",
    {
      refreshInterval: (latest) =>
        (latest?.summary.queued ?? 0) > 0 ? REFRESH_WHILE_QUEUED_MS : 0,
    },
  );
  // Letter and cancellation belong to the list: without it (refused), both
  // close.
  const openLetter = letters ? shownLetter : null;
  const openCancel = letters ? cancelling : null;
  // A fresh list that rejects on failure, for the steps that need it.
  const lettersGuard = useRefusalGuard(
    released ? traegerBillingRunKeys.careLetters(runId) : null,
  );
  const beginLettersRead = useSWRRequestGuard();
  const fetchLetters = () =>
    mutateLetters(
      async () => {
        const complete = beginLettersRead(
          released ? traegerBillingRunKeys.careLetters(runId) : null,
        );
        try {
          const next = await fetchCareLetters(runId);
          complete(() => lettersGuard.callbacks.onSuccess());
          return next;
        } catch (error) {
          complete(() => lettersGuard.callbacks.onError(error));
          throw error;
        }
      },
      { revalidate: false },
    );
  // Nach dem Drucken laden die Schreiben nach; ein Fehler dabei ist ein
  // Ladefehler, kein Fehler des Druckens (#6652).
  const printAfterWrite = useRefreshAfterWrite(
    "die Anzeige der Schreiben",
    fetchLetters,
  );

  const sendAll = async () => {
    setSendingAll(true);
    try {
      success(seriesMessage(await mailCareLetters(runId)));
    } catch (err) {
      logger.error("traeger_care_letters_mail_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void actionErrors.show(err, { object: "das Senden der Schreiben" });
    } finally {
      setSendingAll(false);
      loadLetters();
    }
  };

  const sendOne = async (letter: CareLetterMailing) => {
    setSendingKey(careLetterKey(letter));
    try {
      await mailCareLetter(runId, letter.invoiceId, letter.kind);
      success(
        `Das Schreiben an ${letter.recipientFirstName} ${letter.recipientLastName} wird jetzt gesendet.`,
      );
    } catch (err) {
      logger.error("traeger_care_letter_mail_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void actionErrors.show(err, { object: "das Schreiben" });
    } finally {
      setSendingKey(null);
      loadLetters();
    }
  };

  const print = async (withoutEmailOnly: boolean) => {
    setPrinting(withoutEmailOnly ? "without_email" : "all");
    try {
      const file = await printCareLetters(runId, withoutEmailOnly);
      downloadBlob(file.blob, file.filename);
    } catch (err) {
      logger.error("traeger_care_letters_print_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void actionErrors.show(err, { object: "die Druckfassung der Schreiben" });
      setPrinting(null);
      return;
    }
    setPrinting(null);
    await printAfterWrite.refresh();
  };

  // A cancelled invoice is issued again by the run of its month that is
  // still a preview; without one, a new run starts.
  const reissue = async () => {
    if (!run) return;
    setReissuing(true);
    try {
      // Another tab may already have released the replacement.
      const latest = await fetchLetters();
      if (!latest) return;
      const cancelled = new Set(
        latest.documents
          .filter(
            (document) =>
              document.kind === "cancellation" && !document.replaced,
          )
          .map((document) => document.invoiceId),
      );
      if (cancelled.size === 0) return;
      const schoolIds = [
        ...new Set(
          run.invoices
            .filter((invoice) => cancelled.has(invoice.id))
            .map((invoice) => invoice.schoolId),
        ),
      ];
      if (schoolIds.length === 0)
        throw new Error("Cancelled invoices have no school in the run");
      // Work through existing previews first, even if they cover only
      // part of the outstanding cancellations. The remaining schools
      // keep offering reissue after that preview has been released.
      const findOpen = async () =>
        (await fetchCareRuns()).runs.find(
          (other) =>
            other.status === "calculated" &&
            other.billingMonth === run.billingMonth &&
            schoolIds.some((id) => other.schoolIds.includes(id)),
        );
      let target = await findOpen();
      if (!target) {
        try {
          target = await startCareRun({
            billingMonth: run.billingMonth,
            schoolIds,
            invoiceDate: null,
          });
          // The list of runs and the start dialog's open run per school.
          void invalidateFamily(traegerBillingRunKeys.careRunsFamily);
        } catch (err) {
          if (
            !(err instanceof ApiError) ||
            err.code !== "parent_billing.care_run_open"
          )
            throw err;
          // A parallel start may have reserved one of these schools.
          target = await findOpen();
          if (!target) throw err;
        }
      }
      router.push(
        traegerPath(`/traeger/abrechnung/monatsbeitraege/${target.id}`),
      );
    } catch (err) {
      logger.error("traeger_care_reissue_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void actionErrors.show(err, { object: "der neue Lauf" });
    } finally {
      setReissuing(false);
    }
  };

  const cancelledCount =
    letters?.documents.filter(
      (document) => document.kind === "cancellation" && !document.replaced,
    ).length ?? 0;

  return (
    <TenantPage
      title={
        run ? `Schreiben für ${formatMonth(run.billingMonth)}` : "Schreiben"
      }
      back
      backHref={runPath}
      backLabel="Zurück zum Monatslauf"
      stats={
        run ? (
          <TenantPageStats
            items={[
              {
                value: run.previewCount,
                label: run.previewCount === 1 ? "Rechnung" : "Rechnungen",
              },
              { value: formatEuro(run.previewCents), label: "" },
            ]}
          />
        ) : null
      }
      actions={
        <>
          {run ? (
            <StatusBadge
              label={CARE_RUN_STATUS_LABELS[run.status]}
              tone={CARE_RUN_STATUS_TONES[run.status]}
            />
          ) : null}
        </>
      }
      statsLoading={loading}
      error={loadError}
      loading={loading}
      empty={
        run && !released
          ? {
              title: "Noch nicht freigegeben",
              description:
                "Schreiben gibt es erst, wenn der Monatslauf freigegeben ist. Gib ihn auf der Seite des Laufs frei.",
            }
          : null
      }
      overlays={
        run && released ? (
          <>
            <CareLetterPanel
              letter={openLetter}
              title={
                openLetter
                  ? `${openLetter.kind === "cancellation" ? "Storno" : "Rechnung"} ${openLetter.number}`
                  : ""
              }
              fileKey={
                openLetter ? `${openLetter.kind}-${openLetter.invoiceId}` : ""
              }
              load={(letter) =>
                downloadCareLetter(run.id, letter.invoiceId, letter.kind)
              }
              onClose={() => setShownLetter(null)}
            />
            <BillingCorrectionModal
              runId={run.id}
              target={openCancel}
              onClose={() => setCancelling(null)}
              onCareCancelled={(next) => {
                setCancelling(null);
                void mutateLetters(next, { revalidate: false });
              }}
            />
          </>
        ) : null
      }
    >
      {run && released ? (
        <>
          <CareLettersCard
            runId={run.id}
            payments={run.invoices.map((invoice) => invoice.payment)}
            letters={letters}
            loadError={lettersError ?? printAfterWrite.error}
            sendingAll={sendingAll}
            printing={printing}
            onCreated={(next) =>
              void mutateLetters(next, { revalidate: false })
            }
            onSendAll={sendAll}
            onPrint={(withoutEmailOnly) => void print(withoutEmailOnly)}
          />
          {cancelledCount > 0 ? (
            <Alert
              type="info"
              title={
                cancelledCount === 1
                  ? "1 Rechnung ist storniert"
                  : `${cancelledCount} Rechnungen sind storniert`
              }
              message={`Ein neuer Monatslauf für ${formatMonth(run.billingMonth)} stellt sie neu aus. Er zeigt sie zuerst als Vorschau.`}
              action={
                <Button
                  type="button"
                  variant="surface"
                  size="compact"
                  isLoading={reissuing}
                  loadingText="Wird geöffnet …"
                  tooltip="Öffnet den offenen Lauf dieses Monats oder startet einen neuen."
                  onClick={() => void reissue()}
                >
                  Neu ausstellen
                </Button>
              }
            />
          ) : null}
          {letters ? (
            <CareRunLetterInvoices
              invoices={run.invoices}
              month={run.billingMonth}
              letterActions={{
                letters: letters.documents,
                created: letters.letters !== null,
                sendingKey,
                onShowLetter: setShownLetter,
                onSend: (letter) => void sendOne(letter),
                onCancel: (invoice) =>
                  setCancelling({ kind: "care-cancellation", invoice }),
              }}
            />
          ) : null}
        </>
      ) : null}
    </TenantPage>
  );
}
