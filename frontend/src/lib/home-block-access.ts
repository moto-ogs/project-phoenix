import type { Session } from "next-auth";
import {
  hasEffectiveAdminScope,
  hasPermission,
  isCaregiver,
} from "~/lib/auth-utils";
import { canOpenRequestsPage } from "~/lib/change-request-access";
import type { HomeBlockAccess } from "~/lib/home-blocks";

export function homeBlockAccess(
  session: Session | null,
  hasOwnGroups: boolean,
): HomeBlockAccess {
  const isAdminScope = hasEffectiveAdminScope(session);
  return {
    isAdminScope,
    has: (permission) => isAdminScope || hasPermission(session, permission),
    canOpenRequestsPage: canOpenRequestsPage(session),
    caresForGroups: isCaregiver(session),
    hasOwnGroups,
  };
}
