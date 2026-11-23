"use client";

import { PlugsIcon } from "@phosphor-icons/react";
import { TenantPage, type TenantPageProps } from "~/components/ui/tenant-page";

interface FeatureOffPageProps {
  /** Seitentitel — derselbe wie im eingeschalteten Zustand. */
  readonly title: string;
  /** Was hier stünde, wenn die Funktion an wäre. Ein Satz. */
  readonly description: string;
  /** Erklärung der Seite, auch wenn die Funktion nicht eingeschaltet ist. */
  readonly info?: TenantPageProps["info"];
  /**
   * Wer sie einschalten kann. Für Funktionen, die nur moto schaltet
   * (NFC, Anwesenheitsmodus), ist das ausdrücklich NICHT die Leitung.
   */
  readonly whoCanEnable?: string;
  /** Rückweg einer gesperrten Unterseite zur Sammlung. */
  readonly back?: TenantPageProps["back"];
  readonly backHref?: TenantPageProps["backHref"];
  readonly backLabel?: TenantPageProps["backLabel"];
}

/**
 * Eine für diese Schule nicht eingeschaltete Funktion ist ein ZUSTAND, kein
 * Fehler und erst recht kein „nicht gefunden".
 *
 * Vorher riefen die Wächter `notFound()`, und Next.js zeigte daraufhin die
 * 404-Seite des Mandanten: „Schule nicht gefunden — Die angegebene Schule
 * existiert nicht oder ist nicht aktiv. Bitte überprüfe die Subdomain."
 * Für jemanden, der angemeldet in seiner eigenen Schule steht, ist jedes Wort
 * davon falsch, und der Rat führt in die Irre.
 *
 * `.claude/rules/verstaendlichkeit.md`: Wo eine Person nichts ändern kann,
 * sagt der Bildschirm, wer als Nächstes handelt.
 */
export function FeatureOffPage({
  title,
  description,
  info,
  whoCanEnable = "Wende dich an moto, wenn du diese Funktion nutzen möchtest.",
  back,
  backHref,
  backLabel,
}: FeatureOffPageProps) {
  const icon = <PlugsIcon className="h-12 w-12" aria-hidden="true" />;
  const body = `${description} ${whoCanEnable}`;

  return (
    <TenantPage
      title={title}
      info={info}
      back={back}
      backHref={backHref}
      backLabel={backLabel}
      empty={{
        title: "Diese Funktion ist nicht eingeschaltet",
        description: body,
        icon,
      }}
    />
  );
}
