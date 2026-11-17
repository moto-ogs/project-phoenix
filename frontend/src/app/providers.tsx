"use client";

import { useEffect } from "react";
import { ModalProvider } from "@/components/ui/modal-context";
import { NotificationBridge } from "~/components/notifications/notification-bridge";
import { ServiceWorkerRegistrar } from "~/components/notifications/service-worker-registrar";
import { ModuleNotBookedSlots } from "~/components/tenant/module-not-booked-state";
import { ToastProvider } from "~/contexts/ToastContext";
import { schedulePostHogInitialization } from "~/lib/posthog-client";

/**
 * Root providers — auth-free.
 *
 * Each portal mounts its own SessionProvider: the tenant in
 * [tenant]/providers.tsx, the portals on their own host (operator, parents,
 * school, caterer, Träger) through PortalProviders
 * (~/components/auth/portal-providers), with the base path of the portal
 * table (~/lib/portal-paths). No portal's session reaches another's host.
 */
export function Providers({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  useEffect(schedulePostHogInitialization, []);

  return (
    <ModalProvider>
      <ToastProvider>
        <NotificationBridge />
        <ServiceWorkerRegistrar />
        <ModuleNotBookedSlots>{children}</ModuleNotBookedSlots>
      </ToastProvider>
    </ModalProvider>
  );
}
