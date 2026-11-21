import { useTranslations } from "next-intl";
import { StatusBadge } from "~/components/ui/status-badge";
import type { HolidayPlacement } from "~/lib/parent-holiday-registration-entries";
import { HOLIDAY_PLACEMENT_BADGES } from "./holiday-registration-badges";

/**
 * The placement of one booked week as a badge; „–“ for a placement this
 * build does not know, so no page promises a place it cannot read.
 */
export function HolidayPlacementBadge({
  placement,
  size,
}: Readonly<{ placement: HolidayPlacement | undefined; size?: "xs" }>) {
  const t = useTranslations("holidayRegistration");
  if (placement === undefined) {
    return <span className="text-sm text-gray-500">–</span>;
  }
  const badge = HOLIDAY_PLACEMENT_BADGES[placement];
  return <StatusBadge label={t(badge.key)} tone={badge.tone} size={size} />;
}
