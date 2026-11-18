"use client";

// Neuer Empfänger der Finanz-Exporte (#6911, ADR 0222). Er bekommt noch
// keine Datei; welche Datei er bekommt, legt der Träger danach in der
// Übersicht fest.

import { useRouter } from "next/navigation";
import { EXPORT_RECIPIENT_PATH } from "~/components/traeger/export-handover-format";
import { ExportRecipientFormCard } from "~/components/traeger/export-recipient-cards";
import { TenantPage } from "~/components/ui/tenant-page";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import { createExportRecipient } from "~/lib/traeger-export-handovers-api";
import { traegerPath } from "~/lib/traeger-url";

const INFO =
  "Trage ein, wohin moto Dateien übergeben soll. Danach wählst du in der Übersicht, welche Dateien dieser Empfänger bekommt.";

export default function TraegerNewExportRecipientPage() {
  const router = useRouter();
  const invalidateFamily = useInvalidateFamily();
  return (
    <TenantPage
      title="Neuer Empfänger"
      info={INFO}
      back
      backHref={traegerPath(EXPORT_RECIPIENT_PATH)}
      backLabel="Zurück zu den Empfängern"
    >
      <ExportRecipientFormCard
        recipient={null}
        onSave={async (draft) => {
          await createExportRecipient(draft);
          void invalidateFamily(traegerBillingKeys.exportRecipientsFamily);
          router.push(traegerPath(EXPORT_RECIPIENT_PATH));
        }}
      />
    </TenantPage>
  );
}
