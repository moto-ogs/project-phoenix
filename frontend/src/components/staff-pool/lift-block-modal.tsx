"use client";

// Eine Blockung aufheben (#4709): die Schule ihre eigene, die
// Personalverwaltung jede. Danach ist die Zeit für alle Schulen frei.

import { ConfirmationModal } from "~/components/ui/modal";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { formatDate } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import type { PoolBlock, PoolSpringer } from "~/lib/staff-pool-api";

const logger = createLogger({ component: "LiftBlockModal" });

export interface LiftBlockTarget {
  readonly springer: PoolSpringer;
  readonly block: PoolBlock;
}

export function LiftBlockModal({
  target,
  mode,
  lift,
  onClose,
  onLifted,
}: Readonly<{
  target: LiftBlockTarget | null;
  /** `traeger`: die Personalverwaltung hebt die Blockung einer Schule auf. */
  mode: "school" | "traeger";
  lift: (blockId: string) => Promise<void>;
  onClose: () => void;
  onLifted: (message: string) => void;
}>) {
  const isOpen = target !== null;
  const pending = useFormModalPending(isOpen);
  const { show } = useApiErrorDisplay();
  if (!target) return null;
  const { springer, block } = target;
  const name = `${springer.firstName} ${springer.lastName}`;
  const when = `${formatDate(block.date)}, ${block.startTime} bis ${block.endTime} Uhr`;

  const confirm = () =>
    pending.run(async (op) => {
      if (!block.id) return;
      try {
        await lift(block.id);
        if (!op.isCurrent()) return;
        onLifted(
          `Die Blockung von ${name} am ${formatDate(block.date)} ist aufgehoben.`,
        );
      } catch (err) {
        logger.error("staff_pool_lift_failed", {
          mode,
          error: err instanceof Error ? err.message : String(err),
        });
        if (op.isCurrent()) await show(err, { object: "die Blockung" });
      }
    });

  return (
    <ConfirmationModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={() => void confirm()}
      title="Blockung aufheben?"
      confirmText="Aufheben"
      confirmVariant="warning"
      confirmTooltip={
        mode === "traeger"
          ? "Gibt die Zeit sofort frei. Die Schule sieht, dass du aufgehoben hast."
          : "Gibt die Zeit sofort für alle Schulen frei."
      }
      isConfirmLoading={pending.pending}
      isConfirmDisabled={!block.id}
      confirmDisabledReason="Diese Blockung gehört einer anderen Schule."
      loadingText="Wird aufgehoben …"
    >
      <div className="space-y-2 text-sm text-gray-700">
        <p>
          <span className="font-medium text-gray-900">{name}</span>, {when}
          {mode === "traeger" ? `, geblockt von ${block.schoolName}.` : "."}
        </p>
        <p>
          {mode === "traeger"
            ? "Danach können alle Schulen die Person zu dieser Zeit blocken. Die Schule sieht „Vom Träger aufgehoben“."
            : "Danach können alle Schulen die Person zu dieser Zeit blocken."}
        </p>
      </div>
    </ConfirmationModal>
  );
}
