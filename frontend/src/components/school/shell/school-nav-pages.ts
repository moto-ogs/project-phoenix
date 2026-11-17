/** School page metadata shared by navigation and cross-portal headings, without glyphs. */
export interface SchoolNavPage {
  /** Stabiler Schlüssel für Listen und Tests. */
  readonly key: string;
  readonly href: string;
  readonly label: string;
  /**
   * Ziele außerhalb des Portals öffnen in einem neuen Tab, damit die
   * Klassenansicht beim Nachschlagen nicht verloren geht.
   */
  readonly newTab?: boolean;
  /**
   * `true` für Portal-Pfade, die auf dem Schul-Host ohne /school-Präfix
   * laufen. Die Hilfe ist host-unabhängig und wird nicht umgeschrieben.
   */
  readonly portalPath?: boolean;
  /**
   * Welcher Zähler neben dem Eintrag steht. Die Leisten holen den Wert aus
   * dem passenden Hook; die Liste selbst kennt keine Zahlen.
   */
  readonly badge?: "teamChat" | "notices";
  /**
   * `true` für Ziele, die es nur gibt, solange die Schule die Funktion
   * nicht ausgeschaltet hat. Die Leisten blenden den Eintrag aus, solange das
   * nicht feststeht oder verneint ist — ein toter Link ist schlimmer als
   * ein fehlender.
   */
  readonly optional?: "teamChat";
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
export const SCHOOL_PRIMARY_PAGES = [
  {
    key: "classDay",
    href: "/school",
    label: "Klassenansicht",
    portalPath: true,
  },
  {
    key: "supervisions",
    href: "/school/aufsichten",
    label: "Meine Aufsichten",
    portalPath: true,
  },
  {
    key: "messages",
    href: "/school/nachrichten",
    label: "Nachrichten",
    portalPath: true,
    badge: "teamChat",
    optional: "teamChat",
  },
  {
    key: "notices",
    href: "/school/tagesinformationen",
    label: "Hinweise der Leitung",
    portalPath: true,
    badge: "notices",
  },
  // Fehltage je Kind einer Klasse für Klassenbuch und Zeugnis (#4793).
  {
    key: "absenceList",
    href: "/school/fehlzeiten",
    label: "Fehlzeiten",
    portalPath: true,
  },
  // Briefe der Lehrkraft an die Eltern ihrer Klasse (#4800).
  {
    key: "parentLetters",
    href: "/school/elternbriefe",
    label: "Elternbriefe",
    portalPath: true,
  },
  // Termine der OGS, Schließtage, Ferien und die eigenen Schultermine (#4798).
  {
    key: "calendar",
    href: "/school/kalender",
    label: "Kalender",
    portalPath: true,
  },
] as const satisfies readonly SchoolNavPage[];

/** The settings entry in the school sidebar. */
export const SCHOOL_SETTINGS_PAGE = {
  key: "settings",
  href: "/school/einstellungen",
  label: "Einstellungen",
  portalPath: true,
} as const satisfies SchoolNavPage;
