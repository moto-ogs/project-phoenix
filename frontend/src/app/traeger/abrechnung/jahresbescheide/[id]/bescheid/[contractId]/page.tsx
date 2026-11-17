"use client";

// Seite 1 eines Jahresbescheids (#6219) mit dem Briefkopf des Trägers: vor
// dem Ausstellen der Entwurf, danach der ausgestellte Bescheid. Drucken
// nutzt den Druck des Browsers. Jedes Öffnen steht im Protokoll des Laufs.

import { Printer } from "lucide-react";
import { useParams } from "next/navigation";
import { CareNoticeDocument } from "~/components/traeger/care-notice-document";
import { NOTICE_KIND_LABELS } from "~/components/traeger/care-notice-format";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { TenantPage } from "~/components/ui/tenant-page";
import { formatDate } from "~/lib/date-helpers";
import { traegerBillingRunKeys } from "~/lib/swr/traeger-billing-run-keys";
import { fetchCareNoticeLetter } from "~/lib/traeger-care-notices-api";
import { traegerPath } from "~/lib/traeger-url";

export default function TraegerCareNoticePage() {
  const params = useParams<{ id: string; contractId: string }>();
  const { id: runId, contractId } = params;
  const {
    data: letter,
    loading,
    error,
  } = useTraegerResource(
    traegerBillingRunKeys.noticeLetter(runId, contractId),
    () => fetchCareNoticeLetter(runId, contractId),
    "der Bescheid",
  );

  const notice = letter?.notice;
  const draft = notice?.number === "";

  return (
    <TenantPage
      title={
        notice
          ? `${NOTICE_KIND_LABELS[notice.kind]} ${notice.childFirstName} ${notice.childLastName}`
          : "Bescheid"
      }
      back
      backHref={traegerPath(`/traeger/abrechnung/jahresbescheide/${runId}`)}
      backLabel="Zurück zum Jahreslauf"
      printHideHeader
      stats={
        notice ? (
          <span className="text-sm text-gray-600">
            {draft
              ? "Entwurf: Nummer und Datum kommen beim Ausstellen."
              : `Nr. ${notice.number} vom ${notice.issuedOn ? formatDate(notice.issuedOn) : "–"}`}
          </span>
        ) : null
      }
      statsLoading={loading}
      actions={
        letter && !draft ? (
          <Button
            type="button"
            variant="outline"
            size="md"
            tooltip="Öffnet das Druckfenster für diesen Bescheid."
            onClick={() => window.print()}
          >
            <Printer className="mr-2 h-4 w-4" aria-hidden="true" />
            Drucken
          </Button>
        ) : undefined
      }
      error={error}
      loading={loading}
    >
      {letter ? (
        <>
          {notice?.amendedBy ? (
            <Alert
              type="info"
              message={`Dieser Bescheid gilt nicht mehr für alle Monate. Der Änderungsbescheid Nr. ${notice.amendedBy.number} ersetzt ihn.`}
            />
          ) : null}
          <CareNoticeDocument letter={letter} />
        </>
      ) : null}
    </TenantPage>
  );
}
