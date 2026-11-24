import { LockSimpleIcon } from "@phosphor-icons/react/ssr";

/**
 * Das Schloss an einem Navigationseintrag eines Moduls, das die Schule nicht
 * gebucht hat (#4894). Nur wer die Schule leitet, sieht solche Einträge; der
 * Eintrag führt auf die Seite, und die erklärt, wer das Modul bucht.
 * Vorleseprogramme hören „nicht gebucht“ hinter dem Namen.
 *
 * `relative` hält den `sr-only`-Text (absolut positioniert) im Schloss. Ohne
 * Bezugsrahmen hängt er am Sticky-Rahmen der Seitenleiste, entgeht dem
 * Scrollbereich der Navigation und verlängert die ganze Seite.
 */
export function ModuleLockMark({
  className = "",
  title = "Deine Schule hat dieses Modul nicht gebucht",
}: {
  readonly className?: string;
  /** Wer das Modul nicht gebucht hat; das Träger-Portal nennt den Träger (#6052). */
  readonly title?: string;
}) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center text-gray-500 ${className}`}
      title={title}
    >
      <LockSimpleIcon size={14} weight="bold" aria-hidden="true" />
      <span className="sr-only">, nicht gebucht</span>
    </span>
  );
}
