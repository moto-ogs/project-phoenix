"use client";

import { useTranslations } from "next-intl";
import { ContrastPreferenceSection } from "~/components/settings/contrast-preference-section";

/** Elterneinstellungen: „Mehr Kontrast“ in der Sprache der Lesenden. */
export function ParentContrastPreferenceSection() {
  const t = useTranslations("contrastPreference");
  return (
    <ContrastPreferenceSection
      portal="parent"
      copy={{
        title: t("title"),
        description: t("description"),
        label: t("label"),
        errorObject: t("errorObject"),
      }}
    />
  );
}
