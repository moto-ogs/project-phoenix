"use client";

// Apart from the service worker registrar: the root layout mounts that one
// on every page, also the public ones, and this reader brings the shared
// cache with it.
import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { createLogger } from "~/lib/logger";
import {
  isPushConfigurationMissing,
  isPushSupported,
  syncExistingPushSubscription,
  type PushPortal,
} from "~/lib/push-api";
import { usePushPublicKey } from "~/lib/hooks/use-push-public-key";
import { reportStandaloneUsage } from "~/lib/pwa-usage-api";

const logger = createLogger({ component: "ServiceWorkerRegistrar" });

/**
 * Rebinds an already opted-in device whenever an authenticated portal session
 * starts. This fixes shared-device and failed-logout cleanup cases without
 * prompting users who have never enabled notifications.
 */
export function PushSubscriptionSync({
  portal,
}: {
  readonly portal: PushPortal;
}) {
  const { data: session, status } = useSession();

  // Re-runs whenever the authenticated identity changes, not just on the
  // status flip: a second tab can swap the account or the school underneath a
  // mounted session, and a subscription still bound to the previous identity
  // would keep delivering that account's notifications to this device (#2208).
  const accountID = session?.user.id;
  const tenantID = session?.user.tenantId;
  // Shared with the guided setup and the settings card: one read per page.
  const pushKey = usePushPublicKey(portal);
  const publicKey = pushKey.state === "ready" ? pushKey.require() : null;

  useEffect(() => {
    // Without a key (not answered yet, Web Push not set up, read failed)
    // there is nothing to rebind to.
    if (status !== "authenticated" || !isPushSupported() || !publicKey) return;
    syncExistingPushSubscription(portal, publicKey).catch((err: unknown) => {
      // Silent rebind on session start; the push card shows the real state.
      if (isPushConfigurationMissing(err)) return;
      logger.warn("push_subscription_sync_failed", {
        portal,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, [portal, status, accountID, tenantID, publicKey]);

  useEffect(() => {
    if (status !== "authenticated" || !accountID) return;
    void reportStandaloneUsage(portal, accountID, tenantID);
  }, [portal, accountID, tenantID, status]);

  return null;
}
