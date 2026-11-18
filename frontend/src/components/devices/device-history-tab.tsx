"use client";

// Reiter „Verlauf“ eines Geräts im Schulportal (#2321): lädt die Einträge
// des Geräts und zeigt sie als Zeitleiste. Nach einer Änderung am Gerät
// lädt die Seite die Familie `tenantAdminKeys.deviceHistoryFamily` neu.

import { DeviceHistoryList } from "~/components/devices/device-history-list";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { fetchDeviceHistory } from "~/lib/device-history";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";

export function DeviceHistoryTab({ deviceId }: Readonly<{ deviceId: string }>) {
  const { data, isLoading, error, mutate } = useSWRAuth(
    tenantAdminKeys.deviceHistory(deviceId),
    () => fetchDeviceHistory(deviceId),
  );
  const loadError = useSwrLoadError(error, "den Verlauf des Geräts", () =>
    mutate(),
  );
  if (loadError) {
    return <LoadErrorAlert error={loadError} actionLayout="responsive" />;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Wer das Gerät wann geändert hat. Nur zum Lesen.
      </p>
      <DeviceHistoryList
        entries={data ?? []}
        portal="school"
        loading={isLoading || (Boolean(error) && !loadError)}
      />
    </div>
  );
}
