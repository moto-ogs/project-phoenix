import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "~/components/ui/modal";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { Button } from "~/components/ui/button";
import { NumberStepper } from "~/components/ui/number-stepper";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { ProgressBar } from "~/components/ui/progress-bar";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { Alert } from "~/components/ui/alert";
import { useApiErrorDisplay, useApiFormError } from "~/contexts/ToastContext";
import { operatorProvisioningService } from "~/lib/operator/provisioning-api";
import type { SchoolSummary } from "~/lib/operator/provisioning-helpers";
import {
  DEVICE_SLOTS_MAX,
  validateDeviceSlotsDraft,
} from "~/lib/operator/device-slots";
import { formatCount } from "~/lib/format-utils";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "DeviceSlotsModal" });

const FIELD_NAME = "device_slots";

/**
 * Geräteplätze einer Schule (#2312): so viele Geräte hat die Schule gekauft.
 * Die belegten Plätze stehen daneben; unter sie lässt sich die Zahl nicht
 * senken, denn eine Vertragsänderung schaltet nie ein laufendes Gerät ab.
 * Ohne Grenze bleibt die Schule bei ihrem bisherigen Verhalten.
 */
export function DeviceSlotsModal({
  isOpen,
  onClose,
  school,
  onUpdated,
}: {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly school: SchoolSummary;
  readonly onUpdated: () => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { show: showError, invalid, clear: clearError } = formErrors;
  const { show: showRefreshError } = useApiErrorDisplay();
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const occupied = school.geraeteCount;

  useEffect(() => {
    if (!isOpen) return;
    // Ohne Grenze schlägt der Dialog die belegten Plätze vor: die kleinste
    // Zahl, die das Backend annimmt.
    setValue(String(school.deviceSlots ?? occupied));
    clearError();
    setConfirmRemove(false);
  }, [isOpen, school.deviceSlots, occupied, clearError]);

  const draft = validateDeviceSlotsDraft(value, occupied);
  // The occupied count comes from the loaded school summary and can be
  // outdated; below it the dialog warns, the backend decides when saving.
  const blocking = !draft.ok && draft.kind === "format";
  const current = Number(value.trim());

  const save = useCallback(
    async (deviceSlots: number | null) => {
      setSaving(true);
      clearError();
      try {
        await operatorProvisioningService.setSchoolDeviceSlots(
          school.id,
          deviceSlots,
        );
      } catch (err) {
        logger.error("device_slots_update_failed", {
          school_id: school.id,
          error: err instanceof Error ? err.message : String(err),
        });
        void showError(err, { object: "die Änderung der Geräteplätze" });
        setSaving(false);
        return;
      }
      try {
        await onUpdated();
      } catch (err) {
        logger.error("device_slots_refresh_failed", {
          school_id: school.id,
          error: err instanceof Error ? err.message : String(err),
        });
        void showRefreshError(err, {
          object: "die Liste der Schulen",
          retry: () => void onUpdated(),
        });
      } finally {
        setSaving(false);
      }
      onClose();
    },
    [clearError, onClose, onUpdated, school.id, showError, showRefreshError],
  );

  const handleSubmit = useCallback(
    (event?: React.SyntheticEvent) => {
      event?.preventDefault();
      const result = validateDeviceSlotsDraft(value, occupied);
      if (!result.ok && result.kind === "format") {
        invalid("Bitte prüfe die markierten Felder.", {
          [FIELD_NAME]: result.error,
        });
        return;
      }
      void save(result.slots);
    },
    [invalid, occupied, save, value],
  );

  const step = (delta: -1 | 1) => {
    const base = Number.isFinite(current) ? current : occupied;
    setValue(String(Math.min(Math.max(base + delta, 0), DEVICE_SLOTS_MAX)));
  };

  if (confirmRemove) {
    return (
      <ConfirmDeleteModal
        isOpen={isOpen}
        title="Grenze der Geräteplätze entfernen"
        description={
          <p>
            Danach gilt für <span className="font-medium">{school.name}</span>{" "}
            keine Grenze mehr. Die Schule kann wieder beliebig viele Geräte
            registrieren.
          </p>
        }
        gate={{ mode: "twoStep", firstStepLabel: "Entfernen" }}
        confirmLabel="Grenze entfernen"
        loadingLabel="Wird entfernt…"
        onConfirm={() => save(null)}
        onClose={() => {
          clearError();
          setConfirmRemove(false);
        }}
        loading={saving}
        error={formErrors.error}
      />
    );
  }

  const free = draft.ok ? draft.slots - occupied : null;
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Geräteplätze"
      footer={
        <>
          {school.deviceSlots !== null && (
            <Button
              type="button"
              variant="outline_danger"
              size="md"
              onClick={() => {
                clearError();
                setConfirmRemove(true);
              }}
              disabled={saving}
              className="mr-auto"
            >
              Grenze entfernen
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onClose}
            disabled={saving}
          >
            Abbrechen
          </Button>
          <Button
            type="submit"
            form="device-slots-form"
            variant="primary"
            size="md"
            disabled={saving || blocking}
            disabledReason={blocking && !draft.ok ? draft.error : undefined}
          >
            {saving ? "Wird gespeichert…" : "Speichern"}
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        id="device-slots-form"
        onSubmit={handleSubmit}
        noValidate
        className="space-y-5"
      >
        <FormErrorAlert message={formErrors.error} />
        <p className="text-sm text-gray-600">
          So viele Geräte darf {school.name} laut Vertrag registrieren. Jedes
          registrierte Gerät belegt einen Platz, auch ein gesperrtes.
        </p>
        <NumberStepper
          id="device-slots"
          name={FIELD_NAME}
          aria-label="Anzahl Geräteplätze"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onStep={step}
          decrementLabel="Einen Geräteplatz weniger"
          incrementLabel="Einen Geräteplatz mehr"
          canDecrement={Number.isFinite(current) && current > 0}
          canIncrement={!Number.isFinite(current) || current < DEVICE_SLOTS_MAX}
          disabled={saving}
          error={formErrors.fieldError(FIELD_NAME)}
        />
        {draft.ok ? null : (
          <Alert type="warning" size="compact" message={draft.error} />
        )}
        <div className="space-y-2">
          {draft.ok ? (
            <ProgressBar
              label={`${formatCount(occupied)} von ${formatCount(draft.slots)} Geräteplätzen belegt`}
              value={occupied}
              max={Math.max(draft.slots, 1)}
              tone={free === 0 ? "orange" : "green"}
            />
          ) : null}
          <DataGrid>
            <DataField label="Belegt">
              <span data-testid="device-slots-occupied">
                {formatCount(occupied)} {occupied === 1 ? "Gerät" : "Geräte"}
              </span>
            </DataField>
            <DataField label="Danach frei">
              <span data-testid="device-slots-free">
                {free === null ? "–" : formatCount(free)}
              </span>
            </DataField>
          </DataGrid>
        </div>
      </form>
    </Modal>
  );
}
