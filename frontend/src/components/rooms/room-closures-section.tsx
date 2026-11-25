"use client";

/**
 * Sperren eines Raums (#7653) auf dem Reiter „Stammdaten“: die laufenden und
 * kommenden Sperren mit Grund, „Raum sperren“ und „Sperre aufheben“.
 */

import { LockSimpleIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { ConfirmationModal } from "~/components/ui/modal";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
  ResponsiveRowActions,
} from "~/components/ui/responsive-action-list";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import {
  addCalendarDays,
  fetchRoomClosures,
  reopenRoom,
  roomClosurePeriod,
  ROOM_CLOSURE_MAX_DAYS,
  type RoomClosure,
} from "~/lib/room-closures-api";
import { useInvalidateFamily, useSWRAuth } from "~/lib/swr";
import { roomKeys } from "~/lib/swr/rooms-keys";
import { RoomClosureModal } from "./room-closure-modal";

const logger = createLogger({ component: "RoomClosuresSection" });

interface RoomClosuresSectionProps {
  readonly roomId: string;
  readonly canReadPlan: boolean;
  readonly planHref: (day: string) => string;
}

export function RoomClosuresSection({
  roomId,
  canReadPlan,
  planHref,
}: RoomClosuresSectionProps) {
  const today = useBerlinToday();
  const until = addCalendarDays(today, ROOM_CLOSURE_MAX_DAYS - 1);
  const closures = useSWRAuth(roomKeys.closures(today, until, roomId), () =>
    fetchRoomClosures(today, until, roomId),
  );
  const loadError = useSwrLoadError(
    closures.error,
    "die Sperren des Raums",
    () => void closures.mutate(),
  );
  const invalidate = useInvalidateFamily();
  const refresh = () => {
    void invalidate(roomKeys.closuresFamily);
    void invalidate(roomKeys.detailKey(roomId));
  };
  const [creating, setCreating] = useState(false);
  const [lifting, setLifting] = useState<RoomClosure | null>(null);
  const [liftPending, setLiftPending] = useState(false);
  const { success: toastSuccess } = useToast();
  const { show: showError } = useApiErrorDisplay();
  const retryLiftRef = useRef<() => void>(() => undefined);

  const lift = async (closure: RoomClosure) => {
    setLiftPending(true);
    try {
      await reopenRoom(roomId, closure.id);
      setLifting(null);
      refresh();
      toastSuccess("Die Sperre ist aufgehoben.");
    } catch (error) {
      logger.error("room_closure_lift_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      setLifting(null);
      retryLiftRef.current = () => void lift(closure);
      void showError(error, {
        object: "das Aufheben der Sperre",
        retry: () => retryLiftRef.current(),
      });
    } finally {
      setLiftPending(false);
    }
  };

  const rows = closures.data ?? [];
  return (
    <SectionCard
      title="Sperren"
      description="Ein gesperrter Raum ist für neue Termine und am Kiosk nicht wählbar."
      action={
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={() => setCreating(true)}
          tooltip="Öffnet den Dialog, um den Raum für einen Zeitraum zu sperren."
        >
          Raum sperren
        </Button>
      }
    >
      {loadError ? (
        <LoadErrorAlert error={loadError} actionLayout="responsive" />
      ) : closures.isLoading && !closures.data ? null : rows.length === 0 ? (
        <EmptyState
          variant="compact"
          title="Der Raum ist nicht gesperrt."
          description="Sperre ihn zum Beispiel bei einem Wasserschaden."
        />
      ) : (
        <ResponsiveActionList>
          {rows.map((closure) => (
            <ResponsiveActionRow key={closure.id}>
              <div className="flex min-w-0 items-start gap-3">
                <LockSimpleIcon
                  className="mt-0.5 size-5 shrink-0 text-gray-500"
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    {closure.reason}
                  </p>
                  <p className="text-sm text-gray-600">
                    {roomClosurePeriod(closure)}
                  </p>
                </div>
                {closure.startDate <= today ? (
                  <StatusBadge label="Heute gesperrt" tone="orange" />
                ) : null}
              </div>
              <ResponsiveRowActions>
                <OverflowMenu
                  ariaLabel={`Aktionen zur Sperre ${closure.reason}`}
                  items={[
                    {
                      label: "Sperre aufheben",
                      description:
                        "Gibt den Raum wieder frei, moto fragt vorher nach.",
                      onClick: () => setLifting(closure),
                    },
                  ]}
                />
              </ResponsiveRowActions>
            </ResponsiveActionRow>
          ))}
        </ResponsiveActionList>
      )}

      <RoomClosureModal
        isOpen={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          refresh();
          toastSuccess("Der Raum ist gesperrt.");
        }}
        roomId={roomId}
        today={today}
        canReadPlan={canReadPlan}
        planHref={planHref}
      />
      <ConfirmationModal
        isOpen={lifting !== null}
        onClose={() => setLifting(null)}
        onConfirm={() => {
          if (lifting) void lift(lifting);
        }}
        title="Sperre aufheben?"
        confirmText="Aufheben"
        confirmTooltip="Gibt den Raum sofort wieder für neue Termine und den Kiosk frei."
        isConfirmLoading={liftPending}
        loadingText="Wird aufgehoben …"
      >
        {lifting ? (
          <p className="text-sm text-gray-700">
            Der Raum ist dann {roomClosurePeriod(lifting)} wieder wählbar.
          </p>
        ) : null}
      </ConfirmationModal>
    </SectionCard>
  );
}
