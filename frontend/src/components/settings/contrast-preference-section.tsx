"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Contrast } from "lucide-react";
import { SectionCard } from "~/components/ui/section-card";
import { SwitchRow } from "~/components/ui/switch";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { storeAccountContrast } from "~/lib/contrast-account";
import {
  applyContrastPreference,
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

  async function choose(next: boolean) {
    const previous = currentContrastPreference();
    applyContrastPreference(next ? "more" : "normal");
    try {
      await storeAccountContrast(portal, next);
    } catch (err) {
      // Nicht gespeichert: der Schalter springt zurück, sonst nähme der
      // nächste Abgleich die Wahl stillschweigend wieder weg.
      applyContrastPreference(previous);
      void showSaveError(err, {
        object: copy.errorObject,
        retry: () => void choose(next),
      });
    }
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
        onCheckedChange={(next) => void choose(next)}
      />
    </SectionCard>
  );
}
