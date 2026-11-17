"use client";

// Empfänger der Finanz-Exporte (#6824, ADR 0218; #6911, ADR 0222): Wohin
// moto Sollstellung, DATEV-Datei und Lastschriftdatei übergibt. Jede Datei
// geht an genau einen Empfänger; ohne Empfänger bleibt der Download. Darunter
// alle Empfänger mit ihrem Zustand und jeder Versuch einer Übergabe. Nur das
// Recht „Finanz-Export“ sieht die Seite.

import { Plus } from "lucide-react";
import {
  ExportFormatAssignmentCard,
  ExportHandoverHistoryCard,
  ExportRecipientListCard,
} from "~/components/traeger/export-recipient-cards";
import { NEW_EXPORT_RECIPIENT_PATH } from "~/components/traeger/export-handover-format";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { ButtonLink } from "~/components/ui/button";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import {
  assignExportFormats,
  fetchExportRecipients,
} from "~/lib/traeger-export-handovers-api";
import { traegerPath } from "~/lib/traeger-url";

const EXPORTS_PATH = "/traeger/abrechnung/exporte";

const INFO =
  "Hier legen Sie fest, wohin moto Ihre Exporte übergibt. Zum Beispiel geht die Sollstellung an die Kämmerei und die DATEV-Datei an das Steuerbüro. moto legt jede Datei sicher beim Empfänger ab und schreibt in das Exportprotokoll, ob sie angekommen ist. Herunterladen können Sie die Dateien weiterhin.";

export default function TraegerExportRecipientsPage() {
  const {
    data: page,
    loading,
    error,
    mutate,
  } = useTraegerResource(
    traegerBillingKeys.exportRecipients(),
    fetchExportRecipients,
    "die Empfänger",
  );
  const invalidate = useInvalidateFamily();

  const assigned =
    page?.assignments.filter((assignment) => assignment.recipientId !== null)
      .length ?? 0;
  const ready = page?.recipients.filter((recipient) => recipient.ready).length;

  return (
    <TenantPage
      title="Empfänger der Exporte"
      info={INFO}
      back
      backHref={traegerPath(EXPORTS_PATH)}
      backLabel="Zurück zu den Exporten"
      actions={
        <ButtonLink
          href={traegerPath(NEW_EXPORT_RECIPIENT_PATH)}
          variant="primary"
          size="md"
          tooltip="Öffnet das Formular für einen neuen Empfänger."
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          Empfänger hinzufügen
        </ButtonLink>
      }
      stats={
        page ? (
          <TenantPageStats
            items={[
              {
                value: `${ready} von ${page.recipients.length}`,
                label: "Empfängern bereit",
              },
              {
                value: `${assigned} von ${page.assignments.length}`,
                label: "Dateien mit Empfänger",
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      error={error}
      loading={loading}
    >
      {page ? (
        <>
          <ExportFormatAssignmentCard
            page={page}
            onSave={async (assignments) => {
              await mutate(await assignExportFormats(assignments), {
                revalidate: false,
              });
              // Each recipient's page names the files it gets.
              void invalidate(traegerBillingKeys.exportRecipientsFamily);
            }}
          />
          <ExportRecipientListCard recipients={page.recipients} />
          <ExportHandoverHistoryCard handovers={page.handovers} showRecipient />
        </>
      ) : null}
    </TenantPage>
  );
}
