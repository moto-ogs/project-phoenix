"use client";

import { bffFile } from "~/lib/bff-fetch";

// Ein Jahreslauf (#6219): die Vorschau aller Jahresbescheide nach dem
// gültigen Vertrag und der Preisliste, und das Ausstellen, das jedem
// Bescheid seine Nummer gibt. Danach ändern sich die Bescheide nicht mehr;
// eine Vertragsänderung führt im nächsten Lauf zum Änderungsbescheid. Jedes
// Öffnen steht im Protokoll des Laufs.

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  NOTICE_KIND_LABELS,
  NOTICE_KIND_TONES,
  NOTICE_RUN_STATUS_LABELS,
  NOTICE_RUN_STATUS_TONES,
  formatDelta,
  isEmptyNoticeRun,
  noticeCountLabel,
  noticePeriod,
  noticeRateLabel,
  rateCountLabel,
} from "~/components/traeger/care-notice-format";
import { formatEuro } from "~/components/traeger/contribution-format";
import { CareBilledChildrenCard } from "~/components/traeger/care-billed-children-card";
import { emptyNoticeRunText } from "~/components/traeger/care-billed-children-format";
import { CareJoinedChildrenCard } from "~/components/traeger/care-joined-children-card";
import { EmptyRunCard } from "~/components/traeger/empty-run-card";
import {
  traegerExportScope,
  useTraegerListExportItems,
} from "~/components/traeger/traeger-list-export-menu";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { useDraftOn } from "~/lib/swr/read-draft";
import { isReadStateRefusal } from "~/lib/api-error";
import { Alert } from "~/components/ui/alert";
import { Button, ButtonLink } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";
import { DataField } from "~/components/ui/data-field";
import { EmptyState } from "~/components/ui/empty-state";
import { ConfirmationModal } from "~/components/ui/modal";
import { StatCard } from "~/components/ui/stat-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { formatDate } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { billingConcept } from "~/lib/concepts/billing";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import { traegerBillingRunKeys } from "~/lib/swr/traeger-billing-run-keys";
import {
  type CareNotice,
  type CareNoticeRunDetail,
  discardCareNoticeRun,
  fetchCareNoticeRun,
  releaseCareNoticeRun,
} from "~/lib/traeger-care-notices-api";
import {
  downloadTraegerList,
  listExportQuery,
} from "~/lib/traeger-list-export";
import { traegerPath } from "~/lib/traeger-url";
import { labelOf } from "~/lib/label-of";
const logger = createLogger({ component: "TraegerCareNoticeRunPage" });

const noticeColumns: DataTableColumn<CareNotice>[] = [
  {
    key: "child",
    header: "Kind",
    render: (notice) => (
      <div className="min-w-0">
        <p className="font-medium text-gray-900">
          {notice.childFirstName} {notice.childLastName}
        </p>
        <p className="text-xs text-gray-600">{notice.schoolName}</p>
      </div>
    ),
    stacked: "title",
  },
  {
    key: "kind",
    header: "Art",
    render: (notice) => (
      <StatusBadge
        label={labelOf(NOTICE_KIND_LABELS, notice.kind, "Bescheid")}
        tone={labelOf(NOTICE_KIND_TONES, notice.kind, "gray")}
      />
    ),
    stacked: "meta",
  },
  {
    key: "number",
    header: "Bescheid-Nr.",
    render: (notice) => (
      <span className="tabular-nums">{notice.number || "–"}</span>
    ),
    stacked: "hidden",
  },
  {
    key: "period",
    header: "Zeitraum",
    render: (notice) => (
      <span className="tabular-nums">
        {noticePeriod(notice.periodFrom, notice.periodUntil)}
      </span>
    ),
  },
  {
    key: "rate",
    header: "Raten",
    render: (notice) => (
      <span className="tabular-nums">
        {rateCountLabel(notice.installments.length)} · {noticeRateLabel(notice)}
      </span>
    ),
  },
  {
    key: "total",
    header: "Gesamtbetrag",
    align: "right",
    className: "tabular-nums font-medium text-gray-900",
    render: (notice) => formatEuro(notice.totalCents),
  },
  {
    key: "delta",
    header: "Zu-/Abgang",
    align: "right",
    className: "tabular-nums",
    render: (notice) =>
      notice.kind === "change" ? formatDelta(notice.deltaCents) : "–",
    stacked: "hidden",
  },
];

/** Why issuing is blocked, in the order the warnings show. */
function releaseBlockReason(run: CareNoticeRunDetail): string | undefined {
  if (run.previewCount === 0) return undefined;
  if (run.legalRemedyMissing) {
    return "Trage zuerst die Rechtsbehelfsbelehrung in der Vorlage „Bescheid“ ein.";
  }
  if (!run.numberRangeSet) {
    return "Lege zuerst das Muster der Rechnungsnummern für Monatsbeiträge fest.";
  }
  return undefined;
}

/** "1 Kind", "3 Kinder". */
function childrenLabel(count: number): string {
  return count === 1 ? "1 Kind" : `${count} Kinder`;
}

/** Was die Seite ist und was man dort zuerst tut (#7596). */
const NOTICE_RUN_INFO =
  "Hier findest du die Jahresbescheide für die Familien. Vor dem Ausstellen kannst du die Zeilen prüfen. Danach bleiben die Bescheide festgeschrieben.";

export default function TraegerCareNoticeRunPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const runId = params.id;
  const {
    data: run,
    loading,
    error: loadError,
    mutate,
    reload,
    reloadOrThrow,
  } = useTraegerResource(
    traegerBillingRunKeys.noticeRun(runId),
    () => fetchCareNoticeRun(runId),
    "der Jahreslauf",
  );
  const invalidateFamily = useInvalidateFamily();
  const [confirming, setConfirming] = useState(false);
  // The release confirms the run as the dialog opened on it (ADR 0311):
  // a newer read in the background does not change what is confirmed, and
  // after a refusal the stored run shows.
  const releaseRead = useDraftOn<
    NonNullable<typeof run>,
    NonNullable<typeof run>,
    string,
    unknown
  >(
    {
      opening: confirming && run ? run.id : null,
      data: run ?? undefined,
      reload: reloadOrThrow,
    },
    // The dialog closes after the release or its refusal; reopened, it
    // confirms the run then on screen.
    { token: (shown) => shown.fingerprint, follow: false },
  );
  const releaseShown = async <A,>(
    send: (shown: NonNullable<typeof run>) => Promise<A>,
  ) => {
    const shown = releaseRead.base ?? run;
    if (!shown) throw new Error("no run to release");
    return send(shown);
  };
  const [releasing, setReleasing] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const releaseErrors = useApiErrorDisplay();
  const { success } = useToast();

  const release = async () => {
    if (!run) return;
    setReleasing(true);
    try {
      await mutate(await releaseShown(releaseCareNoticeRun), {
        revalidate: false,
      });
      void invalidateFamily(traegerBillingRunKeys.noticeRuns());
      // The exports list the notices of the released run.
      void invalidateFamily(traegerBillingKeys.exportRuns());
      setConfirming(false);
      success(
        run.previewCount === 0
          ? "Der Jahreslauf ist abgeschlossen."
          : "Die Bescheide sind ausgestellt.",
      );
    } catch (err) {
      logger.error("traeger_care_notice_run_release_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      setConfirming(false);
      void releaseErrors.show(err, {
        object: "der Jahreslauf",
        reload: reloadOrThrow,
      });
      if (!isReadStateRefusal(err)) reload();
    } finally {
      setReleasing(false);
    }
  };

  const discard = async () => {
    if (!run) return;
    setDiscarding(true);
    try {
      await mutate(await discardCareNoticeRun(run.id), { revalidate: false });
      void invalidateFamily(traegerBillingRunKeys.noticeRuns());
      setConfirmingDiscard(false);
      success(
        `Der Lauf ist verworfen. Für ${run.year} kannst du einen neuen Jahreslauf starten.`,
      );
    } catch (err) {
      logger.error("traeger_care_notice_run_discard_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      setConfirmingDiscard(false);
      void releaseErrors.show(err, {
        object: "der Jahreslauf",
        reload: reloadOrThrow,
      });
      if (!isReadStateRefusal(err)) reload();
    } finally {
      setDiscarding(false);
    }
  };

  const openNotice = (notice: CareNotice) =>
    router.push(
      traegerPath(
        `/traeger/abrechnung/jahresbescheide/${runId}/bescheid/${notice.contractId}`,
      ),
    );

  const preview = run?.status === "calculated";
  const discarded = run?.status === "discarded";
  const empty = run ? isEmptyNoticeRun(run) : false;
  const changes =
    run?.notices.filter((notice) => notice.kind === "change") ?? [];
  const issued = run?.status === "released" && run.previewCount > 0;
  const exportItems = useTraegerListExportItems({
    download: (format) =>
      downloadTraegerList(
        bffFile("org", "GET /traeger/care-notice-runs/{id}/export", {
          params: { id: runId },
          query: listExportQuery(format),
        }),
      ),
    scope: traegerExportScope(),
    fallbackName: `jahresbescheide-${run?.year ?? ""}`,
    errorObject: "die Bescheide",
    unavailable: !run || run.notices.length === 0,
  });
  const canRelease =
    preview &&
    (run.previewCount === 0 || (run.numberRangeSet && !run.legalRemedyMissing));

  return (
    <TenantPage
      info={NOTICE_RUN_INFO}
      leading={<ConceptIconTile concept={billingConcept} size="page" />}
      title={run ? `Jahresbescheide ${run.year}` : "Jahreslauf"}
      back
      backHref={traegerPath("/traeger/abrechnung/jahresbescheide")}
      backLabel="Zurück zu den Jahresbescheiden"
      stats={
        run ? (
          <TenantPageStats
            items={[
              { label: noticePeriod(run.periodFrom, run.periodUntil) },
              ...(discarded
                ? [
                    {
                      label: `Verworfen am ${run.discardedAt ? formatDate(run.discardedAt) : "–"}`,
                    },
                  ]
                : run.issuedOn
                  ? [
                      {
                        label: `${run.previewCount === 0 ? "Abgeschlossen" : "Ausgestellt"} am ${formatDate(run.issuedOn)}`,
                      },
                    ]
                  : run.noticeDate
                    ? [
                        {
                          label: `Bescheiddatum ${formatDate(run.noticeDate)}`,
                        },
                      ]
                    : []),
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      overflowMenu={
        run
          ? [
              ...(issued
                ? [
                    {
                      label: "Lastschrift der Raten",
                      description:
                        "Öffnet die Lastschrift der Raten mit der Datei für deine Bank",
                      href: traegerPath(
                        `/traeger/abrechnung/jahresbescheide/${run.id}/lastschrift`,
                      ),
                      onClick: () => undefined,
                    },
                  ]
                : []),
              ...exportItems,
            ]
          : undefined
      }
      actions={
        <>
          {run ? (
            <StatusBadge
              label={
                run.status === "released" && run.previewCount === 0
                  ? "Abgeschlossen"
                  : labelOf(NOTICE_RUN_STATUS_LABELS, run.status, "–")
              }
              tone={labelOf(NOTICE_RUN_STATUS_TONES, run.status, "gray")}
            />
          ) : null}
          {empty ? (
            <Button
              type="button"
              variant="outline_danger"
              size="md"
              tooltip="moto fragt vorher nach, dann ist das Jahr frei für einen neuen Lauf."
              onClick={() => setConfirmingDiscard(true)}
            >
              Leeren Lauf verwerfen
            </Button>
          ) : preview ? (
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={!canRelease}
              disabledReason={releaseBlockReason(run)}
              tooltip={
                run.previewCount === 0
                  ? "moto fragt vorher nach, dann ist der Jahreslauf ohne Bescheid abgeschlossen."
                  : "moto fragt vorher nach, dann sind alle Bescheide mit Nummer festgeschrieben."
              }
              onClick={() => setConfirming(true)}
            >
              {run.previewCount === 0
                ? "Jahreslauf abschließen"
                : "Bescheide ausstellen"}
            </Button>
          ) : issued ? (
            // The delivery of the stored originals (#6347) has a page of its
            // own; the direct debit of the installments (#4697) stands in the
            // page menu.
            <ButtonLink
              href={traegerPath(
                `/traeger/abrechnung/jahresbescheide/${run.id}/versand`,
              )}
              variant="primary"
              size="md"
              tooltip="Öffnet den Versand, dort sendest du die Bescheide an die Familien."
            >
              An Familien senden
            </ButtonLink>
          ) : null}
        </>
      }
      error={loadError}
      loading={loading}
      overlays={
        run && empty ? (
          <ConfirmationModal
            isOpen={confirmingDiscard}
            title="Leeren Lauf verwerfen?"
            confirmText="Verwerfen"
            confirmVariant="danger"
            isConfirmLoading={discarding}
            loadingText="Wird verworfen …"
            onClose={() => setConfirmingDiscard(false)}
            onConfirm={() => void discard()}
          >
            <div className="space-y-3 text-sm text-gray-700">
              <p>
                Der Jahreslauf für das Jahr {run.year} stellt nichts aus. Er
                bleibt als „Verworfen“ in der Liste.
              </p>
              <p>
                Danach ist das Jahr frei. Du kannst sofort einen neuen Lauf
                starten.
              </p>
            </div>
          </ConfirmationModal>
        ) : run ? (
          <ConfirmationModal
            isOpen={confirming}
            title={
              run.previewCount === 0
                ? "Jahreslauf abschließen?"
                : "Bescheide ausstellen?"
            }
            confirmText={run.previewCount === 0 ? "Abschließen" : "Ausstellen"}
            isConfirmLoading={releasing}
            loadingText={
              run.previewCount === 0
                ? "Wird abgeschlossen …"
                : "Wird ausgestellt …"
            }
            onClose={() => setConfirming(false)}
            onConfirm={() => void release()}
          >
            {run.previewCount === 0 ? (
              <p className="text-sm text-gray-700">
                Dieser Jahreslauf stellt keine Bescheide aus. Danach kannst du
                einen neuen Jahreslauf starten.
              </p>
            ) : (
              <p className="text-sm text-gray-700">
                {noticeCountLabel(run.previewCount)} über{" "}
                {formatEuro(run.previewCents)} bekommen ihre Nummer und das
                Bescheiddatum{" "}
                {run.noticeDate ? formatDate(run.noticeDate) : "von heute"}.
                Danach lassen sie sich nicht mehr ändern.
              </p>
            )}
            {changes.length > 0 ? (
              <p className="mt-3 text-sm text-gray-700">
                {changes.length === 1
                  ? "1 Änderungsbescheid ersetzt den bisherigen Bescheid für seine Monate."
                  : `${changes.length} Änderungsbescheide ersetzen die bisherigen Bescheide für ihre Monate.`}
              </p>
            ) : null}
          </ConfirmationModal>
        ) : null
      }
    >
      {run && (discarded || empty) ? (
        <>
          <EmptyRunCard
            title="Jahreslauf"
            discarded={discarded}
            description={
              discarded
                ? `Er hatte nichts abzurechnen und hat nichts ausgestellt. Für das Jahr ${run.year} kannst du einen neuen Lauf starten.`
                : emptyNoticeRunText(run.year, run.billedChildren ?? [])
            }
            createdAt={run.createdAt}
            discardedAt={run.discardedAt}
          >
            <DataField label="Zeitraum">
              {noticePeriod(run.periodFrom, run.periodUntil)}
            </DataField>
            <DataField label="Schulen">
              {run.schoolIds.length === 1
                ? "1 Schule"
                : `${run.schoolIds.length} Schulen`}
            </DataField>
          </EmptyRunCard>
          {/* A child billed at another school (#7874): the empty run says
            why it has no notice here. */}
          {empty ? (
            <CareJoinedChildrenCard childrenJoined={run.joinedChildren} />
          ) : null}
          {/* A month an issued invoice already bills (#7892): the empty run
            says why it has no notice for the child. */}
          {empty ? (
            <CareBilledChildrenCard
              childrenBilled={run.billedChildren ?? []}
              yearly
            />
          ) : null}
        </>
      ) : run ? (
        <>
          {preview && run.previewCount > 0 && run.legalRemedyMissing ? (
            <Alert
              type="warning"
              title="Rechtsbehelfsbelehrung fehlt"
              message="In der Vorlage „Bescheid“ fehlt die Rechtsbehelfsbelehrung. Ohne sie stellt moto keinen Bescheid aus. Wer das Recht „Einstellungen“ hat, trägt sie ein."
              action={
                <ButtonLink
                  href={traegerPath(
                    "/traeger/einstellungen/briefkopf/vorlagen/bescheid",
                  )}
                  variant="surface"
                  size="compact"
                  tooltip="Öffnet die Vorlage „Bescheid“ in den Einstellungen."
                >
                  Vorlage öffnen
                </ButtonLink>
              }
            />
          ) : null}
          {preview && run.previewCount > 0 && !run.numberRangeSet ? (
            <Alert
              type="warning"
              message="Bevor du ausstellst: Lege das Muster der Rechnungsnummern für Monatsbeiträge fest. Der Bescheid nimmt seine Nummer daraus."
              action={
                <ButtonLink
                  href={traegerPath("/traeger/einstellungen/abrechnung")}
                  variant="surface"
                  size="compact"
                  tooltip="Öffnet die Einstellungen für das Muster der Rechnungsnummern."
                >
                  Muster festlegen
                </ButtonLink>
              }
            />
          ) : null}
          {preview && (run.unpricedCount > 0 || run.duplicateCount > 0) ? (
            <Alert
              type="warning"
              message="Für einige Kinder fehlt ein Preis oder es gibt einen doppelten Vertrag. Für diese Monate bleibt ein bisheriger Bescheid gültig. Ohne bisherigen Bescheid bleiben sie offen. Der Monatslauf zeigt, was fehlt."
            />
          ) : null}
          {preview ? (
            <CareJoinedChildrenCard childrenJoined={run.joinedChildren} />
          ) : null}
          {preview ? (
            <CareBilledChildrenCard
              childrenBilled={run.billedChildren ?? []}
              yearly
            />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label={preview ? "Bescheide in der Vorschau" : "Bescheide"}
              value={noticeCountLabel(run.previewCount)}
            />
            <StatCard
              label="Gesamtbetrag aller Bescheide"
              value={formatEuro(run.previewCents)}
              // A released notice is a claim before any payment: moto sees
              // no incoming money, the bookkeeping does (#6348).
              hint={
                preview
                  ? undefined
                  : "Forderung vor Zahlungseingang. Zahlungen sieht moto nicht."
              }
            />
            <StatCard
              label="Zu-/Abgang gegenüber bisher"
              value={formatDelta(run.previewDeltaCents)}
            />
          </div>
          {run.unchanged > 0 || run.billed > 0 ? (
            <Alert
              type="info"
              message={[
                run.unchanged > 0
                  ? `${childrenLabel(run.unchanged)} mit gültigem Bescheid: nichts geändert, kein neuer Bescheid.`
                  : "",
                run.billed > 0
                  ? `${childrenLabel(run.billed)} mit Monatsrechnung in diesem Zeitraum: diese Monate stehen in keinem Bescheid.`
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            />
          ) : null}
          <DataTable
            columns={noticeColumns}
            rows={[...run.notices]}
            getRowKey={(notice) => notice.contractId}
            stackedLayout="row"
            stackedDetailKey="rate"
            onRowClick={openNotice}
            caption={
              preview
                ? "Wähle eine Zeile. Du siehst Seite 1 des Bescheids."
                : "Wähle eine Zeile, um Seite 1 des Bescheids anzusehen. Das Original zum Versand findest du unter „An Familien senden“."
            }
            emptyState={
              <EmptyState
                title={
                  preview ? "Kein Bescheid auszustellen." : "Keine Bescheide."
                }
                description={
                  run.unchanged > 0
                    ? "Alle Bescheide stimmen noch mit den Verträgen überein."
                    : "Für diesen Zeitraum hat kein Kind einen abrechenbaren Vertrag."
                }
              />
            }
          />
        </>
      ) : null}
    </TenantPage>
  );
}
