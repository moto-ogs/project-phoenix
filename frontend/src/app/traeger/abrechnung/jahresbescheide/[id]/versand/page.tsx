"use client";

import { bffFile } from "~/lib/bff-fetch";

// Versand der Jahresbescheide eines ausgestellten Laufs (#6347): moto
// speichert jeden Bescheid einmal als PDF. Dieses Original geht per E-Mail an
// die Familie und liegt danach in der Eltern-App unter „Dokumente“, aber erst,
// wenn das Büro sendet. Die Seite des Laufs lädt diesen Code nicht.

import { useParams } from "next/navigation";
import { useState } from "react";
import { CareLetterPanel } from "~/components/traeger/care-letter-panel";
import {
  NOTICE_KIND_LABELS,
  NOTICE_KIND_TONES,
} from "~/components/traeger/care-notice-format";
import { canSendMail } from "~/components/traeger/billing-mail-status";
import { formatEuro } from "~/components/traeger/contribution-format";
import { LetterSendCell } from "~/components/traeger/letter-send-cell";
import { LetterDeliveryCard } from "~/components/traeger/letter-delivery-card";
import {
  traegerExportScope,
  useTraegerListExportItems,
} from "~/components/traeger/traeger-list-export-menu";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { lettersToSend } from "~/components/traeger/letter-send-state";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import {
  type OverflowMenuItem,
  OverflowMenu,
} from "~/components/ui/page-header/OverflowMenu";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { formatBerlinDate } from "~/lib/date-helpers";
import { downloadBlob } from "~/lib/file-download";
import { createLogger } from "~/lib/logger";
import {
  REFRESH_WHILE_QUEUED_MS,
  traegerBillingRunKeys,
} from "~/lib/swr/traeger-billing-run-keys";
import {
  downloadTraegerList,
  listExportQuery,
} from "~/lib/traeger-list-export";
import {
  type CareNoticeLetterSummary,
  type CareNoticeMailing,
  type CareNoticeSeries,
  createCareNoticeLetters,
  downloadCareNoticePDF,
  fetchCareNoticeLetters,
  mailCareNoticeLetter,
  mailCareNoticeLetters,
  printCareNoticeLetters,
} from "~/lib/traeger-care-notice-letters-api";
import { fetchCareNoticeRun } from "~/lib/traeger-care-notices-api";
import { traegerPath } from "~/lib/traeger-url";
import { labelOf } from "~/lib/label-of";

const logger = createLogger({ component: "TraegerCareNoticeDeliveryPage" });

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** „1 Familie“ / „3 Familien“. */
function familyCount(count: number): string {
  return count === 1 ? "1 Familie" : `${count} Familien`;
}

/** The notices „An alle senden“ sends: stored, unsent, with an address. */
function noticesToSend(summary: CareNoticeLetterSummary): number {
  return lettersToSend(summary);
}

/** Why „An alle senden“ has nothing to send, in the order of the page's notes. */
function sendAllBlockReason(
  summary: CareNoticeLetterSummary,
  missing: number,
): string {
  if (summary.queued > 0) return "Die Bescheide werden gerade gesendet.";
  if (summary.failed > 0) {
    return "Nicht angekommene Bescheide sendest du über das Menü ihrer Zeile erneut.";
  }
  if (missing > 0) return "Speichere zuerst die übrigen Originale.";
  if (summary.notSent > 0) {
    return "Den übrigen Familien fehlt eine E-Mail-Adresse. Drucke deren Bescheid.";
  }
  return "Alle Bescheide mit E-Mail-Adresse sind schon gesendet.";
}

/** The success toast of „An alle senden“. */
function seriesMessage(series: CareNoticeSeries): string {
  const parts = [
    series.queued === 0
      ? "Es gab keinen neuen Bescheid zu senden."
      : series.queued === 1
        ? "1 Bescheid wird jetzt gesendet."
        : `${series.queued} Bescheide werden jetzt gesendet.`,
  ];
  if (series.withoutEmail > 0) {
    parts.push(
      `${familyCount(series.withoutEmail)} ohne E-Mail-Adresse: Bitte drucke deren Bescheid.`,
    );
  }
  if (series.recipientChanged > 0) {
    parts.push(
      `${series.recipientChanged === 1 ? "1 Bescheid ging" : `${series.recipientChanged} Bescheide gingen`} nicht raus: Die Person zahlt nicht mehr für diesen Vertrag. Drucke diesen Bescheid und gib ihn der Familie auf Papier.`,
    );
  }
  return parts.join(" ");
}

/** „An die Familie“: what reached the family. */
function SendCell({ notice }: Readonly<{ notice: CareNoticeMailing }>) {
  if (!notice.hasLetter) {
    return <p className="text-sm text-gray-600">Noch kein Original</p>;
  }
  return (
    <LetterSendCell
      letter={notice}
      printInstruction="Bitte drucke den Bescheid."
    />
  );
}

interface RowActions {
  readonly sendingContract: string | null;
  readonly onShow: (notice: CareNoticeMailing) => void;
  readonly onSend: (notice: CareNoticeMailing) => void;
}

function rowMenuItems(
  notice: CareNoticeMailing,
  actions: RowActions,
): OverflowMenuItem[] {
  if (!notice.hasLetter) return [];
  const items: OverflowMenuItem[] = [
    {
      label: "Original ansehen",
      description: "Öffnet das gespeicherte PDF des Bescheids",
      onClick: () => actions.onShow(notice),
    },
  ];
  if (canSendMail(notice) && actions.sendingContract === null) {
    items.push({
      label: notice.sends === 0 ? "Senden" : "Erneut senden",
      description:
        notice.sends === 0
          ? notice.inInbox
            ? "Sendet sofort an die Familie, per E-Mail und in die Eltern-App"
            : "Sendet sofort per E-Mail an die Familie, nicht in die Eltern-App"
          : "Sendet sofort noch einmal an dieselbe Adresse",
      onClick: () => actions.onSend(notice),
    });
  }
  return items;
}

function noticeColumns(
  actions: RowActions,
): DataTableColumn<CareNoticeMailing>[] {
  return [
    {
      key: "child",
      header: "Kind",
      stacked: "title",
      render: (notice) => (
        <div className="min-w-0">
          <p className="font-medium text-gray-900">
            {notice.childFirstName} {notice.childLastName}
          </p>
          <p className="text-xs text-gray-600">{notice.schoolName}</p>
        </div>
      ),
    },
    {
      key: "notice",
      header: "Bescheid",
      stacked: "field",
      render: (notice) => (
        <div className="flex min-w-0 flex-col items-start gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              label={labelOf(NOTICE_KIND_LABELS, notice.kind, "Bescheid")}
              tone={labelOf(NOTICE_KIND_TONES, notice.kind, "gray")}
            />
            <span className="text-sm text-gray-900 tabular-nums">
              {notice.number}
            </span>
          </div>
          {notice.amendsNumber ? (
            <p className="text-xs text-gray-600">
              Ändert Bescheid {notice.amendsNumber}
            </p>
          ) : null}
          {notice.amendedByNumber ? (
            <p className="text-xs text-gray-600">
              Geändert durch {notice.amendedByNumber}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "recipient",
      header: "Empfänger",
      stacked: "field",
      render: (notice) => (
        <div className="min-w-0">
          <p className="text-sm text-gray-900">
            {notice.recipientFirstName} {notice.recipientLastName}
          </p>
          <p className="text-xs break-all text-gray-600">
            {notice.recipientEmail || "Keine E-Mail-Adresse"}
          </p>
        </div>
      ),
    },
    {
      key: "total",
      header: "Gesamtbetrag",
      align: "right",
      stacked: "field",
      className: "tabular-nums font-medium text-gray-900",
      render: (notice) => formatEuro(notice.totalCents),
    },
    {
      key: "send",
      header: "An die Familie",
      stacked: "field",
      className: "w-56 align-top",
      render: (notice) => <SendCell notice={notice} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      stacked: "meta",
      stackedLabel: false,
      className: "align-top",
      render: (notice) => {
        const items = rowMenuItems(notice, actions);
        return items.length > 0 ? (
          <OverflowMenu
            ariaLabel={`Aktionen für den Bescheid von ${notice.childFirstName} ${notice.childLastName}`}
            triggerSize="sm"
            items={items}
          />
        ) : null;
      },
    },
  ];
}

/** Was die Seite ist und was man dort zuerst tut (#7596). */
const NOTICE_DISPATCH_INFO =
  "Hier sendest du die Jahresbescheide an die Familien. Das geht erst, wenn der Jahreslauf ausgestellt ist. Dann speicherst du die Originale und wählst „An alle senden“.";

export default function TraegerCareNoticeDeliveryPage() {
  const params = useParams<{ id: string }>();
  const runId = params?.id ?? "";
  const runPath = traegerPath(`/traeger/abrechnung/jahresbescheide/${runId}`);
  const {
    data: run,
    loading,
    error: loadError,
  } = useTraegerResource(
    runId ? traegerBillingRunKeys.noticeRun(runId) : null,
    () => fetchCareNoticeRun(runId),
    "der Jahreslauf",
  );
  const actionErrors = useApiErrorDisplay();
  const { success } = useToast();
  const [creating, setCreating] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);
  const [sendingContract, setSendingContract] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [shown, setShown] = useState<CareNoticeMailing | null>(null);

  const released = run?.status === "released" && run.previewCount > 0;
  // A mail on its way: look again until it is sent or failed.
  const {
    data: letters,
    error: lettersError,
    mutate: mutateLetters,
    reload: loadLetters,
  } = useTraegerResource(
    released ? traegerBillingRunKeys.noticeLetters(runId) : null,
    () => fetchCareNoticeLetters(runId),
    "die Bescheide",
    {
      refreshInterval: (latest) =>
        (latest?.summary.queued ?? 0) > 0 ? REFRESH_WHILE_QUEUED_MS : 0,
    },
  );

  const create = async () => {
    setCreating(true);
    try {
      await mutateLetters(await createCareNoticeLetters(runId), {
        revalidate: false,
      });
      success("Die Originale sind gespeichert. Gesendet ist noch nichts.");
    } catch (err) {
      logger.error("traeger_care_notice_letters_create_failed", {
        error: errorMessage(err),
      });
      void actionErrors.show(err, { object: "die Originale" });
      loadLetters();
    } finally {
      setCreating(false);
    }
  };

  const sendAll = async () => {
    setSendingAll(true);
    try {
      success(seriesMessage(await mailCareNoticeLetters(runId)));
    } catch (err) {
      logger.error("traeger_care_notice_letters_mail_failed", {
        error: errorMessage(err),
      });
      void actionErrors.show(err, { object: "die Bescheide" });
    } finally {
      setSendingAll(false);
      loadLetters();
    }
  };

  const sendOne = async (notice: CareNoticeMailing) => {
    setSendingContract(notice.contractId);
    try {
      await mailCareNoticeLetter(runId, notice.contractId);
      success(
        `Der Bescheid an ${notice.recipientFirstName} ${notice.recipientLastName} wird jetzt gesendet.`,
      );
    } catch (err) {
      logger.error("traeger_care_notice_letter_mail_failed", {
        error: errorMessage(err),
      });
      void actionErrors.show(err, { object: "der Bescheid" });
    } finally {
      setSendingContract(null);
      loadLetters();
    }
  };

  const print = async (withoutEmailOnly: boolean) => {
    setPrinting(true);
    try {
      const file = await printCareNoticeLetters(runId, withoutEmailOnly);
      downloadBlob(file.blob, file.filename);
    } catch (err) {
      logger.error("traeger_care_notice_letters_print_failed", {
        error: errorMessage(err),
      });
      void actionErrors.show(err, { object: "die Bescheide" });
    } finally {
      setPrinting(false);
    }
  };

  const summary = letters?.summary;
  const missing = summary ? summary.notices - summary.letters : 0;
  const toSend = summary ? noticesToSend(summary) : 0;
  const printItems = [
    {
      label: "Alle Bescheide drucken",
      description: "Alle gespeicherten Originale in einer Datei",
      onClick: () => void print(false),
    },
    ...(summary && summary.withoutEmail > 0
      ? [
          {
            label: "Nur Familien ohne E-Mail",
            description: `${familyCount(summary.withoutEmail)} ohne E-Mail-Adresse`,
            onClick: () => void print(true),
          },
        ]
      : []),
  ];

  const exportItems = useTraegerListExportItems({
    download: (format) =>
      downloadTraegerList(
        bffFile("org", "GET /traeger/care-notice-runs/{id}/letters/export", {
          params: { id: runId },
          query: listExportQuery(format),
        }),
      ),
    scope: traegerExportScope(),
    fallbackName: `bescheid-versand-${run?.year ?? ""}`,
    errorObject: "die Versandliste",
    unavailable: !letters || letters.notices.length === 0,
  });

  return (
    <TenantPage
      info={NOTICE_DISPATCH_INFO}
      title={run ? `Versand der Jahresbescheide ${run.year}` : "Versand"}
      back
      backHref={runPath}
      backLabel="Zurück zum Jahreslauf"
      stats={
        run ? (
          <TenantPageStats
            items={[
              {
                value: run.previewCount,
                label: run.previewCount === 1 ? "Bescheid" : "Bescheide",
              },
              { value: formatEuro(run.previewCents), label: "" },
              ...(run.issuedOn
                ? [
                    {
                      label: `Ausgestellt am ${formatBerlinDate(run.issuedOn)}`,
                    },
                  ]
                : []),
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      overflowMenu={run && released ? exportItems : undefined}
      empty={
        run && !released
          ? {
              title: "Noch nicht ausgestellt",
              description:
                "Versenden kannst du erst ausgestellte Bescheide. Stelle sie auf der Seite des Jahreslaufs aus.",
            }
          : null
      }
      error={loadError}
      loading={loading}
      overlays={
        run && summary ? (
          <>
            <CareLetterPanel
              letter={shown}
              title={
                shown
                  ? `${labelOf(NOTICE_KIND_LABELS, shown.kind, "Bescheid")} ${shown.number}`
                  : ""
              }
              fileKey={shown ? `notice-${shown.noticeId}` : ""}
              load={(notice) =>
                downloadCareNoticePDF(run.id, notice.contractId)
              }
              onClose={() => setShown(null)}
            />
          </>
        ) : null
      }
    >
      {released && lettersError && summary?.letters === 0 ? (
        <SectionCard title="Versand an die Familien">
          <LoadErrorAlert error={lettersError} actionLayout="responsive" />
        </SectionCard>
      ) : null}
      {released && summary && missing > 0 ? (
        <SectionCard
          title="Originale speichern"
          description="moto speichert jeden Bescheid einmal als PDF. Dieses Original bleibt gleich, auch wenn sich später Briefkopf, Vorlage, Adresse oder Vertrag ändern. Gesendet wird dabei noch nichts."
          action={
            <Button
              type="button"
              variant="primary"
              size="md"
              isLoading={creating}
              loadingText="Wird gespeichert …"
              tooltip="Speichert jeden Bescheid als PDF, gesendet wird noch nichts."
              onClick={() => void create()}
            >
              {missing === 1
                ? "1 Original speichern"
                : `${missing} Originale speichern`}
            </Button>
          }
        />
      ) : null}
      {released && (!summary || summary.letters > 0) ? (
        <LetterDeliveryCard
          title="Versand an die Familien"
          description="Jede Familie bekommt das gespeicherte Original per E-Mail. Hat sie mit dieser Adresse ein Konto in der Eltern-App, liegt es dort unter „Dokumente“. Familien ohne E-Mail gibst du den gedruckten Bescheid."
          summary={summary}
          loadError={lettersError}
          noun={{ one: "Bescheid", many: "Bescheiden", plural: "Bescheide" }}
          print={{
            ariaLabel: "Bescheide drucken",
            items: printItems,
            running: printing,
          }}
          sendAll={{
            sending: sendingAll,
            disabledReason: summary ? sendAllBlockReason(summary, missing) : "",
            confirmText:
              toSend === 1 ? "1 Bescheid senden" : `${toSend} Bescheide senden`,
            confirmBody: (
              <>
                <p>
                  {toSend === 1
                    ? "1 Bescheid geht jetzt per E-Mail an die Familie."
                    : `${toSend} Bescheide gehen jetzt per E-Mail an die Familien.`}{" "}
                  Mit einem Konto in der Eltern-App liegt er auch dort unter
                  „Dokumente“.
                </p>
                {summary && summary.withoutEmail > 0 ? (
                  <p>
                    {familyCount(summary.withoutEmail)} ohne E-Mail-Adresse{" "}
                    {summary.withoutEmail === 1 ? "bekommt" : "bekommen"}{" "}
                    nichts. Drucke deren Bescheid.
                  </p>
                ) : null}
              </>
            ),
            onConfirm: sendAll,
          }}
        >
          <Alert
            type="info"
            title="Keine förmliche Zustellung"
            message="E-Mail und Eltern-App sind kein Nachweis, dass die Familie den Bescheid bekommen hat. Brauchst du einen Nachweis? Dann stelle den Bescheid zusätzlich auf anderem Weg zu."
          />
          {summary && summary.queued > 0 ? (
            <p className="text-sm text-gray-600" role="status">
              {summary.queued === 1
                ? "1 Bescheid wird noch gesendet."
                : `${summary.queued} Bescheide werden noch gesendet.`}{" "}
              Die Seite zeigt den neuen Stand von selbst.
            </p>
          ) : null}
          {summary && summary.failed > 0 ? (
            <p className="text-sm text-gray-600">
              Einige Bescheide sind nicht angekommen. Sende diese über das Menü
              ihrer Zeile erneut oder drucke sie.
            </p>
          ) : null}
          {summary &&
          toSend === 0 &&
          summary.sent > 0 &&
          summary.queued === 0 &&
          summary.failed === 0 &&
          missing === 0 ? (
            <p className="text-sm text-gray-600">
              Alle Bescheide mit E-Mail-Adresse sind gesendet. Einzelne
              Bescheide sendest du erneut über das Menü ihrer Zeile.
            </p>
          ) : null}
        </LetterDeliveryCard>
      ) : null}
      {released && letters ? (
        <DataTable
          columns={noticeColumns({
            sendingContract,
            onShow: setShown,
            onSend: (notice) => void sendOne(notice),
          })}
          rows={[...letters.notices]}
          getRowKey={(notice) => notice.noticeId}
          caption="Jede Zeile ist ein ausgestellter Bescheid mit seinem Original."
          emptyState={
            <EmptyState
              title="Keine Bescheide."
              description="Dieser Jahreslauf hat keinen Bescheid ausgestellt."
            />
          }
        />
      ) : null}
    </TenantPage>
  );
}
