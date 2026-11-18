"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Modal } from "~/components/ui/modal";
import { Button } from "~/components/ui/button";
import { formErrorMessage } from "~/components/ui/form-error";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { CustomSelect } from "~/components/ui/custom-select";
import { Loading } from "~/components/ui/loading";
import { mutate, useSWRAuth } from "~/lib/swr";
import { staffAccessKeys } from "~/lib/swr/staff-keys";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import {
  fetchStaffPreviewCandidates,
  performStartStaffPreview,
  type StaffPreviewCandidate,
} from "~/lib/staff-preview-api";
import { useApiFormError } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import { leaveForAnotherAccount } from "~/lib/personal-storage";
import { useTenantAwarePath } from "~/lib/tenant-path";

const logger = createLogger({ component: "StaffPreviewModal" });

interface StaffPreviewModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

function candidateLabel(candidate: StaffPreviewCandidate): string {
  const name = `${candidate.firstName} ${candidate.lastName}`.trim();
  return name || candidate.email;
}

/**
 * Auswahl-Dialog für die Mitarbeiter-Vorschau (#2893): der Admin wählt eine
 * Person der eigenen Schule, danach zeigt moto deren Ansicht — nur lesend.
 */
export function StaffPreviewModal({ isOpen, onClose }: StaffPreviewModalProps) {
  const tenantPath = useTenantAwarePath();
  const [selectedId, setSelectedId] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const {
    data: candidates,
    error: candidatesError,
    mutate: reloadCandidates,
  } = useSWRAuth(
    isOpen ? staffAccessKeys.previewCandidates() : null,
    fetchStaffPreviewCandidates,
  );
  // Fehler bleiben im offenen Dialog (#2517): Laden mit Wiederholen,
  // Starten im Fehlerkasten über der Auswahl.
  const { error: loadError, failure } = useSwrResourceLoadError(
    [{ data: candidates, error: candidatesError }],
    "die Liste der Personen",
    () => reloadCandidates(),
  );
  const loadFailed = failure !== undefined;
  const startError = useApiFormError();
  const clearStartError = startError.clear;
  const latestStartRef = useRef<() => void>(() => undefined);

  // Jedes Öffnen beginnt ohne Auswahl und ohne alten Fehler.
  useEffect(() => {
    if (!isOpen) return;
    clearStartError();
    setSelectedId("");
  }, [isOpen, clearStartError]);

  const handleStart = async () => {
    if (!selectedId || isStarting) return;
    setIsStarting(true);
    startError.clear();
    try {
      await performStartStaffPreview(selectedId, mutate);
      // Volle Neuladung auf der Startseite: ab jetzt rendert alles mit den
      // Rechten der gewählten Person, und nichts aus der Seite davor (Filter
      // in der Adresse, geladene Listen) gilt für sie (#5000).
      leaveForAnotherAccount(tenantPath("/"));
    } catch (err) {
      logger.error("staff_preview_start_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      setIsStarting(false);
      await startError.show(err, {
        object: "die Vorschau",
        retry: () => latestStartRef.current(),
      });
    }
  };
  // „Wiederholen“ startet mit der dann gewählten Person.
  useLayoutEffect(() => {
    latestStartRef.current = () => void handleStart();
  });

  const options = (candidates ?? []).map((candidate) => ({
    value: candidate.accountId,
    label: candidateLabel(candidate),
  }));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Ansicht eines Mitarbeitenden"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onClose}
            noTooltip="Abbrechen schließt den Dialog, ohne etwas zu ändern."
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => void handleStart()}
            disabled={!selectedId || isStarting}
            disabledReason="Wähle zuerst eine Person aus."
            isLoading={isStarting}
            loadingText="Wird gestartet …"
            tooltip="Zeigt moto so, wie diese Person es sieht, nur zum Lesen."
          >
            Vorschau starten
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Wähle eine Person. Du siehst moto danach so wie diese Person. Du
          kannst dabei nur lesen, nichts ändern.
        </p>

        <FormErrorAlert message={startError.error} />
        <LoadErrorAlert error={loadError} />

        {/* Bis der Fehlertext da ist, bleibt der Ladezustand stehen, nie
            „Keine Person gefunden“ für eine Liste, die nie geladen wurde. */}
        {loadFailed ? (
          formErrorMessage(loadError) === null ? (
            <Loading />
          ) : null
        ) : candidates === undefined ? (
          <Loading />
        ) : candidates.length === 0 ? (
          <p className="text-sm text-gray-500">
            Keine Person gefunden, die du ansehen kannst.
          </p>
        ) : (
          <CustomSelect
            value={selectedId}
            options={options}
            onChange={setSelectedId}
            placeholder="Person auswählen"
            ariaLabel="Person für die Vorschau auswählen"
          />
        )}
      </div>
    </Modal>
  );
}
