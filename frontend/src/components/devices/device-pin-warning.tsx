"use client";

import { Alert } from "~/components/ui/alert";
import { ButtonLink } from "~/components/ui/button";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import {
  fetchDevicePinSetupReason,
  type DevicePinSetupReason,
} from "~/lib/settings-api";
import { useSWRAuth } from "~/lib/swr";
import { devicePinKeys } from "~/lib/swr/portal-keys";
import { useTenantAwarePath } from "~/lib/tenant-path";

/** The PIN field on the settings tab „Geräte“. */
export const DEVICE_PIN_SETTINGS_PATH =
  "/settings?tab=devices&highlight=security.ogs_device_pin";

const COPY: Record<DevicePinSetupReason, { title: string; message: string }> = {
  missing: {
    title: "Geräte-PIN fehlt",
    message:
      "Ohne Geräte-PIN kann sich dein Team nicht am Tablet anmelden. Bitte lege jetzt eine PIN fest.",
  },
  too_simple: {
    title: "Geräte-PIN ändern",
    message:
      "Die Geräte-PIN ist leicht zu erraten. Bitte lege eine eigene PIN fest. Danach meldet sich dein Team am Tablet mit der neuen PIN an.",
  },
};

interface DevicePinWarningProps {
  readonly className?: string;
}

/**
 * Asks the school leadership for a device PIN of the school's own (#7175)
 * while NFC-Anwesenheit is booked and the PIN is missing or easy to guess.
 * The notice cannot be dismissed: it goes away once the PIN is set.
 */
export function DevicePinWarning({ className }: DevicePinWarningProps) {
  const tenantPath = useTenantAwarePath();
  const { data, error, mutate } = useSWRAuth(
    devicePinKeys.status(),
    fetchDevicePinSetupReason,
  );
  // The route requires config:manage, the right that sets the PIN. A role
  // without it gets 403: then there is deliberately no notice and no error
  // card it could not resolve.
  const forbidden = (error as { status?: number } | undefined)?.status === 403;
  const loadError = useSwrLoadError(
    forbidden ? undefined : error,
    "den Hinweis zur Geräte-PIN",
    () => mutate(),
  );

  if (error) {
    if (forbidden) return null;
    return <LoadErrorAlert error={loadError} className={className} />;
  }
  if (!data) return null;

  const copy = COPY[data];
  return (
    <Alert
      type="warning"
      announce={data === "missing" ? "assertive" : "polite"}
      title={copy.title}
      message={copy.message}
      className={className}
      action={
        <ButtonLink
          href={tenantPath(DEVICE_PIN_SETTINGS_PATH)}
          variant="surface"
          size="md"
          tooltip="Öffnet die Einstellung Geräte-PIN."
        >
          PIN festlegen
        </ButtonLink>
      }
    />
  );
}
