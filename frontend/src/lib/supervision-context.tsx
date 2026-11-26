"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { ApiError } from "~/lib/api-error";
import { isReadRefusal } from "~/lib/access-refusal";
import { authGeneration } from "~/lib/swr";
import {
  useSupervisionSnapshot,
  type RefreshSupervision,
} from "~/lib/swr/supervision";
import { useTenantSafe } from "~/lib/tenant-context";
import {
  deriveSupervision,
  type DerivedSupervision,
} from "~/lib/supervision-derive";

interface SupervisionContextType extends DerivedSupervision {
  hasGroups: boolean;
  isLoadingGroups: boolean;
  groupsLoadFailed?: boolean;
  sessionsLoadFailed?: boolean;
  releasedRoomsLoadFailed?: boolean;
  isLoadingSupervision: boolean;
  ownSessionsError?: Error;
  refresh: RefreshSupervision;
}

const SupervisionContext = createContext<SupervisionContextType | undefined>(
  undefined,
);
const EMPTY = deriveSupervision();
const UNAVAILABLE = new ApiError("Supervision section unavailable", 503);

export function SupervisionProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const tenant = useTenantSafe();
  const binding = authGeneration(session);
  const tenantIdentifier =
    tenant?.routingMode === "subdomain"
      ? tenant.tenant?.subdomain
      : tenant?.tenant?.slug;
  const enabled =
    binding !== null &&
    !session?.user.scope &&
    tenant?.tenant?.tenantId !== undefined &&
    tenant.tenant.tenantId === session?.user.tenantId &&
    tenantIdentifier === tenant.tenantSlug;
  const { data, error, refresh } = useSupervisionSnapshot(enabled, binding);
  const snapshot = enabled ? data : undefined;
  const derived = useMemo(
    () => (snapshot ? deriveSupervision(snapshot) : EMPTY),
    [snapshot],
  );
  const loading = status === "loading" || (enabled && !snapshot && !error);
  const failed = error && !isReadRefusal(error) ? error : undefined;
  const ownSessionsError =
    failed ??
    (snapshot?.sessions?.own_status === "unavailable"
      ? UNAVAILABLE
      : undefined);
  const groupsLoadFailed =
    Boolean(failed) || snapshot?.groups?.status === "unavailable";
  const sessionsLoadFailed =
    Boolean(failed) ||
    snapshot?.sessions?.status === "unavailable" ||
    snapshot?.sessions?.own_status === "unavailable" ||
    snapshot?.sessions?.overview_status === "unavailable";

  const releasedRoomsLoadFailed =
    Boolean(failed) || snapshot?.released_rooms?.status === "unavailable";

  const value = useMemo(
    () => ({
      ...derived,
      hasGroups: derived.groups.length > 0,
      isLoadingGroups: loading,
      isLoadingSupervision: loading,
      groupsLoadFailed,
      sessionsLoadFailed,
      releasedRoomsLoadFailed,
      ownSessionsError,
      refresh,
    }),
    [
      derived,
      loading,
      groupsLoadFailed,
      sessionsLoadFailed,
      releasedRoomsLoadFailed,
      ownSessionsError,
      refresh,
    ],
  );

  return (
    <SupervisionContext.Provider value={value}>
      {children}
    </SupervisionContext.Provider>
  );
}

export function useSupervision() {
  const context = useContext(SupervisionContext);
  if (!context)
    throw new Error("useSupervision must be used within a SupervisionProvider");
  return context;
}

const EMPTY_SUPERVISION: SupervisionContextType = {
  ...EMPTY,
  hasGroups: false,
  isLoadingGroups: false,
  isLoadingSupervision: false,
  refresh: () => Promise.resolve(),
};

export function useOptionalSupervision(): SupervisionContextType {
  return useContext(SupervisionContext) ?? EMPTY_SUPERVISION;
}
