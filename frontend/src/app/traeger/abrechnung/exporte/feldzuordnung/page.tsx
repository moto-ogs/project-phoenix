"use client";

// Feldzuordnung der Sollstellung (#4693): Spalten, Trennzeichen, Datum,
// Zeichensatz und Dateiname der CSV für die Kämmerei, dazu die erste
// Dateinummer. Ohne eigene Zuordnung gilt die Vorgabe von moto. Nur das Recht
// „Finanz-Export“ sieht die Seite.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExportFileNumberCard } from "~/components/traeger/export-file-number-card";
import { SollMappingEditor } from "~/components/traeger/soll-mapping-editor";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Button } from "~/components/ui/button";
import { ConfirmationModal } from "~/components/ui/modal";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import {
  type ExportSettings,
  fetchExportSettings,
  resetSollMapping,
} from "~/lib/traeger-finance-exports-api";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerSollMappingPage" });

const EXPORTS_PATH = "/traeger/abrechnung/exporte";

const INFO =
  "Die Kämmerei liest die Sollstellung mit ihrem eigenen Programm. Lege hier fest, welche Spalten die Datei in welcher Reihenfolge hat. Die Änderung gilt für jede neue Datei.";

export default function TraegerSollMappingPage() {
  const router = useRouter();
  const {
    data: settings,
    loading,
    error: loadError,
    mutate,
  } = useTraegerResource(
    traegerBillingKeys.exportSettings(),
    fetchExportSettings,
    "die Feldzuordnung",
  );
  const setSettings = (next: ExportSettings) =>
    void mutate(next, { revalidate: false });
  // A new key starts the editor again from the stored mapping.
  const [version, setVersion] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const errors = useApiErrorDisplay();
  const { success } = useToast();

  const reset = async () => {
    setResetting(true);
    try {
      await mutate(await resetSollMapping(), { revalidate: false });
      setVersion((current) => current + 1);
      setConfirmReset(false);
      success("Die Feldzuordnung ist wieder die Vorgabe von moto.");
    } catch (err) {
      logger.error("traeger_soll_mapping_reset_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      setConfirmReset(false);
      void errors.show(err, { object: "die Feldzuordnung" });
    } finally {
      setResetting(false);
    }
  };

  return (
    <TenantPage
      title="Feldzuordnung"
      stats={
        settings ? (
          <TenantPageStats
            items={[
              { value: settings.mapping.columns.length, label: "Spalten" },
              {
                value: settings.custom
                  ? "Eigene Zuordnung"
                  : "Vorgabe von moto",
                label: "",
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      info={INFO}
      back
      backHref={traegerPath(EXPORTS_PATH)}
      backLabel="Zurück zu den Exporten"
      actions={
        settings?.custom ? (
          <Button
            type="button"
            variant="outline"
            size="md"
            tooltip="moto fragt vorher nach, dann gilt wieder die Spaltenfolge von moto."
            onClick={() => setConfirmReset(true)}
          >
            Vorgabe wiederherstellen
          </Button>
        ) : null
      }
      error={loadError}
      loading={loading}
    >
      {settings ? (
        <>
          <ExportFileNumberCard settings={settings} onChanged={setSettings} />
          <SollMappingEditor
            key={version}
            settings={settings}
            onCancel={() => router.push(traegerPath(EXPORTS_PATH))}
            onSaved={(saved) => {
              setSettings(saved);
              setVersion((current) => current + 1);
            }}
          />
          <ConfirmationModal
            isOpen={confirmReset}
            onClose={() => setConfirmReset(false)}
            onConfirm={() => void reset()}
            title="Vorgabe wiederherstellen?"
            confirmText="Ja, wiederherstellen"
            confirmVariant="warning"
            isConfirmLoading={resetting}
            loadingText="Wird wiederhergestellt …"
          >
            <p>
              Deine Spalten und Einstellungen gehen verloren. Neue Dateien haben
              dann die Spalten der Vorgabe von moto.
            </p>
          </ConfirmationModal>
        </>
      ) : null}
    </TenantPage>
  );
}
