/**
 * Die eine Navigationsliste des Schul-Portals ("moto schule", #2207).
 *
 * Seitennavigation und mobile Leiste rendern beide aus dieser Datei — ein
 * neues Ziel wird hier eingetragen, nicht an zwei Stellen. Analog zu
 * `parent/shell/parent-nav-items.ts`. Ein Eintrag kann einen Zähler tragen
 * (`badge`), den die beiden Leisten aus demselben Hook füllen.
 *
 * Ein Eintrag nennt sein Konzept, nicht sein Icon. Glyph und Ton kommen aus
 * der Konzeptdefinition (`~/lib/concepts`), damit das Schul-Portal dieselbe Bildsprache spricht wie
 * das übrige Produkt.
 */
import {
  SCHOOL_PRIMARY_PAGES,
  SCHOOL_SETTINGS_PAGE,
  type SchoolNavPage,
} from "./school-nav-pages";
import type { MotoConcept } from "~/lib/moto-concepts";
import { announcementsConcept } from "~/lib/concepts/announcements";
import { calendarConcept } from "~/lib/concepts/calendar";
import { classDayConcept } from "~/lib/concepts/classDay";
import { excusedConcept } from "~/lib/concepts/excused";
import { helpConcept } from "~/lib/concepts/help";
import { messagesConcept } from "~/lib/concepts/messages";
import { newsConcept } from "~/lib/concepts/news";
import { presentConcept } from "~/lib/concepts/present";
import { notificationsConcept } from "~/lib/concepts/notifications";
import { devicesConcept } from "~/lib/concepts/devices";
import { privacyConcept } from "~/lib/concepts/privacy";
import { displayConcept } from "~/lib/concepts/display";
import { settingsConcept } from "~/lib/concepts/settings";

export interface SchoolNavItem extends SchoolNavPage {
  readonly concept: MotoConcept;
}

/**
 * Die Alltagsziele: der heutige Tag einer Klasse, die Aufsichten, die diese
 * Lehrkraft heute selbst führt, die Nachrichten an die OGS (#2208) und die
 * Tagesinformationen der OGS-Leitung (#2208). Getrennte Namen mit getrennten
 * Aufgaben — die Klassenansicht ist die Übergabe nach Unterricht, die
 * Aufsichten sind der eigene Dienst danach, die Nachrichten der kurze Draht
 * zur OGS dazwischen, die Tagesinformationen das, was die OGS-Leitung allen
 * Lehrkräften mitteilt.
 */
const PRIMARY_CONCEPTS = {
  classDay: classDayConcept,
  supervisions: presentConcept,
  messages: messagesConcept,
  notices: announcementsConcept,
  absenceList: excusedConcept,
  parentLetters: newsConcept,
  calendar: calendarConcept,
} satisfies Record<(typeof SCHOOL_PRIMARY_PAGES)[number]["key"], MotoConcept>;

export const SCHOOL_PRIMARY_NAV: readonly SchoolNavItem[] =
  SCHOOL_PRIMARY_PAGES.map((page) => ({
    ...page,
    concept: PRIMARY_CONCEPTS[page.key],
  }));

/**
 * Unten angeheftet: nicht der Alltag, sondern das Nachschlagen. Die Hilfe
 * liegt außerhalb des Portals (öffentliche /help-Strecke) und öffnet deshalb
 * in einem neuen Tab.
 */
export const SCHOOL_SECONDARY_NAV: readonly SchoolNavItem[] = [
  {
    key: "help",
    // Mit `role` ueberspringt die Hilfe ihre Eingangsfrage: wer hier klickt,
    // ist eine Lehrkraft. Die drei OGS-Einstellungen aendern in der
    // Lehrkraft-Anleitung keinen Ablauf und bleiben deshalb weg.
    href: "/help?role=teacher",
    label: "Hilfe",
    concept: helpConcept,
    newTab: true,
  },
];

/** Der Einstieg in die Einstellungen, unten in der Seitenleiste (#5750). */
export const SCHOOL_SETTINGS_ENTRY: SchoolNavItem = {
  ...SCHOOL_SETTINGS_PAGE,
  concept: settingsConcept,
};

export interface SchoolSettingsSection {
  /** Der Wert von `?tab=` in der Adresse. */
  readonly key: "notifications" | "devices" | "display" | "privacy";
  readonly label: string;
  readonly concept: MotoConcept;
}

/** Die Bereiche der Einstellungen; der erste öffnet ohne `?tab=`. */
export const SCHOOL_SETTINGS_SECTIONS: readonly SchoolSettingsSection[] = [
  {
    key: "notifications",
    label: "Benachrichtigungen",
    concept: notificationsConcept,
  },
  // Auf welchen Geräten die Anmeldung ohne Code auskommt (#6955).
  { key: "devices", label: "Vertraute Geräte", concept: devicesConcept },
  // Wie moto für das Konto aussieht, etwa „Mehr Kontrast“.
  { key: "display", label: "Darstellung", concept: displayConcept },
  { key: "privacy", label: "Datenschutz", concept: privacyConcept },
];

/** Der Bereich, den `?tab=` nennt; ein unbekannter Wert öffnet den ersten. */
export function activeSchoolSettingsSection(
  requestedTab: string | null | undefined,
): SchoolSettingsSection {
  return (
    SCHOOL_SETTINGS_SECTIONS.find((section) => section.key === requestedTab) ??
    (SCHOOL_SETTINGS_SECTIONS[0] as SchoolSettingsSection)
  );
}
