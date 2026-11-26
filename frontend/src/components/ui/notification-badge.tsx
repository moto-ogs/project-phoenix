/**
 * Palette names, not audiences: which audience gets which hue is the
 * caller's decision (#6582, `~/lib/counter-tones`).
 *
 * Farbregel der App (#8070, Runde 17): Rot zählt nur Dringendes, das jetzt
 * eine Handlung braucht (überfällig, Fehler, Frist überschritten). Neues und
 * Ungelesenes (Benachrichtigungen, Nachrichten, Anfragen, Hinweise) zählt
 * blau (`blue`, wie `UnreadBadge` für Eltern); ein Zähler ohne Aufforderung
 * (Anzahl in einem Menüeintrag) bleibt grau. Ein Ort, der dieselbe Zahl
 * zeigt (Reiter „Mehr“ und Zeile „Benachrichtigungen“), nimmt dieselbe Farbe.
 * Auf iPad und Desktop gilt bis zur Umstellung die heutige Farbe: `appTone`
 * setzt die App-Farbe nur am Telefon.
 */
export type NotificationBadgeTone = "orange" | "blue" | "coral" | "red";
type NotificationBadgeSize = "sm" | "md";

// The count is small bold text, so WCAG AA wants 4.5:1 against the pill.
// bg-moto-orange (#F78C10) carries white at 2.41:1 — below even the 3:1
// non-text floor — so the orange tone uses the -strong ramp step (5.63:1).
// See the contrast note on TEXT_SAFE_SHADES in kit-palette.ts.
const TONE_CLASSES: Record<NotificationBadgeTone, string> = {
  orange: "bg-moto-orange-strong text-white",
  blue: "bg-moto-blue-strong text-white",
  coral: "bg-moto-coral-strong text-white",
  red: "bg-moto-red text-white",
};

// Statisch ausgeschrieben, damit Tailwind die Klassen findet. Die
// `app:`-Variante steht im Stylesheet nach der Grundklasse und gewinnt.
const APP_TONE_CLASSES: Record<NotificationBadgeTone, string> = {
  orange: "app:bg-moto-orange-strong",
  blue: "app:bg-moto-blue-strong",
  coral: "app:bg-moto-coral-strong",
  red: "app:bg-moto-red",
};

const SIZE_CLASSES: Record<NotificationBadgeSize, string> = {
  sm: "h-4 min-w-4 px-1 text-xs",
  md: "h-5 min-w-5 px-1.5 text-xs",
};

export function NotificationBadge({
  count,
  tone,
  appTone,
  ariaLabel,
  size = "md",
  max = 99,
  className,
}: Readonly<{
  count: number;
  tone: NotificationBadgeTone;
  /** Farbe nur am Telefon (`app:`), wenn sie dort von `tone` abweicht. */
  appTone?: NotificationBadgeTone;
  ariaLabel: string;
  size?: NotificationBadgeSize;
  /**
   * Größte ausgeschriebene Zahl; darüber steht „max+“. Die Glocke im Kopf
   * zeigt ab 10 „9+“ (#7148), damit das kleine Abzeichen auf dem Symbol
   * nicht breiter als das Symbol wird.
   */
  max?: number;
  className?: string;
}>) {
  if (count <= 0) return null;

  const countText = String(count);
  const shown = count > max ? `${max}+` : countText;
  const appToneClass =
    appTone && appTone !== tone ? ` ${APP_TONE_CLASSES[appTone]}` : "";
  const surface = `${TONE_CLASSES[tone]}${appToneClass} ${SIZE_CLASSES[size]} inline-flex items-center justify-center rounded-full font-bold ${className ?? ""}`;
  // A span without a role may not carry aria-label, and a name that replaces
  // the visible number breaks WCAG 2.5.3 on the link around it (#7112). The
  // number stays readable text; the rest of the sentence is visually hidden.
  if (!ariaLabel) {
    return (
      <span className={surface} aria-hidden="true">
        {shown}
      </span>
    );
  }
  const rest = ariaLabel.startsWith(shown)
    ? ariaLabel.slice(shown.length)
    : ariaLabel.startsWith(countText)
      ? ariaLabel.slice(countText.length)
      : null;
  return (
    <span className={surface}>
      {rest === null ? (
        // Worded otherwise: the shown text stays in the name, the full
        // sentence follows it.
        <>
          {shown}
          <span className="sr-only">{` ${ariaLabel}`}</span>
        </>
      ) : (
        <>
          {shown}
          <span className="sr-only">{rest}</span>
        </>
      )}
    </span>
  );
}
