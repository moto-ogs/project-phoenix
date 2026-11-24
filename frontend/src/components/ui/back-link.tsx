"use client";

import { ArrowLeft } from "lucide-react";
import type { MouseEvent } from "react";
import NavigationLink from "~/components/ui/navigation-link";
import { useStackBack } from "~/lib/mobile-navigation/use-navigation-stack";
import { cn } from "~/lib/utils";

// `-ml-2` setzt den Pfeil auf die Fluchtlinie des Titels; die Fläche bleibt
// für Hover und Fokus trotzdem symmetrisch. Auf dem Telefon 44 px hoch, die
// Untergrenze einer Touch-Fläche.
const BACK_CLASS_NAME =
  "-ml-2 flex h-8 w-fit items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-gray-600 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 max-sm:h-11";

/**
 * Der Rückweg einer Unterseite: Pfeil und Ziel als Text, auf jeder Breite.
 * Er sitzt über dem Seitentitel in der Kopfkarte (`TenantPage` mit `back`,
 * `ParentPageHeader` mit `backHref`). Ein echter Link, damit Mittelklick,
 * „in neuem Tab öffnen" und die Wechselsperre ungespeicherter Formulare
 * greifen.
 *
 * `href` ist der fertige Pfad des Portals; im Tenant-Portal löst ihn der
 * Aufrufer über `useTenantAwarePath` auf.
 *
 * Die Beschriftung nennt das Ziel („Zurück zu den Räumen"), nicht nur
 * „Zurück": auf dem Desktop steht der Link neben den Brotkrumen und muss
 * ohne sie verständlich sein.
 *
 * In der App (#8070) ist ein einfacher Tipp ein Schritt zurück im Verlauf
 * (`useStackBack`): Liste, Scrollstand und Filter sind wieder da, und das
 * Wischzurück danach führt nicht erneut ins Detail. Liegt der vorige Eintrag
 * außerhalb der App oder in einem anderen Reiter, ersetzt `href` die Seite.
 * Element und Klassen bleiben dieselben; der Desktop behält den Link.
 */
export function BackLink({
  href,
  label,
  className,
}: Readonly<{ href: string; label: string; className?: string }>) {
  const stackBack = useStackBack();
  const onClick = stackBack
    ? (event: MouseEvent<HTMLAnchorElement>) => {
        // Mittelklick, Cmd/Strg-Klick und „neuer Tab“ bleiben Link-Verhalten.
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        // Kein passender Eintrag: der Link ersetzt die Seite (`replace`).
        if (stackBack()) event.preventDefault();
      }
    : undefined;
  return (
    <NavigationLink
      href={href}
      onClick={onClick}
      // Nur in der App: der Rückweg legt keinen neuen Eintrag an.
      replace={stackBack ? true : undefined}
      pageTransition="back"
      className={cn(BACK_CLASS_NAME, className)}
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
      {label}
    </NavigationLink>
  );
}

/**
 * Derselbe Rückweg für eine Ansicht innerhalb einer Seite, die keine eigene
 * Adresse hat (Editor zurück zur Übersicht derselben Seite). Sieht aus wie
 * `BackLink` und sitzt an derselben Stelle über dem Titel der Ansicht. Wo
 * es eine Adresse gibt, gehört `BackLink` hin.
 */
export function BackAction({
  onClick,
  label,
  disabled,
  className,
}: Readonly<{
  onClick: () => void;
  label: string;
  disabled?: boolean;
  className?: string;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(BACK_CLASS_NAME, className)}
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
      {label}
    </button>
  );
}
