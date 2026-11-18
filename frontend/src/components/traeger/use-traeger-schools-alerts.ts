"use client";

import { useSession } from "next-auth/react";
import { isDemoBuild } from "~/lib/demo-build";
import {
  useConfirmedResource,
  useRefusalGuard,
} from "./use-traeger-confirmed-resource";
import { useSWRAuth } from "~/lib/swr";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { fetchTraegerSchoolsAlerts } from "~/lib/traeger-api";

/** The Träger portal has no live channel; the figures refresh by the minute. */
const ALERTS_REFRESH_MS = 60_000;
const DEMO_ALERTS_REFRESH_MS = 5_000;

/**
 * The figures of now and the hints of every school of the Träger (#4674,
 * #4675): numbers only, no person data. One request carries both, so the
 * demo polls more frequently while the visitor's simulation starts.
 *
 * `error` is the load error card: only without confirmed figures, or on a
 * refusal. A failed refresh with confirmed figures keeps them and sets
 * `refreshFailed`; `reload` asks again.
 */
export function useTraegerSchoolsAlerts() {
  const { data: session } = useSession();
  const key =
    session?.user.scope === "org" ? traegerKeys.schoolsAlerts() : null;
  const guard = useRefusalGuard(key);
  const response = useSWRAuth(key, fetchTraegerSchoolsAlerts, {
    revalidateOnFocus: true,
    refreshInterval: isDemoBuild() ? DEMO_ALERTS_REFRESH_MS : ALERTS_REFRESH_MS,
    ...guard.callbacks,
  });
  const alerts = useConfirmedResource(response, guard, "die Schulübersicht");
  const confirmed = alerts.data !== null;
  return {
    alerts: alerts.data,
    // A failed reload keeps confirmed figures and says so; a refusal
    // withdraws them (`useConfirmedResource`).
    error: confirmed ? null : alerts.loadError,
    refreshFailed: confirmed && alerts.failure !== undefined,
    reload: alerts.reload,
  };
}
