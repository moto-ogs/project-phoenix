import type { Session } from "next-auth";
import {
  hasEffectiveAdminScope,
  hasPermission,
  isCaregiver,
} from "~/lib/auth-utils";
import { canOpenRequestsPage } from "~/lib/change-request-access";
import type { HomeBlockAccess } from "~/lib/home-blocks";
import type { OperationalOverviewScope } from "~/lib/tenant-api";

/**
 * `overviewScope` ist die Einstellung der Schule für die schulweite
 * Übersicht (#2380). Fehlt sie, gilt wie überall die enge Sicht „own“.
 */
export function homeBlockAccess(
  session: Session | null,
  hasOwnGroups: boolean,
  overviewScope: OperationalOverviewScope | undefined,
): HomeBlockAccess {
  const isAdminScope = hasEffectiveAdminScope(session);
  return {
    isAdminScope,
    has: (permission) => isAdminScope || hasPermission(session, permission),
    canOpenRequestsPage: canOpenRequestsPage(session),
    caresForGroups: isCaregiver(session),
    hasOwnGroups,
    seesAllBlocks: isAdminScope || overviewScope === "all_staff",
  };
}
