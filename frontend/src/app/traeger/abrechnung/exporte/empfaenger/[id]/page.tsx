"use client";

// Ein Empfänger der Finanz-Exporte (#6911, ADR 0222): ob er bereit ist,
// welche Dateien er bekommt, sein Zugang und seine letzten Übergaben.
// Entfernen gibt seine Dateien an den Download zurück.

import { useParams, useRouter } from "next/navigation";
import {
  destinationText,
  EXPORT_RECIPIENT_PATH,
  formatsText,
  HANDOVER_STATE_LABELS,
  HANDOVER_UNKNOWN_TEXT,
  handoverReasonText,
  missingFieldsText,
} from "~/components/traeger/export-handover-format";
import {
  EXPORT_RECIPIENT_ACCESS_ID,
  ExportHandoverHistoryCard,
  ExportRecipientFormCard,
} from "~/components/traeger/export-recipient-cards";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Alert } from "~/components/ui/alert";
import { ButtonLink } from "~/components/ui/button";
import { JumpButton } from "~/components/ui/jump-button";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import {
  deleteExportRecipient,
  type ExportRecipient,
  fetchExportRecipient,
  saveExportRecipient,
} from "~/lib/traeger-export-handovers-api";
import { traegerPath } from "~/lib/traeger-url";

/** Where a failed handover is sent again. */
const EXPORTS_PATH = "/traeger/abrechnung/exporte";

/** Whether the recipient can take a file, and what to do if not. */
function RecipientStateNotice({
  recipient,
}: Readonly<{ recipient: ExportRecipient }>) {
  const assign = (
    <ButtonLink
      href={traegerPath(EXPORT_RECIPIENT_PATH)}
      variant="surface"
      size="compact"
      tooltip="Öffnet die Empfänger, dort ordnest du die Dateien zu."
    >
      Dateien zuordnen
    </ButtonLink>
  );
  const toAccess = (
    <JumpButton
      targetId={EXPORT_RECIPIENT_ACCESS_ID}
      tooltip="Springt zu Adresse, Zugang und Schalter der Übergabe."
    >
      Zum Zugang
    </JumpButton>
  );
  if (!recipient.enabled) {
    return (
      <Alert
        type="info"
        title="Die Übergabe ist ausgeschaltet"
        message="Schalte sie unten ein, wenn moto Dateien an diesen Empfänger übergeben soll."
        action={toAccess}
      />
    );
  }
  if (!recipient.ready) {
    return (
      <Alert
        type="warning"
        title="Es fehlen noch Angaben"
        message={`Bis alles ausgefüllt ist, übergibt moto nichts. Es fehlen: ${missingFieldsText(recipient.missingFields)}.`}
        action={toAccess}
      />
    );
  }
  if (recipient.formats.length === 0) {
    return (
      <Alert
        type="info"
        title="Der Empfänger bekommt noch keine Datei"
        message="Wähle in der Übersicht, welche Dateien an ihn gehen."
        action={assign}
      />
    );
  }
  const last = recipient.lastHandover;
  if (last?.state === "failed" || last?.state === "unknown") {
    return (
      <Alert
        type="warning"
        title={
          last.state === "failed"
            ? `Die letzte Übergabe ist nicht angekommen: ${last.fileName}`
            : `Ob die letzte Übergabe angekommen ist, ist unklar: ${last.fileName}`
        }
        message={
          last.state === "failed"
            ? `${handoverReasonText(last.reason)} Prüfe die Angaben unten und übergib die Datei bei den Exporten noch einmal.`
            : HANDOVER_UNKNOWN_TEXT
        }
        actionLayout={last.state === "failed" ? "stacked" : undefined}
        action={
          last.state === "failed" ? (
            <div className="flex flex-wrap gap-2">
              {toAccess}
              <ButtonLink
                href={traegerPath(EXPORTS_PATH)}
                variant="surface"
                size="compact"
                tooltip="Öffnet die Exporte, dort übergibst du die Datei noch einmal."
              >
                Zu den Exporten
              </ButtonLink>
            </div>
          ) : undefined
        }
      />
    );
  }
  return (
    <Alert
      type="success"
      title="Der Empfänger ist bereit"
      message={`${formatsText(recipient.formats)} ${recipient.formats.length === 1 ? "geht" : "gehen"} an ${destinationText(recipient.host, recipient.remoteDirectory)}.`}
      action={assign}
    />
  );
}

/** Was die Seite ist und was man dort zuerst tut (#7596). */
const RECIPIENT_INFO =
  "Hier legst du fest, wie moto Dateien an diesen Empfänger übergibt. Prüfe zuerst unter „Letzte Übergaben“, ob die Dateien ankommen. Fehlt etwas, ergänzt du es unter „Zugang zum Empfänger“.";

export default function TraegerExportRecipientPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const {
    data: page,
    loading,
    error,
    mutate,
  } = useTraegerResource(
    id ? traegerBillingKeys.exportRecipient(id) : null,
    () => fetchExportRecipient(id),
    "der Empfänger",
  );
  const invalidate = useInvalidateFamily();

  const recipient = page?.recipient;
  const last = recipient?.lastHandover;

  return (
    <TenantPage
      info={RECIPIENT_INFO}
      title={recipient?.name ?? "Empfänger"}
      back
      backHref={traegerPath(EXPORT_RECIPIENT_PATH)}
      backLabel="Zurück zu den Empfängern"
      stats={
        recipient ? (
          <TenantPageStats
            items={[
              {
                value: recipient.formats.length
                  ? formatsText(recipient.formats)
                  : "Keine Datei",
                label: "bekommt",
              },
              {
                value: last ? HANDOVER_STATE_LABELS[last.state] : "Noch keine",
                label: "letzte Übergabe",
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      error={error}
      loading={loading}
    >
      {page && recipient ? (
        <>
          <RecipientStateNotice recipient={recipient} />
          <ExportRecipientFormCard
            recipient={recipient}
            onSave={async (draft) => {
              const saved = await saveExportRecipient(recipient.id, draft);
              await mutate(
                { ...page, recipient: saved },
                { revalidate: false },
              );
              // The list shows whether the recipient is ready.
              void invalidate(traegerBillingKeys.exportRecipients());
            }}
            onDelete={async () => {
              await deleteExportRecipient(recipient.id);
              void invalidate(traegerBillingKeys.exportRecipients());
              router.push(traegerPath(EXPORT_RECIPIENT_PATH));
            }}
          />
          <ExportHandoverHistoryCard handovers={page.handovers} />
        </>
      ) : null}
    </TenantPage>
  );
}
