"use client";

import { useCallback } from "react";

import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import type { RefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import { operatorProvisioningService } from "~/lib/operator/provisioning-api";
import type { OperatorDevice } from "~/lib/operator/provisioning-helpers";

const logger = createLogger({ component: "useDeviceBlocking" });

/**
 * Blocks or unblocks a device from an operator device table (Gerätesperre,
 * #2317). Both act at once and can be undone at once, so they run without a
 * confirmation dialog; the toast after a block offers „Rückgängig“.
 */
export function useDeviceBlocking(onChanged: RefreshAfterWrite) {
  const { success: toastSuccess } = useToast();
  const { show: showError } = useApiErrorDisplay();

  return useCallback(
    async function setBlocked(device: OperatorDevice, blocked: boolean) {
      const title = device.name || device.deviceId;
      try {
        await operatorProvisioningService.setDeviceBlocked(device.id, blocked);
      } catch (err) {
        logger.error("device_block_failed", {
          blocked,
          error: err instanceof Error ? err.message : String(err),
        });
        void showError(err, {
          object: blocked
            ? "das Sperren des Geräts"
            : "das Entsperren des Geräts",
          retry: () => void setBlocked(device, blocked),
        });
        return;
      }
      // Undo restores access, so it is offered only when the device had it.
      if (blocked && device.status === "active") {
        toastSuccess(
          `${title} ist gesperrt. Der Kiosk wird abgewiesen, bis du das Gerät entsperrst.`,
          {
            action: {
              label: "Rückgängig",
              tooltip: "Entsperrt das Gerät sofort wieder.",
              onClick: () => void setBlocked(device, false),
            },
          },
        );
      } else if (blocked) {
        toastSuccess(
          `${title} ist gesperrt. Der Kiosk wird abgewiesen, bis du das Gerät entsperrst.`,
        );
      } else {
        toastSuccess(`${title} ist entsperrt und kann sich wieder anmelden.`);
      }
      await onChanged();
    },
    [onChanged, showError, toastSuccess],
  );
}
