"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { Modal } from "~/components/ui/modal";
import { PushInstallSteps } from "~/components/settings/push-install-steps";
import {
  fetchNotificationPreferences,
  setNotificationPreference,
} from "~/lib/notification-preferences-api";
import type * as sharedContract from "~/lib/contract/shared.generated";
import { useApiFormError } from "~/contexts/ToastContext";
import { trackOnboardingSurface } from "~/lib/analytics";
import { createLogger } from "~/lib/logger";
import { useInvalidateMatching, useSWRAuth } from "~/lib/swr";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import {
  isPushConfigurationMissing,
  isPushSupported,
  isStandaloneApp,
  needsIOSInstall,
  subscribePush,
  syncExistingPushSubscription,
  type PushPortal,
} from "~/lib/push-api";
import { usePushPublicKey } from "~/lib/hooks/use-push-public-key";
import {
  canPromptInstall,
  isAndroidDevice,
  isInstallationCompleted,
  isSamsungInternet,
  subscribeInstallPrompt,
  triggerInstallPrompt,
} from "~/lib/pwa-install-prompt";
import { useTenantSlugSafe } from "~/lib/tenant-context";
import { setupStorageKey } from "./notification-setup-decision";
import { notificationsConcept } from "~/lib/concepts/notifications";
import { devicesConcept } from "~/lib/concepts/devices";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";

export { setupStorageKey } from "./notification-setup-decision";

const logger = createLogger({ component: "NotificationSetupDialog" });
const INSTALL_GUIDE_REMIND_MS = 24 * 60 * 60 * 1000;
const REMIND_LATER_MS = 7 * 24 * 60 * 60 * 1000;
const ACTION_CLASS = "w-full sm:w-auto";

type SetupMode = "enable" | "install-ios" | "install-android" | "denied";

/**
 * This device reached the step that needs the account's preferences;
 * `subscribed` is undefined until its push subscription is checked.
 */
interface PreferencesCheck {
  readonly subscribed: boolean | undefined;
}

interface StoredDecision {
  readonly done?: boolean;
  readonly remindAfter?: number;
}

function readDecision(key: string): StoredDecision {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as StoredDecision) : {};
  } catch {
    // Unreadable browser storage counts as "not decided yet".
    return {};
  }
}

function writeDecision(key: string, decision: StoredDecision): void {
  try {
    localStorage.setItem(key, JSON.stringify(decision));
  } catch {
    // The setup still works when browser storage is unavailable.
  }
}

/**
 * Guided first-run setup for notifications, shared by all three portals
 * (#2831). It answers the two questions people cannot answer themselves —
 * "is moto installed?" and "may moto notify me?" — and offers exactly the
 * next step that is missing on this device.
 *
 * Ran only in the parents portal before. Staff and Lehrkräfte were left to
 * find the switch in the settings on their own, which is the misunderstanding
 * the issue starts from.
 *
 * `restartToken` reopens the dialog from the settings card: a changed value
 * re-runs the inspection, even when this browser stored "done" long ago.
 */
export function NotificationSetupDialog({
  portal,
  accountId,
  restartToken = 0,
  onFinished,
}: Readonly<{
  portal: PushPortal;
  accountId: string;
  restartToken?: number;
  onFinished?: () => void;
}>) {
  const t = useTranslations("parentNotificationSetup");
  const tenantSlug = useTenantSlugSafe();
  const storageKey = useMemo(
    () => setupStorageKey(portal, accountId, tenantSlug),
    [accountId, portal, tenantSlug],
  );
  // Shared with the session sync and the settings card: one read per page.
  const pushKey = usePushPublicKey(portal);
  const [mode, setMode] = useState<SetupMode | null>(null);
  const [types, setTypes] = useState<sharedContract.PreferenceState[]>([]);
  const [check, setCheck] = useState<PreferencesCheck | null>(null);
  // The same cached read as the settings card: on the settings page both
  // share one request instead of one each (#7429 did the same for the key).
  // Within a page load the card's answer is current, so it is not read again.
  const { data: preferences, error: preferencesError } = useSWRAuth(
    check ? tenantAdminKeys.notificationPreferences(portal) : null,
    () => fetchNotificationPreferences(portal),
    { revalidateIfStale: false },
  );
  const [busy, setBusy] = useState(false);
  // Fehler bleiben im offenen Dialog (#2517). Ein API-Fehler zeigt im OGS-
  // und Schulportal den Katalogtext; das Elternportal und Ablehnungen des
  // Browsers behalten ihren übersetzten Satz (#2518).
  const dialogRef = useRef<HTMLDivElement>(null);
  const dialogErrors = useApiFormError(dialogRef);
  const latestEnableRef = useRef<() => void>(() => undefined);
  const [installAccepted, setInstallAccepted] = useState(false);
  const installPromptReady = useSyncExternalStore(
    subscribeInstallPrompt,
    canPromptInstall,
    () => false,
  );
  const installationCompleted = useSyncExternalStore(
    subscribeInstallPrompt,
    isInstallationCompleted,
    () => false,
  );

  // Einstieg messen (#7556): nur der Dialog, der sich von selbst öffnet, ist
  // eine Fläche des Einstiegs. Den Neustart aus der Einstellungskarte hat die
  // Person selbst angefordert; er zählt nicht mit. Ohne Einwilligung und ohne
  // Freigabe der Schule (Eltern: aller Schulen) sendet die Erfassung nichts.
  const reportsSurface = restartToken === 0;
  const shownReportedRef = useRef(false);
  useEffect(() => {
    if (!mode || !reportsSurface || shownReportedRef.current) return;
    // Einmal je Öffnung: der Wechsel zwischen den Schritten (Installieren,
    // Einschalten, abgelehnt) ist dieselbe Fläche.
    shownReportedRef.current = true;
    trackOnboardingSurface("shown", "notification_setup");
  }, [mode, reportsSurface]);
  const reportOutcome = (action: "accepted" | "dismissed") => {
    if (reportsSurface) trackOnboardingSurface(action, "notification_setup");
  };

  const close = useCallback(
    (mode: SetupMode | null) => {
      setMode(mode);
      if (mode === null) onFinished?.();
    },
    [onFinished],
  );

  // oxlint-disable-next-line swr/no-effect-load -- inspects this device's install, Notification permission and push subscription (syncs it with the server); per-device browser state, not a shared resource
  useEffect(() => {
    let active = true;
    const decision = readDecision(storageKey);
    // A restart from the settings card ignores the stored decision on purpose:
    // the person just asked for the setup again.
    if (
      restartToken === 0 &&
      (decision.done ||
        (decision.remindAfter !== undefined &&
          decision.remindAfter > Date.now()))
    ) {
      return;
    }

    // Every path below needs the server's answer about Web Push first.
    if (pushKey.state === "loading") return;

    const inspect = async () => {
      if (needsIOSInstall()) {
        try {
          pushKey.require();
          if (active) setMode("install-ios");
        } catch (err) {
          // Prüfung ohne Zutun der Person: scheitert sie, öffnet sich der
          // Dialog einfach nicht. Die Einstellungskarte bietet ihn weiter an.
          if (!isPushConfigurationMissing(err)) {
            logger.warn("push_configuration_check_failed", {
              portal,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return;
      }
      if (
        isAndroidDevice(window.navigator) &&
        !isSamsungInternet(window.navigator) &&
        !isStandaloneApp() &&
        !installationCompleted &&
        !installAccepted
      ) {
        try {
          pushKey.require();
          if (active) setMode("install-android");
        } catch (err) {
          // Prüfung ohne Zutun der Person: scheitert sie, öffnet sich der
          // Dialog einfach nicht. Die Einstellungskarte bietet ihn weiter an.
          if (!isPushConfigurationMissing(err)) {
            logger.warn("push_configuration_check_failed", {
              portal,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return;
      }
      if (!isPushSupported()) return;
      if (Notification.permission === "denied") {
        if (active) setMode("denied");
        return;
      }

      try {
        const publicKey = pushKey.require();
        // Starts the preferences read beside the subscription check.
        if (active) setCheck({ subscribed: undefined });
        const subscription = await syncExistingPushSubscription(
          portal,
          publicKey,
        );
        if (active) setCheck({ subscribed: Boolean(subscription) });
      } catch (err) {
        // Same: a failed background check only means the dialog stays shut.
        if (active) setCheck(null);
        if (isPushConfigurationMissing(err)) return;
        logger.warn("notification_setup_check_failed", {
          portal,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    void inspect();
    return () => {
      active = false;
    };
  }, [
    installAccepted,
    installationCompleted,
    installPromptReady,
    portal,
    pushKey,
    restartToken,
    storageKey,
  ]);

  // Decides once both answers are there, then stops reading.
  useEffect(() => {
    if (check?.subscribed === undefined) return;
    if (preferences === undefined) {
      if (preferencesError === undefined) return;
      setCheck(null);
      logger.warn("notification_setup_check_failed", {
        portal,
        error:
          preferencesError instanceof Error
            ? preferencesError.message
            : String(preferencesError),
      });
      return;
    }
    setCheck(null);
    if (!preferences.tenant_enabled) return;
    setTypes(preferences.types);
    const hasEnabledType = preferences.types.some(
      (type) => type.available && type.enabled,
    );
    if (!check.subscribed || !hasEnabledType) setMode("enable");
    else writeDecision(storageKey, { done: true });
  }, [check, portal, preferences, preferencesError, storageKey]);

  // „Später“: die Person schiebt die Einrichtung auf (Später erinnern, X,
  // Hintergrund, Verstanden, Anleitung schließen).
  const remindLater = () => {
    reportOutcome("dismissed");
    writeDecision(storageKey, { remindAfter: Date.now() + REMIND_LATER_MS });
    close(null);
  };

  const finishInstallGuide = () => {
    reportOutcome("dismissed");
    writeDecision(storageKey, {
      remindAfter: Date.now() + INSTALL_GUIDE_REMIND_MS,
    });
    close(null);
  };

  const installAndroid = async () => {
    setBusy(true);
    dialogErrors.clear();
    try {
      const outcome = await triggerInstallPrompt();
      if (outcome === "accepted") {
        // The Android install prompt comes before preferences are inspected.
        // Do not expose the enable action until the follow-up inspection has
        // confirmed that this tenant permits notifications and loaded its types.
        setInstallAccepted(true);
        setMode(null);
      }
    } catch (err) {
      logger.warn("app_install_failed", {
        portal,
        error: err instanceof Error ? err.message : String(err),
      });
      // Kein API-Fehler: der Browser hat die Installation nicht angeboten.
      dialogErrors.invalid(t("installError"));
    } finally {
      setBusy(false);
    }
  };

  const invalidate = useInvalidateMatching();
  const enable = async () => {
    setBusy(true);
    dialogErrors.clear();
    const preferences = tenantAdminKeys.notificationPreferences(portal);
    try {
      const pushRequest = subscribePush(portal, pushKey.load);
      const preferenceRequests = types
        .filter((type) => type.available && !type.enabled)
        .map((type) => setNotificationPreference(type.key, true, portal));
      // The settings card shows these preferences, also after a partial save.
      void Promise.allSettled(preferenceRequests).then(() =>
        invalidate((key) => key === preferences),
      );
      await Promise.all([pushRequest, ...preferenceRequests]);
      // „Fertig“: Benachrichtigungen sind auf diesem Gerät eingeschaltet.
      reportOutcome("accepted");
      writeDecision(storageKey, { done: true });
      close(null);
    } catch (err) {
      logger.warn("notification_setup_failed", {
        portal,
        error: err instanceof Error ? err.message : String(err),
      });
      if (Notification.permission === "denied") setMode("denied");
      if (portal === "parent" || Notification.permission !== "granted") {
        dialogErrors.invalid(t("enableError"));
      } else {
        void dialogErrors.show(err, {
          object: "das Einschalten der Benachrichtigungen",
          retry: () => latestEnableRef.current(),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  useLayoutEffect(() => {
    latestEnableRef.current = () => void enable();
  });

  if (!mode) return null;

  // Kompakte Modal-Aktionen im gemeinsamen Footer (#3368); auf dem Handy
  // stapelt das Sheet sie in voller Breite mit Touch-Höhe.
  const footer = (
    <>
      {mode === "enable" && (
        <Button
          type="button"
          variant="surface"
          size="md"
          className={ACTION_CLASS}
          disabled={busy}
          tooltip={t("remindLaterTooltip")}
          onClick={remindLater}
        >
          {t("later")}
        </Button>
      )}
      {mode === "enable" ? (
        <Button
          type="button"
          size="md"
          className={ACTION_CLASS}
          isLoading={busy}
          loadingText={t("enabling")}
          tooltip={t("enableTooltip")}
          onClick={() => void enable()}
        >
          {t("enable")}
        </Button>
      ) : mode === "install-android" && installPromptReady ? (
        <Button
          type="button"
          size="md"
          className={ACTION_CLASS}
          isLoading={busy}
          loadingText={t("installing")}
          tooltip={t("installAppTooltip")}
          onClick={() => void installAndroid()}
        >
          {t("installApp")}
        </Button>
      ) : (
        <Button
          type="button"
          size="md"
          className={ACTION_CLASS}
          tooltip={
            mode.startsWith("install-")
              ? t("closeGuideTooltip")
              : t("remindLaterTooltip")
          }
          onClick={
            mode.startsWith("install-") ? finishInstallGuide : remindLater
          }
        >
          {mode.startsWith("install-") ? t("closeGuide") : t("understood")}
        </Button>
      )}
    </>
  );

  return (
    <Modal
      isOpen
      onClose={remindLater}
      title={
        mode === "install-ios"
          ? t("installTitle")
          : mode === "install-android"
            ? t("installAndroidTitle")
            : t("title")
      }
      closeLabel={t("close")}
      // Das X erinnert wie „Später erinnern“ in einer Woche wieder.
      closeTooltip={t("remindLaterTooltip")}
      backdropLabel={t("close")}
      isDismissDisabled={busy}
      footer={footer}
      mobileSheet
      focusTitleOnOpen
    >
      <div ref={dialogRef} className="space-y-5">
        {/* Anleitungen tragen ihre eigenen Schrittsymbole; ein zweites Symbol
            darüber stünde nur allein in einer Zeile herum. Bei den kurzen
            Texten steht es neben dem Satz, wie im Kopf der Einstellungskarte. */}
        {mode === "install-ios" ? (
          <PushInstallSteps platform="ios" />
        ) : mode === "install-android" && !installPromptReady ? (
          <PushInstallSteps platform="android" />
        ) : (
          <div className="flex items-start gap-4">
            <ConceptIconTile
              concept={
                mode.startsWith("install-")
                  ? devicesConcept
                  : notificationsConcept
              }
            />
            <p>
              {mode === "install-android"
                ? t("installAndroidIntro")
                : mode === "denied"
                  ? t("denied")
                  : portal === "parent"
                    ? t("intro")
                    : t("introStaff")}
            </p>
          </div>
        )}

        <FormErrorAlert message={dialogErrors.error} />
      </div>
    </Modal>
  );
}
