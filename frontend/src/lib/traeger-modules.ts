import type { Session } from "next-auth";

import { hasPermission } from "~/lib/auth-utils";
import { MODULE_LABELS, type ModuleKey } from "~/lib/modules";

/**
 * Das Modul-Register des Träger-Portals (#6052): welche Seite zu welchem
 * moto-Modul gehört. Seitenleiste, mobile Leiste, Suche, Startziel und das
 * Seitengerüst lesen nur dieses Register; das Backend sperrt dieselben
 * Bereiche (`backend/api/module_routes.go`).
 *
 * Die Schalter gelten je Schule, das Träger-Portal für alle Schulen des
 * Trägers: Ein Modul zählt für den Träger, sobald eine seiner Schulen es
 * gebucht hat. Die Liste der gebuchten Module kommt mit dem Rahmen des
 * Portals (`GET /traeger/organization/`).
 */

/** Die vier moto-Module, deren Seiten im Träger-Portal liegen. */
export const TRAEGER_MODULE_KEYS = [
  "traeger_uebersicht",
  "ferienbetreuung",
  "vertraege",
  "elternbeitraege",
] as const satisfies readonly ModuleKey[];

export type TraegerModuleKey = (typeof TRAEGER_MODULE_KEYS)[number];

/** Was ein Modul dem Träger-Büro bringt, für die Karte „Gebuchte moto-Module“. */
export const TRAEGER_MODULE_SUMMARIES: Readonly<
  Record<TraegerModuleKey, string>
> = {
  traeger_uebersicht:
    "Dashboard, Belegung, Auslastung, Standortvergleich und Berichte für alle Schulen.",
  ferienbetreuung:
    "Ferienzeiträume planen, Anmeldungen der Eltern prüfen und Plätze vergeben.",
  vertraege:
    "Betreuungsverträge erstellen, unterschreiben lassen, ändern und kündigen.",
  elternbeitraege:
    "Monatsbeiträge und Ferienbeiträge abrechnen, Lastschriften einziehen und Daten an die Buchhaltung geben.",
};

/**
 * Seiten (mit /traeger-Präfix) und ihr Modul. Der längste passende Pfad
 * gewinnt; was hier fehlt, ist moto Basis: Schulen, Schließtage,
 * Anmeldephasen, Dokumente, Personal und die übrigen Einstellungen.
 */
const TRAEGER_PAGE_MODULES: Readonly<Record<string, TraegerModuleKey>> = {
  "/traeger/uebersicht": "traeger_uebersicht",
  "/traeger/belegung": "traeger_uebersicht",
  "/traeger/auslastung": "traeger_uebersicht",
  "/traeger/ankunft-abholung": "traeger_uebersicht",
  "/traeger/standortvergleich": "traeger_uebersicht",
  "/traeger/berichte": "traeger_uebersicht",
  "/traeger/tagesmeldung": "traeger_uebersicht",
  "/traeger/zeitvergleich": "traeger_uebersicht",
  "/traeger/ferien": "ferienbetreuung",
  "/traeger/vertraege": "vertraege",
  "/traeger/abrechnung": "elternbeitraege",
  "/traeger/einstellungen/dokumentarten": "elternbeitraege",
};

/** Die Adresse mit /traeger-Präfix, wie das Register sie führt. */
function withTraegerPrefix(pathname: string): string {
  if (pathname === "/traeger" || pathname.startsWith("/traeger/")) {
    return pathname;
  }
  return pathname === "/" ? "/traeger" : `/traeger${pathname}`;
}

/**
 * Das Modul hinter einer Adresse des Träger-Portals, mit oder ohne
 * /traeger davor (auf dem Träger-Host fehlt es), oder `null` für Basis.
 */
export function traegerModuleOfPath(pathname: string): TraegerModuleKey | null {
  const path = withTraegerPrefix(pathname);
  let best: string | null = null;
  for (const href of Object.keys(TRAEGER_PAGE_MODULES)) {
    if (path !== href && !path.startsWith(`${href}/`)) continue;
    if (best === null || href.length > best.length) best = href;
  }
  return best === null ? null : (TRAEGER_PAGE_MODULES[best] ?? null);
}

/**
 * Das Dashboard ist das Startziel des Portals. Ohne die Träger-Übersicht ist
 * die Schulliste das Startziel: Der Eintrag „Dashboard“ fehlt dann für alle,
 * auch ohne Schloss, und seine Adresse führt zur Schulliste. Sonst stünde
 * nach jeder Anmeldung die Erklärung statt einer Arbeitsseite. Die übrigen
 * Seiten des Moduls tragen für die Leitung das Schloss.
 */
export const TRAEGER_DASHBOARD_PATH = "/traeger/uebersicht";
export const TRAEGER_SCHOOLS_PATH = "/traeger";

/** Ob die Adresse das Dashboard ist, mit oder ohne /traeger davor. */
export function isTraegerDashboardPath(pathname: string): boolean {
  return withTraegerPrefix(pathname) === TRAEGER_DASHBOARD_PATH;
}

/** Wie ein Eintrag erscheint: offen, mit Schloss oder gar nicht. */
export type TraegerModuleVisibility = "open" | "locked" | "hidden";

/**
 * `open` für Basis und gebuchte Module. Ein nicht gebuchtes Modul sieht mit
 * Schloss, wer das Träger-Büro leitet; alle anderen sehen den Eintrag nicht.
 * Solange die gebuchten Module nicht bekannt sind (`null`: der Rahmen lädt
 * noch oder konnte nicht geladen werden), gilt alles als offen: das Backend
 * sperrt ohnehin selbst, und kein Eintrag soll kurz verschwinden.
 */
export function traegerModuleVisibility(
  module: TraegerModuleKey | null,
  booked: readonly ModuleKey[] | null,
  seesLocked: boolean,
): TraegerModuleVisibility {
  if (module === null || booked === null || booked.includes(module)) {
    return "open";
  }
  return seesLocked ? "locked" : "hidden";
}

/** Ob das Dashboard offen ist; ohne bekannte Module gilt es als offen. */
export function traegerDashboardBooked(
  booked: readonly ModuleKey[] | null,
): boolean {
  return booked === null || booked.includes("traeger_uebersicht");
}

/** Das Recht „Mitglieder und Rollen“: wer es hat, leitet das Träger-Büro. */
const LEADS_OFFICE_RIGHT = "traeger_accounts:manage";

/**
 * Wer ein nicht gebuchtes Modul mit Schloss sieht: wer das Träger-Büro
 * leitet. Diese Personen sprechen mit dem moto-Team über die Buchung.
 */
export function seesLockedTraegerModules(session: Session | null): boolean {
  return hasPermission(session, LEADS_OFFICE_RIGHT);
}

/** Der Hinweis am Schloss eines Eintrags der Navigation. */
export const TRAEGER_MODULE_LOCK_TITLE =
  "Keine Schule deines Trägers hat dieses moto-Modul gebucht";

/** Der Titel des erklärenden Zustands. */
export function traegerModuleNotBookedTitle(module: ModuleKey): string {
  return `${MODULE_LABELS[module]} ist nicht gebucht`;
}

/**
 * Die Erklärung im Träger-Portal. „moto-Modul“, weil „Modul“ dort auch die
 * Betreuungsmodule eines Vertrags meint. Sie nennt, wer als Nächstes handelt.
 * `subject` sagt, was zum Modul gehört: die ganze Seite oder ein Teil, den
 * der Satz davor schon genannt hat („Sie gehören …“).
 */
export function traegerModuleNotBookedExplanation(
  module: ModuleKey,
  leadsOffice: boolean,
  subject: "page" | "named-before" = "page",
): string {
  const label = MODULE_LABELS[module];
  const belongs =
    subject === "page"
      ? `Diese Seite gehört zum moto-Modul „${label}“.`
      : `Sie gehören zum moto-Modul „${label}“.`;
  return leadsOffice
    ? `${belongs} Keine Schule deines Trägers hat es gebucht. Für eine Buchung wende dich an das moto-Team.`
    : `${belongs} Dein Träger nutzt es nicht. Wenn du es brauchst, sprich mit der Leitung deines Träger-Büros.`;
}

/** Die Seite der Träger-Einstellungen, die die gebuchten Module zeigt. */
export const TRAEGER_MODULES_SETTINGS_PATH = "/traeger/einstellungen/module";
