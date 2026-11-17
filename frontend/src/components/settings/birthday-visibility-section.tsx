"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Cake } from "lucide-react";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { Skeleton } from "~/components/ui/skeleton";
import { SectionCard } from "~/components/ui/section-card";
import { SwitchRow } from "~/components/ui/switch";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import { createLogger } from "~/lib/logger";
import { fetchBirthdayOptOut, updateBirthdayOptOut } from "~/lib/birthdays-api";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";

const logger = createLogger({ component: "BirthdayVisibilitySection" });

/**
 * Personal opt-out from the birthday display (#1542).
 *
 * Self-service on purpose: the school setting decides whether staff birthdays
 * may be shown at all, but whether MY name appears on a screen every colleague
 * sees is my decision, not an admin's. The switch below is phrased positively
 * ("mein Geburtstag darf erscheinen") and stored inverted as the opt-out.
 *
 * The card hides itself for accounts without a staff record (the backend
 * answers workforce.staff_profile_missing) rather than offering a setting that cannot apply to anyone.
 */
export function BirthdayVisibilitySection() {
  const [busy, setBusy] = useState(false);
  const {
    data: optOut,
    error: optOutError,
    mutate,
  } = useSWRAuth(tenantAdminKeys.birthdayOptOut(), fetchBirthdayOptOut);
  // Konten ohne Personaldatensatz haben nichts abzuwählen: die Karte
  // blendet sich aus, statt einen Fehler zu zeigen.
  const unavailable =
    optOut === undefined &&
    optOutError instanceof ApiError &&
    wireErrorCode(optOutError.code) === "workforce.staff_profile_missing";
  // Laden: Fehler vor Ort mit Wiederholen. Umschalten ist ein Schalter ohne
  // Formular: ein Fehler kommt als Toast (#2517).
  const { error: loadError, failure } = useSwrResourceLoadError(
    [{ data: optOut, error: unavailable ? undefined : optOutError }],
    "die Einstellung zum Geburtstag",
    () => mutate(),
  );
  const { show: showSaveError } = useApiErrorDisplay();
  const latestToggleRef = useRef<(next: boolean) => void>(() => undefined);
  const visible = optOut === undefined ? true : !optOut;

  const toggle = async (nextVisible: boolean) => {
    // Optimistic: the switch answers immediately and rolls back on failure.
    const previous = optOut;
    setBusy(true);
    void mutate(!nextVisible, { revalidate: false });
    try {
      await updateBirthdayOptOut(!nextVisible);
    } catch (err) {
      logger.error("birthday_opt_out_save_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void mutate(previous, { revalidate: false });
      void showSaveError(err, {
        object: "die Einstellung zum Geburtstag",
        retry: () => latestToggleRef.current(nextVisible),
      });
    } finally {
      setBusy(false);
    }
  };

  useLayoutEffect(() => {
    latestToggleRef.current = (next) => void toggle(next);
  });

  if (unavailable) return null;

  return (
    <SectionCard
      icon={Cake}
      headingLevel={3}
      title="Geburtstag"
      description="Ihr Name erscheint in der Geburtstagsübersicht auf der Startseite, ohne Geburtsjahr."
    >
      {/* Bis der Text eines Ladefehlers da ist, bleibt das Skelett stehen:
          kein Schalter mit geratenem Stand. */}
      {(optOut === undefined && !failure) || (failure && !loadError) ? (
        <Skeleton className="h-10 w-full" />
      ) : failure ? (
        <LoadErrorAlert error={loadError} />
      ) : (
        <SwitchRow
          label="Meinen Geburtstag auf der Startseite anzeigen"
          checked={visible}
          onCheckedChange={(next) => void toggle(next)}
          disabled={busy}
        />
      )}
    </SectionCard>
  );
}
