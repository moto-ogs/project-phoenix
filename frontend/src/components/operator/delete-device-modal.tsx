"use client";

import { useCallback, useEffect, useState } from "react";

import type { OperatorDevice } from "~/lib/operator/provisioning-helpers";
import { formatDeviceSessionMessage } from "~/lib/operator/device-session-message";
import { operatorProvisioningService } from "~/lib/operator/provisioning-api";
import type { RefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useSWRAuth } from "~/lib/swr";
import { operatorKeys } from "~/lib/swr/operator-keys";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import {
  DeviceRemovalSummary,
  isDeviceAlreadyRemoved,
} from "~/components/devices/device-removal-summary";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";

const logger = createLogger({ component: "DeleteDeviceModal" });

interface DeleteDeviceModalProps {
  device: OperatorDevice | null;
  onClose: () => void;
  /** Reloads the device lists; never rejects (#6652). */
  onDeleted: RefreshAfterWrite;
}

/**
 * The removal preflight reuses the transfer status: it already names the
 * open session and the protected system device, the two states that block a
 * removal (#2319). Being online does not block it: removal ends access.
 */
function useDeviceRemovalStatus(device: OperatorDevice | null) {
  const deviceId = device?.id ?? null;
  const { data, error, isValidating, mutate } = useSWRAuth(
    deviceId === null ? null : operatorKeys.deviceTransferStatus(deviceId),
    () => operatorProvisioningService.getDeviceTransferStatus(deviceId ?? ""),
    { keepPreviousData: false },
  );
  const statusError = useSwrLoadError(
    error,
    "die Prüfung des Gerätestatus",
    () => mutate(),
  );
  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);
  // A device someone removed meanwhile answers the preflight with 404:
  // that is the finished removal, not a load failure.
  const alreadyRemoved = isDeviceAlreadyRemoved(error);
  return {
    status: error ? null : (data ?? null),
    statusLoading: isValidating,
    statusError: alreadyRemoved ? null : statusError,
    alreadyRemoved,
    refresh,
  };
}

export function DeleteDeviceModal({
  device,
  onClose,
  onDeleted,
}: Readonly<DeleteDeviceModalProps>) {
  const [loading, setLoading] = useState(false);
  const { success: toastSuccess } = useToast();
  const deleteErrors = useApiFormError();
  const { show: showError, clear: clearError } = deleteErrors;
  const { status, statusLoading, statusError, alreadyRemoved, refresh } =
    useDeviceRemovalStatus(device);

  const handleClose = useCallback(() => {
    clearError();
    onClose();
  }, [onClose, clearError]);

  // Opened from a stale list: the device left this list meanwhile, removed
  // or moved to another school. Close and reload instead of a load error.
  useEffect(() => {
    if (!device || !alreadyRemoved) return;
    toastSuccess(
      `${device.name || device.deviceId} ist hier nicht mehr verfügbar.`,
    );
    handleClose();
    void onDeleted();
  }, [alreadyRemoved, device, handleClose, onDeleted, toastSuccess]);

  const handleDelete = useCallback(async () => {
    if (!device) return;
    const title = device.name || device.deviceId;
    setLoading(true);
    clearError();
    try {
      await operatorProvisioningService.deleteDevice(device.id);
      toastSuccess(`${title} ist entfernt. Der Geräteplatz ist wieder frei.`);
    } catch (err) {
      logger.error("device_remove_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      if (!isDeviceAlreadyRemoved(err)) {
        void showError(err, { object: "das Entfernen des Geräts" });
        setLoading(false);
        // A session may have started since the dialog opened.
        await refresh();
        return;
      }
      toastSuccess(`${title} ist hier nicht mehr verfügbar.`);
    }
    setLoading(false);
    onClose();
    await onDeleted();
  }, [
    device,
    onClose,
    onDeleted,
    showError,
    clearError,
    refresh,
    toastSuccess,
  ]);

  const blockingSession = status?.activeSession ?? null;
  const blocked = blockingSession !== null || status?.isProtected === true;

  const warning = (
    <div className="space-y-3">
      <LoadErrorAlert error={statusError} />
      {blockingSession ? (
        <Alert
          type="warning"
          message={formatDeviceSessionMessage(
            blockingSession,
            "Beende die Sitzung, bevor du das Gerät entfernst.",
          )}
          action={
            <Button
              type="button"
              variant="ghost_tone"
              size="compact"
              onClick={() => void refresh()}
              disabled={statusLoading}
            >
              Erneut prüfen
            </Button>
          }
        />
      ) : null}
      {status?.isProtected ? (
        <Alert
          type="warning"
          message="Dieses Systemgerät wird für manuelle Web-Buchungen benötigt und kann nicht entfernt werden."
        />
      ) : null}
    </div>
  );

  return (
    <ConfirmDeleteModal
      isOpen={Boolean(device)}
      title="Gerät entfernen"
      description={
        device ? (
          <DeviceRemovalSummary
            title={device.name || device.deviceId}
            deviceId={device.deviceId}
            context={device.schoolName}
          />
        ) : null
      }
      warningSlot={warning}
      gate={{ mode: "twoStep", firstStepLabel: "Ja, entfernen" }}
      confirmDisabled={statusLoading || blocked}
      confirmLabel="Gerät entfernen"
      confirmTooltip="Entfernt das Gerät sofort. Bisherige Anwesenheiten bleiben."
      loadingLabel="Wird entfernt…"
      onConfirm={handleDelete}
      onClose={handleClose}
      loading={loading}
      error={deleteErrors.error}
    />
  );
}
