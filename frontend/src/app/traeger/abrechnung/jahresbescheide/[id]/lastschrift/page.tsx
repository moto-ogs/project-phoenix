"use client";

// Die Lastschrift der Raten eines Jahreslaufs (#4697, ADR 0181): je
// Fälligkeitsmonat eine PAIN.008-Datei für die Bank. Eine eigene Seite wie
// „Schreiben“ beim Monatslauf; der Jahreslauf verlinkt sie im Menü seines Kopfs.

import { useParams } from "next/navigation";
import { NoticeSepaDebits } from "~/components/traeger/notice-sepa-debits";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { TenantPage } from "~/components/ui/tenant-page";
import { formatDate } from "~/lib/date-helpers";
import { traegerBillingRunKeys } from "~/lib/swr/traeger-billing-run-keys";
import { fetchCareNoticeRun } from "~/lib/traeger-care-notices-api";
import { traegerPath } from "~/lib/traeger-url";

/** Was die Seite ist und was man dort zuerst tut (#7596). */
const NOTICE_DEBITS_INFO =
  "Hier bekommst du die Datei, mit der deine Bank die Raten der Bescheide abbucht. Wähle zuerst bei „Raten fällig im“ den Monat.";

export default function TraegerNoticeDebitsPage() {
  const { id: runId } = useParams<{ id: string }>();
  const {
    data: run,
    loading,
    error,
  } = useTraegerResource(
    traegerBillingRunKeys.noticeRun(runId),
    () => fetchCareNoticeRun(runId),
    "der Jahreslauf",
  );

  const issued = run?.status === "released" && run.previewCount > 0;

  return (
    <TenantPage
      info={NOTICE_DEBITS_INFO}
      title={
        run ? `Lastschrift der Raten ${run.year}` : "Lastschrift der Raten"
      }
      back
      backHref={traegerPath(`/traeger/abrechnung/jahresbescheide/${runId}`)}
      backLabel="Zurück zum Jahreslauf"
      stats={
        run
          ? `${formatDate(run.periodFrom)} bis ${formatDate(run.periodUntil)}`
          : null
      }
      statsLoading={loading}
      error={error}
      loading={loading}
      empty={
        run && !issued
          ? {
              title: "Noch keine Lastschrift",
              description:
                run.status === "released"
                  ? "Dieser Jahreslauf hat keinen Bescheid. Es gibt nichts abzubuchen."
                  : "Die Datei für die Bank gibt es, sobald du die Bescheide auf der Seite des Jahreslaufs ausgestellt hast.",
            }
          : null
      }
    >
      {run && issued ? (
        <NoticeSepaDebits
          periodFrom={run.periodFrom}
          periodUntil={run.periodUntil}
        />
      ) : null}
    </TenantPage>
  );
}
