"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { EllipsisVertical, X } from "lucide-react";
import { Button, ButtonLink } from "~/components/ui/button";
import { trackEvent, trackOnboardingSurface } from "~/lib/analytics";
import { GROUP_ROOM_SHADES } from "~/lib/location-helper";
import {
  createChromeIntentUrl,
  dismissInstallHint,
  isInstallHintEligible,
  isInstallationCompleted,
  isSamsungInternet,
  subscribeInstallPrompt,
} from "~/lib/pwa-install-prompt";

/** True when running inside an installed PWA (standalone display mode). */
function isStandaloneDisplay(win: Window): boolean {
  if (win.matchMedia("(display-mode: standalone)").matches) return true;
  const nav = win.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

export function SamsungChromeInstructions({
  pageUrl,
  onOpenInChrome,
}: Readonly<{ pageUrl: URL; onOpenInChrome?: () => void }>) {
  const t = useTranslations("pwaInstallHint");
  return (
    <>
      <p className="mt-1">{t("samsungDescription")}</p>
      <p className="mt-2">
        {t("samsungStep")} <span className="font-medium">{t("install")}</span>.
      </p>
      <ButtonLink
        href={createChromeIntentUrl(pageUrl)}
        size="md"
        className="mt-3"
        tooltip={t("openInChromeTooltip")}
        onClick={onOpenInChrome}
      >
        {t("openInChrome")}
      </ButtonLink>
      <p className="mt-2 text-gray-600">
        {t("samsungFallback", { host: pageUrl.host })}
      </p>
    </>
  );
}

/**
 * Samsung Internet can install an outdated app, so point users to the
 * current page in Chrome. Other browsers use the guided notification setup.
 *
 * Mounted in the protected layout on purpose. The audience is staff on phones
 * and tablets, and most of them never reach the admin-only dashboard, so a
 * single in-page slot would not reach them.
 *
 * Geometry, all of it previously wrong:
 * - Switches at `lg`, where AppShell drops its mobile bottom padding and the
 *   bottom nav disappears. The centered card and right-aligned search-page
 *   FAB do not intersect at `lg` widths, so no FAB clearance is needed there.
 * - Below lg the offset clears the bottom nav (~4.75rem visible) plus a 1rem
 *   gap, and adds `--moto-floating-fab-offset` only on pages that actually
 *   show a check-in or create FAB. An active mobile check-in bar publishes
 *   `--moto-checkin-bar-offset` in the same way. The old fixed 10.5rem reserved
 *   FAB space everywhere.
 * - Horizontally centered at every width instead of jumping from an
 *   edge-to-edge mobile banner to a right-anchored card at `sm`.
 *
 * Never rendered in an installed app, before the second visit, or after
 * dismissal.
 */
export function PwaInstallHint() {
  const t = useTranslations("pwaInstallHint");
  const [visible, setVisible] = useState(false);

  const installationCompleted = useSyncExternalStore(
    subscribeInstallPrompt,
    isInstallationCompleted,
    () => false,
  );

  useEffect(() => {
    if (!isSamsungInternet(window.navigator)) return;
    if (isStandaloneDisplay(window)) return;
    if (!isInstallHintEligible(window)) return;
    setVisible(true);
  }, []);

  useEffect(() => {
    if (!installationCompleted) return;
    // Report installations even in browsers that never show the Samsung hint.
    trackEvent("pwa_installed");
    setVisible(false);
  }, [installationCompleted]);

  useEffect(() => {
    if (!visible) return;
    trackEvent("pwa_install_prompt_shown");
    trackOnboardingSurface("shown", "samsung_hint");
  }, [visible]);

  if (!visible || installationCompleted) return null;

  const close = () => {
    trackOnboardingSurface("dismissed", "samsung_hint");
    setVisible(false);
    dismissInstallHint(window);
  };

  return (
    // Deliberately NOT `moto-content-surface`: that utility is unlayered and
    // hardcodes a white background plus a gray-200 border, which Tailwind
    // utilities cannot override and which made this card blend into the page.
    // A brand-green tint (GROUP_ROOM_SHADES.bgHover) and a 2px brand border
    // separate the promotion from the neutral content cards around it.
    // oxlint-disable-next-line ui-kit/no-hand-rolled-surface -- schwebender Installationshinweis in Markengrün über der Seite, keine Inhaltskarte
    <section
      aria-labelledby="pwa-install-hint-title"
      className="fixed bottom-[calc(5.75rem+var(--moto-floating-fab-offset,0rem)+var(--moto-checkin-bar-offset,0rem)+env(safe-area-inset-bottom))] left-1/2 z-40 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border-2 p-4 shadow-lg lg:bottom-8"
      style={{
        borderColor: GROUP_ROOM_SHADES.base,
        backgroundColor: GROUP_ROOM_SHADES.bgHover,
      }}
    >
      <div className="flex items-start gap-3">
        {/* White bubble, because the previous #83CD2D/10 tint is invisible on
            the green card background. */}
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white">
          <EllipsisVertical
            className="h-4 w-4"
            style={{ color: GROUP_ROOM_SHADES.text }}
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0 flex-1 text-sm text-gray-700">
          <h2
            id="pwa-install-hint-title"
            className="font-semibold text-gray-900"
          >
            {t("title")}
          </h2>
          <SamsungChromeInstructions
            pageUrl={new URL(window.location.href)}
            onOpenInChrome={() =>
              trackOnboardingSurface("accepted", "samsung_hint")
            }
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("close")}
          tooltip={t("closeTooltip")}
          onClick={close}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
