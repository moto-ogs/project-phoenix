"use client";

import { useCallback, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useTenantSlugSafe } from "~/lib/tenant-context";
import { useSidebarMemory } from "~/lib/sidebar-memory";
import { useOptionalSupervision } from "~/lib/supervision-context";
import { tenantPrefetchResources } from "./tenant-prefetch-resources";
import { ResourcePrefetchProvider } from "./resource-prefetch-provider";

/** The tenant alone supplies permissions and exact destination selection. */
export function TenantDataPrefetch({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { data: session } = useSession();
  const slug = useTenantSlugSafe();
  const memory = useSidebarMemory();
  const supervision = useOptionalSupervision();
  const resourcesFor = useCallback(
    async (href: string) => {
      if (!session || !slug) return [];
      return tenantPrefetchResources(href, {
        session,
        slug,
        groupId: memory.read("sidebar-last-group"),
        groups: supervision?.groups.map((group) => group.id) ?? [],
      });
    },
    [session, slug, memory, supervision],
  );
  return (
    <ResourcePrefetchProvider resourcesFor={resourcesFor}>
      {children}
    </ResourcePrefetchProvider>
  );
}
