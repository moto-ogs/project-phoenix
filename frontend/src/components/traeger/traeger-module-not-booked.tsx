"use client";

import { LockSimpleIcon } from "@phosphor-icons/react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, type ReactNode } from "react";

import { Alert } from "~/components/ui/alert";
import { ButtonLink } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import {
  NotBookedSlotProvider,
  type NotBookedSlots,
} from "~/components/ui/not-booked-slot";
import { ModuleBookingAudienceProvider } from "~/contexts/ToastContext";
import { MODULE_BOOKING_STALE_EVENT } from "~/lib/module-not-booked";
import type { ModuleKey } from "~/lib/modules";
import { useInvalidateFamily } from "~/lib/swr";
import {
  TraegerBookedModulesProvider,
  type TraegerBookedModules,
} from "~/lib/traeger-booked-modules";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  TRAEGER_MODULES_SETTINGS_PATH,
  TRAEGER_SCHOOLS_PATH,
  isTraegerDashboardPath,
  seesLockedTraegerModules,
  traegerModuleNotBookedExplanation,
  traegerModuleNotBookedTitle,
  traegerModuleOfPath,
} from "~/lib/traeger-modules";
import { traegerPath } from "~/lib/traeger-url";

/** Der Hinweis für einen Fehlerkasten innerhalb einer bestehenden Seite. */
function TraegerModuleNotBookedAlert({
  module,
  className,
}: {
  readonly module: ModuleKey;
  readonly className?: string;
}) {
  const { data: session } = useSession();
  return (
    <Alert
      type="info"
      message={traegerModuleNotBookedExplanation(
        module,
        seesLockedTraegerModules(session),
      )}
      className={className}
    />
  );
}

/**
 * Der erklärende Zustand für ein moto-Modul, das keine Schule des Trägers
 * gebucht hat (#6052). Er steht dort, wo sonst der Inhalt der Seite stünde:
 * beim Aufruf einer Seite des Moduls und wenn das Backend eine Anfrage mit
 * `module.not_booked` ablehnt. Kein Fehler: Der Text sagt, wer als Nächstes
 * handelt, und wer das Träger-Büro leitet, kommt zur Liste der Module.
 */
function TraegerModuleNotBookedState({
  module,
}: {
  readonly module: ModuleKey;
}) {
  const { data: session } = useSession();
  const leads = seesLockedTraegerModules(session);
  return (
    <EmptyState
      icon={<LockSimpleIcon className="h-12 w-12" aria-hidden="true" />}
      title={traegerModuleNotBookedTitle(module)}
      description={traegerModuleNotBookedExplanation(module, leads)}
      action={
        leads ? (
          <ButtonLink
            href={traegerPath(TRAEGER_MODULES_SETTINGS_PATH)}
            variant="outline"
            size="md"
            tooltip="Öffnet die Einstellungen mit den moto-Modulen deines Trägers."
          >
            Gebuchte moto-Module ansehen
          </ButtonLink>
        ) : undefined
      }
    />
  );
}

/**
 * Erklärt im Träger-Portal ein nicht gebuchtes moto-Modul (#6052): Das
 * Seitengerüst zeigt auf einer Seite des Moduls statt des Inhalts den
 * erklärenden Zustand, Fehlerkästen und Toasts nennen denselben Satz.
 *
 * Solange der Rahmen des Portals nicht geladen ist (`booked.modules` ist
 * `null`), gilt jede Seite als offen, das Backend sperrt selbst. Seiten und
 * Karten lesen denselben Stand über `useTraegerModuleBooked`.
 */
export function TraegerModuleGate({
  booked,
  children,
}: {
  readonly booked: TraegerBookedModules;
  readonly children: ReactNode;
}) {
  const bookedModules = booked.modules;
  const pathname = usePathname() ?? "/";
  const { data: session } = useSession();
  const pageModule = traegerModuleOfPath(pathname);
  const notBooked =
    bookedModules !== null &&
    pageModule !== null &&
    !bookedModules.includes(pageModule)
      ? pageModule
      : null;
  // The dashboard is the start page of the portal: without its module the
  // school list takes over, so nobody lands on an explanation after signing
  // in (`TRAEGER_DASHBOARD_PATH`).
  const router = useRouter();
  const leavesDashboard =
    notBooked !== null && isTraegerDashboardPath(pathname);
  useEffect(() => {
    if (leavesDashboard) router.replace(traegerPath(TRAEGER_SCHOOLS_PATH));
  }, [leavesDashboard, router]);
  // A request refused with `module.not_booked` means the moto team changed
  // a booking since the frame was read: read it again, so navigation and
  // pages follow without a reload (the event of `announceModuleBookingStale`).
  const invalidateFamily = useInvalidateFamily();
  useEffect(() => {
    const refresh = () => void invalidateFamily(traegerKeys.organization());
    window.addEventListener(MODULE_BOOKING_STALE_EVENT, refresh);
    return () =>
      window.removeEventListener(MODULE_BOOKING_STALE_EVENT, refresh);
  }, [invalidateFamily]);
  const slots = useMemo<NotBookedSlots>(
    () => ({
      Alert: TraegerModuleNotBookedAlert,
      State: TraegerModuleNotBookedState,
      pageModule: notBooked,
    }),
    [notBooked],
  );
  return (
    <ModuleBookingAudienceProvider
      seesLockedModules={seesLockedTraegerModules(session)}
    >
      <TraegerBookedModulesProvider value={booked}>
        <NotBookedSlotProvider slots={slots}>{children}</NotBookedSlotProvider>
      </TraegerBookedModulesProvider>
    </ModuleBookingAudienceProvider>
  );
}
