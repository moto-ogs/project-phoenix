import type { ResolvedPresence } from "~/lib/presence-status";
import { PresenceHint } from "./presence-hint";
import { StatusColorBadge } from "~/components/ui/status-color-badge";

export type PresenceBadgeSize = "sm" | "md" | "lg";
export type PresenceBadgeVariant = "simple" | "modern";
/**
 * Which part to render: everything (default) or the pill with „seit“ only.
 * The App row list (#8070) puts the hint into the row's second line so it
 * never shortens the name.
 */
export type PresenceBadgePart = "all" | "pill";

/** The kit pill shape for the badge's own size and variant props. */
function pillShape(
  size: PresenceBadgeSize,
  variant: PresenceBadgeVariant,
): { size?: "xs"; compact?: boolean } {
  if (size === "sm") return { size: "xs" };
  return size === "md" && variant === "simple" ? { compact: true } : {};
}

interface PresenceBadgeViewProps {
  readonly presence: ResolvedPresence;
  readonly size: PresenceBadgeSize;
  readonly variant: PresenceBadgeVariant;
  readonly showLocationSince: boolean;
  readonly part?: PresenceBadgePart;
}

/**
 * Renders a resolved presence: the pill, „seit … Uhr“ and at most one hint
 * below it. Shared by `LocationBadge` and `PresenceBadge`; it decides nothing.
 */
export function PresenceBadgeView({
  presence,
  size,
  variant,
  showLocationSince,
  part = "all",
}: PresenceBadgeViewProps) {
  const { pill, since, hint } = presence;
  return (
    <div className="flex max-w-full min-w-0 flex-col items-end">
      <StatusColorBadge
        {...pillShape(size, variant)}
        wrap
        label={pill.label}
        color={pill.color}
        data-location-status={pill.locationStatus}
        data-presence-state={pill.presenceState}
        title={pill.title}
      />
      {showLocationSince && since !== null && (
        <span className="mt-0.5 text-xs text-gray-500">seit {since} Uhr</span>
      )}
      {hint && part === "all" && (
        <PresenceHint status={hint.status} size={size} title={hint.title} />
      )}
    </div>
  );
}
