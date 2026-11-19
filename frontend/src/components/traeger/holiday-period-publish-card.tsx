"use client";

// Veröffentlichen eines Ferienzeitraums (#4659). „Veröffentlichen“ ist die
// eine Kopfaktion der Seite (#7411); die Karte darunter trägt nur den Link
// für Eltern (#4661). Vor dem Veröffentlichen sagt sie, was fehlt und dass es
// den Link erst danach gibt. Den Status zeigt die Plakette im Seitenkopf,
// die Zahl der Anmeldungen der Reiter „Anmeldungen“.

import { useState } from "react";
import { Button } from "~/components/ui/button";
import { CopyField } from "~/components/ui/copy-field";
import { ConfirmationModal } from "~/components/ui/modal";
import { SectionCard } from "~/components/ui/section-card";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { formatDate } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import { parentsPortalUrl } from "~/lib/parent-url";
import { type HolidayPeriod, publishHolidayPeriod } from "~/lib/traeger-api";
import { holidayPeriodComplete } from "./holiday-period-model";
import { QrCodeButton } from "~/components/qr-code/qr-code-button";

const logger = createLogger({ component: "HolidayPeriodPublish" });

/** What keeps a draft from being published, or `null`. */
function holidayPublishBlocker(
  period: HolidayPeriod,
  unsavedChanges: boolean,
): string | null {
  if (unsavedChanges) {
    return "Bitte speichere zuerst deine Änderungen.";
  }
  if (!holidayPeriodComplete(period)) {
    return "Zum Veröffentlichen braucht der Ferienzeitraum mindestens eine Woche. Jede Woche braucht mindestens ein Zeitmodell.";
  }
  return null;
}

/**
 * „Veröffentlichen“ im Seitenkopf eines Entwurfs, mit der Rückfrage davor.
 * Ein veröffentlichter Zeitraum zeigt nichts: er wird nicht wieder Entwurf.
 */
export function HolidayPeriodPublishButton({
  period,
  unsavedChanges,
  onPublished,
}: Readonly<{
  period: HolidayPeriod;
  unsavedChanges: boolean;
  onPublished: (period: HolidayPeriod) => void;
}>) {
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const errorDisplay = useApiErrorDisplay();

  if (period.status === "published") return null;

  const blocker = holidayPublishBlocker(period, unsavedChanges);
  const publish = async () => {
    setPublishing(true);
    try {
      onPublished(await publishHolidayPeriod(period.id));
      setConfirming(false);
    } catch (err) {
      logger.error("holiday_period_publish_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      setConfirming(false);
      void errorDisplay.show(err, { object: "die Veröffentlichung" });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="primary"
        size="md"
        disabled={blocker !== null}
        disabledReason={blocker ?? undefined}
        tooltip="Gibt die Anmeldung für alle Schulen des Zeitraums frei. moto fragt vorher nach."
        onClick={() => setConfirming(true)}
      >
        Veröffentlichen
      </Button>
      <ConfirmationModal
        isOpen={confirming}
        title="Ferienzeitraum veröffentlichen?"
        confirmText="Veröffentlichen"
        isConfirmLoading={publishing}
        loadingText="Wird veröffentlicht…"
        onClose={() => setConfirming(false)}
        onConfirm={() => void publish()}
      >
        <p className="text-sm text-gray-700">
          Danach ist der Ferienzeitraum für die Anmeldung freigegeben. Du kannst
          ihn weiter ändern, aber nicht mehr zum Entwurf machen.
        </p>
      </ConfirmationModal>
    </>
  );
}

/**
 * Der Link für Eltern. Vor dem Veröffentlichen sagt die Karte, dass es ihn
 * erst danach gibt und was dafür noch fehlt.
 */
export function HolidayPeriodPublishCard({
  period,
  unsavedChanges,
}: Readonly<{
  period: HolidayPeriod;
  unsavedChanges: boolean;
}>) {
  if (period.status === "published") {
    return (
      <SectionCard
        title="Link für Eltern"
        description={`${
          period.publishedAt
            ? `Seit ${formatDate(period.publishedAt)} für die Anmeldung freigegeben.`
            : "Für die Anmeldung freigegeben."
        } Änderungen gelten sofort nach dem Speichern.`}
      >
        <HolidayRegistrationLink period={period} />
      </SectionCard>
    );
  }

  const blocker = holidayPublishBlocker(period, unsavedChanges);
  return (
    <SectionCard title="Link für Eltern">
      <div className="space-y-2 text-sm text-gray-700">
        <p>Den Link für Eltern gibt es nach dem Veröffentlichen.</p>
        {blocker ? <p>{blocker}</p> : null}
      </div>
    </SectionCard>
  );
}

/** Der eine Link des Zeitraums für alle seine Schulen, im Elternportal. */
function HolidayRegistrationLink({
  period,
}: Readonly<{ period: HolidayPeriod }>) {
  const { showMessage } = useApiErrorDisplay();
  if (!period.publicToken) return null;
  const url = parentsPortalUrl(
    `/ferienanmeldung/${encodeURIComponent(period.publicToken)}`,
  );
  return (
    <div className="space-y-2 text-sm text-gray-700">
      <p>
        Über diesen Link melden Eltern ihre Kinder für alle Wochen an. Ein
        Elternkonto brauchen sie nicht.
      </p>
      <CopyField
        value={url}
        monospace
        copyLabel="Link kopieren"
        onCopyFailed={() =>
          showMessage(
            "Der Link konnte nicht kopiert werden. Bitte markiere und kopiere ihn selbst.",
          )
        }
        action={
          <QrCodeButton
            url={url}
            title="QR-Code für die Ferienanmeldung"
            fileName="qr-code-ferienanmeldung"
            brand="traeger"
          />
        }
      />
    </div>
  );
}
