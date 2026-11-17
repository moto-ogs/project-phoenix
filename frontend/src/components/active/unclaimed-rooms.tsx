"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { activeService } from "~/lib/active-api";
import type { Supervisor } from "~/lib/active-helpers";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { SpinnerIcon } from "~/components/ui/icons";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { schoolyardConcept } from "~/lib/concepts/schoolyard";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { SCHULHOF_SUPERVISE_TOOLTIP } from "~/components/active-supervisions/supervision-action-hints";
import { useSWRAuth } from "~/lib/swr";
import { me } from "~/lib/swr/me";
import { checkinTargetKeys } from "~/lib/swr/rooms-keys";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";

const logger = createLogger({ component: "UnclaimedRooms" });

// NOTE: Schulhof is now handled as a permanent tab in active-supervisions page.
// This banner is disabled and returns null. Keeping the component for future
// use with other unclaimed rooms if needed.
const SCHULHOF_ROOM_NAME = "Schulhof";
const DISMISSED_KEY = "schulhof-banner-dismissed";

// Feature flag: set to true to re-enable the banner (not recommended while permanent tab exists)
const ENABLE_SCHULHOF_BANNER = false;

/** Minimal interface for groups passed from parent - compatible with both helper types */
interface MinimalActiveGroup {
  id: string;
  room?: { name?: string };
}

interface UnclaimedRoomsProps {
  readonly onClaimed: () => void;
  /** Pre-fetched active groups to avoid duplicate API call */
  readonly activeGroups?: ReadonlyArray<MinimalActiveGroup>;
  /** Current staff ID to check supervisor status without extra API call */
  readonly currentStaffId?: string;
}

const NO_SUPERVISORS: readonly Supervisor[] = [];

/**
 * Schulhof is now handled by the permanent tab in active-supervisions page.
 * While the banner is disabled it reads nothing.
 */
export function UnclaimedRooms(props: UnclaimedRoomsProps) {
  if (!ENABLE_SCHULHOF_BANNER) return null;
  return <SchulhofBanner {...props} />;
}

function SchulhofBanner({
  onClaimed,
  activeGroups: providedGroups,
  currentStaffId: providedStaffId,
}: UnclaimedRoomsProps) {
  // Use provided groups if available and non-empty, otherwise read all
  // active groups: the banner shows even when the parent has no cached groups.
  const hasProvidedGroups = !!providedGroups && providedGroups.length > 0;
  const groups = useSWRAuth(
    hasProvidedGroups ? null : checkinTargetKeys.activeGroups(),
    () => activeService.getActiveGroups({ active: true }),
  );
  const allGroups: ReadonlyArray<MinimalActiveGroup> | undefined =
    hasProvidedGroups ? providedGroups : groups.data;
  const schulhofGroup = allGroups?.find(
    (g) => g.room?.name === SCHULHOF_ROOM_NAME,
  );
  // A failed supervisor list counts as none: the banner is an extra offer,
  // the Schulhof tab stays the way to take over.
  const supervisorList = useSWRAuth(
    schulhofGroup
      ? tenantDailyKeys.activeGroupSupervisors(schulhofGroup.id)
      : null,
    () => activeService.getActiveGroupSupervisors(schulhofGroup?.id ?? ""),
    { keepPreviousData: false },
  );
  // Bewusst still: ohne Personalprofil gilt niemand als Aufsicht, das Banner
  // bietet die Übernahme dann an.
  const ownStaff = useSWRAuth(providedStaffId ? null : me.key(), me.fetcher);
  const supervisors = (supervisorList.data ?? NO_SUPERVISORS).filter(
    (s) => s.isActive,
  );
  const supervisorsSettled =
    supervisorList.data !== undefined || supervisorList.error !== undefined;
  const loading = hasProvidedGroups
    ? schulhofGroup !== undefined && !supervisorsSettled
    : groups.data === undefined
      ? !groups.error
      : schulhofGroup !== undefined && !supervisorsSettled;
  const staffId = providedStaffId ?? ownStaff.data?.id ?? null;
  const isUserSupervisor =
    staffId !== null && supervisors.some((s) => s.staffId === staffId);

  const [claiming, setClaiming] = useState(false);
  const { show: showError } = useApiErrorDisplay();
  // „Wiederholen“ übernimmt mit dem aktuellen Stand.
  const retryClaimRef = useRef<() => void>(() => undefined);
  const [dismissed, setDismissed] = useState(false);

  // Nach dem Übernehmen lädt das Banner nach; ein Fehler dabei ist kein
  // Fehler der Übernahme (#6652).
  const claimAfterWrite = useRefreshAfterWrite(
    "die Anzeige des Schulhofs",
    () => supervisorList.mutate(),
  );

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISSED_KEY) === "true");
  }, []);

  // Without supervisors the dismissal ends: the next supervisor brings the
  // banner back.
  const noSupervisors =
    supervisorList.data !== undefined && supervisors.length === 0;
  useEffect(() => {
    if (!noSupervisors) return;
    setDismissed(false);
    localStorage.removeItem(DISMISSED_KEY);
  }, [noSupervisors]);

  async function handleClaim() {
    if (!schulhofGroup) return;

    try {
      setClaiming(true);
      await activeService.claimActiveGroup(schulhofGroup.id);
      onClaimed();
      await claimAfterWrite.refresh();
    } catch (err) {
      logger.error("failed to claim schulhof", {
        error: err instanceof Error ? err.message : String(err),
      });
      void showError(err, {
        object: "die Schulhof-Aufsicht",
        retry: () => retryClaimRef.current(),
      });
    } finally {
      setClaiming(false);
    }
  }

  function handleDismiss() {
    setDismissed(true);
    localStorage.setItem(DISMISSED_KEY, "true");
  }

  useLayoutEffect(() => {
    retryClaimRef.current = () => void handleClaim();
  });

  if (loading || !schulhofGroup || isUserSupervisor) return null;

  // Don't show if dismissed (but only when there ARE supervisors)
  if (dismissed && supervisors.length > 0) {
    return null;
  }

  const hasSupervisors = supervisors.length > 0;
  const supervisorNames = supervisors
    .map((s) => s.staffName ?? "Unbekannt")
    .join(", ");

  return (
    <>
      <LoadErrorAlert error={claimAfterWrite.error} className="mb-4" />
      <Alert
        type="warning"
        announce="off"
        className="mb-4"
        icon={<MotoConceptIcon concept={schoolyardConcept} size={20} />}
        title="Schulhof-Aufsicht verfügbar"
        message={
          hasSupervisors
            ? `Aktuelle Aufsicht: ${supervisorNames}`
            : "Der Schulhof hat derzeit keine Aufsicht."
        }
        // Ein Schließen-X nur, solange jemand den Schulhof beaufsichtigt: ohne
        // Aufsicht bleibt der Hinweis stehen.
        onDismiss={hasSupervisors ? handleDismiss : undefined}
        dismissLabel="Banner schließen"
        action={
          <Button
            type="button"
            variant="primary"
            size="compact"
            onClick={() => void handleClaim()}
            disabled={claiming}
            tooltip={SCHULHOF_SUPERVISE_TOOLTIP}
          >
            {claiming ? (
              <span className="flex items-center gap-2">
                <SpinnerIcon />
                Wird übernommen...
              </span>
            ) : (
              "Beaufsichtigen"
            )}
          </Button>
        }
      />
    </>
  );
}
