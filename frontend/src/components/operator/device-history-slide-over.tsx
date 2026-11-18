"use client";

// Verlauf eines Geräts im Operator-Portal (#2321): dieselbe Zeitleiste wie
// in der Schule, über alle Schulen, die das Gerät hatte, ohne Namen des
// Schulpersonals.

import { DeviceHistoryList } from "~/components/devices/device-history-list";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import {
  SlideOver,
  SlideOverContent,
  SlideOverDescription,
  SlideOverHeader,
  SlideOverTitle,
} from "~/components/ui/slide-over";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { operatorProvisioningService } from "~/lib/operator/provisioning-api";
import type { OperatorDevice } from "~/lib/operator/provisioning-helpers";
// eslint-disable-next-line no-restricted-imports -- operator pages are not tenant-scoped
import { useSWRAuth } from "~/lib/swr";
import { operatorProvisioningKeys } from "~/lib/swr/portal-keys";

function DeviceHistoryBody({ device }: Readonly<{ device: OperatorDevice }>) {
  const { data, isLoading, error, mutate } = useSWRAuth(
    operatorProvisioningKeys.deviceHistory(device.id),
    () => operatorProvisioningService.listDeviceHistory(device.id),
    { revalidateOnFocus: false },
  );
  const loadError = useSwrLoadError(error, "den Verlauf des Geräts", () =>
    mutate(),
  );
  if (loadError) {
    return <LoadErrorAlert error={loadError} actionLayout="responsive" />;
  }
  return (
    <DeviceHistoryList
      entries={data ?? []}
      portal="operator"
      loading={isLoading || (Boolean(error) && !loadError)}
    />
  );
}

export function DeviceHistorySlideOver({
  device,
  onClose,
}: Readonly<{ device: OperatorDevice | null; onClose: () => void }>) {
  return (
    // oxlint-disable-next-line ui-kit/slide-over-pending -- Nur zum Lesen; das Panel speichert nichts.
    <SlideOver
      open={device !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SlideOverContent size="md">
        <SlideOverHeader>
          <SlideOverTitle>Verlauf</SlideOverTitle>
          {device ? (
            <SlideOverDescription>
              {device.name || device.deviceId} · {device.schoolName}
            </SlideOverDescription>
          ) : null}
        </SlideOverHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {device ? (
            <DeviceHistoryBody key={device.id} device={device} />
          ) : null}
        </div>
      </SlideOverContent>
    </SlideOver>
  );
}
