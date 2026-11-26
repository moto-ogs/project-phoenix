"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { Contrast } from "lucide-react";
import { SectionCard } from "~/components/ui/section-card";
import { SwitchRow } from "~/components/ui/switch";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import {
  contrastOfAccount,
  storeAccountContrast,
} from "~/lib/contrast-account";
import {
  applyContrastPreference,
  beginAccountContrastMutation,
  currentContrastPreference,
  isMoreContrastActive,
  subscribeToContrast,
} from "~/lib/contrast-preference";
import type { PortalKey } from "~/lib/portal-paths";
import { useContrastPreferenceServerSnapshot } from "./contrast-preference-hydration";

/** Die Texte des Abschnitts; das Elternportal reicht übersetzte herein. */
export type ContrastPreferenceCopy = Readonly<{
  title: string;
  description: string;
  label: string;
  /** Was nicht gespeichert wurde, für die Fehlermeldung. */
  errorObject: string;
}>;

const CONTRAST_PREFERENCE_COPY: ContrastPreferenceCopy = {
  title: "Mehr Kontrast",
  description:
    "Eingabefelder, Auswahlfelder, Kästchen und Schalter bekommen einen dunkleren Rand. So erkennst du sie leichter. Das gilt für dein Konto, auf jedem Gerät.",
  label: "Dunklere Ränder an Eingabefeldern",
  errorObject: "deine Kontrast-Einstellung",
};

/**
 * „Mehr Kontrast“ am eigenen Konto. Der Schalter wirkt sofort auf diesem
 * Gerät und speichert die Wahl am Konto (`~/lib/contrast-account`); andere
 * Geräte übernehmen sie beim nächsten Laden (`ContrastAccountSync`). Ohne
 * Wahl zeigt der Schalter, was die Systemeinstellung vorgibt.
 */
export function ContrastPreferenceSection({
  portal,
  copy = CONTRAST_PREFERENCE_COPY,
}: Readonly<{ portal: PortalKey; copy?: ContrastPreferenceCopy }>) {
  const serverSnapshot = useContrastPreferenceServerSnapshot();
  const getServerSnapshot = useCallback(() => serverSnapshot, [serverSnapshot]);
  const checked = useSyncExternalStore(
    subscribeToContrast,
    isMoreContrastActive,
    getServerSnapshot,
  );
  const { show: showSaveError } = useApiErrorDisplay();
  const savedPreference = useRef(currentContrastPreference());
  const queuedSave = useRef(Promise.resolve());
  const latestChoice = useRef(0);

  function showChoiceError(err: unknown, next: boolean) {
    void showSaveError(err, {
      object: copy.errorObject,
      retry: () => choose(next),
    });
  }

  function choose(next: boolean) {
    const choice = latestChoice.current + 1;
    latestChoice.current = choice;
    const endMutation = beginAccountContrastMutation();
    applyContrastPreference(next ? "more" : "normal");

    queuedSave.current = queuedSave.current.then(async () => {
      const previous = savedPreference.current;
      try {
        const stored = contrastOfAccount(
          await storeAccountContrast(portal, next),
        );
        savedPreference.current = stored;
        if (choice === latestChoice.current) applyContrastPreference(stored);
      } catch (err) {
        if (choice !== latestChoice.current) return;
        // Nicht gespeichert: der Schalter springt zum zuletzt bestätigten
        // Stand zurück, nicht zu einer überholten lokalen Wahl.
        applyContrastPreference(previous);
        showChoiceError(err, next);
      } finally {
        endMutation();
      }
    });
  }

  return (
    <SectionCard
      icon={Contrast}
      headingLevel={3}
      title={copy.title}
      description={copy.description}
    >
      <SwitchRow
        label={copy.label}
        checked={checked}
        onCheckedChange={choose}
      />
    </SectionCard>
  );
}
