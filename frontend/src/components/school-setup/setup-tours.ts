import type { SchoolSetupStepKey } from "~/lib/school-setup-api";
import { staffWithoutTargetHref } from "~/lib/time-account-links";

/**
 * Die geführten Touren der ersten Schritte (#2832).
 *
 * Jede Station zeigt auf eine Stelle der Seite, per CSS-Selektor. Stellen
 * ohne eigene stabile ID tragen `data-setup-tour`; Formularfelder werden
 * über ihre vorhandene `id` gefunden. `advance: "click"` wartet, bis die
 * Person die Stelle selbst anklickt; „Weiter“ gibt es dann nicht.
 */
export interface SetupTourStop {
  target: string;
  /**
   * Unter `sm` ersetzt dieser Selektor `target`. Ein Menü im
   * `ResponsivePanel` liegt dort im Blatt über der Sprechblase; die Tour
   * zeigt deshalb auf seinen weiter sichtbaren Auslöser.
   */
  mobileTarget?: string;
  title: string;
  text: string;
  advance: "click" | "next";
  /**
   * Station in der Seitenleiste auf dem Weg zur Seite. Steht die Person
   * schon auf der Seite, entfallen diese Stationen; fehlt die Seitenleiste
   * (etwa auf dem Handy), öffnet die Tour die Seite selbst.
   */
  nav?: true;
  /**
   * Die Stelle gibt es nur kurz, etwa einen Eintrag in einem aufgeklappten
   * Menü. „Zurück“ geht über sie hinweg zur Station davor, die sie öffnet.
   */
  skipOnBack?: true;
  /** Entfällt, wenn diese Stelle schon sichtbar ist (Bereich schon offen). */
  skipWhenVisible?: string;
  /**
   * Wie viele Stationen dann entfallen, diese eingeschlossen (Standard 1).
   * So entfällt ein ganzer Zweig, etwa das Eintragen einer Person, die schon
   * eingetragen ist.
   */
  skipCount?: number;
  /**
   * Die Stelle darf fehlen, etwa ein Reiter, den nur manche Rollen sehen.
   * Dann entfällt die Station still (mit `skipCount` auch die folgenden),
   * statt „nicht zu sehen“ zu melden.
   */
  optional?: true;
  /**
   * Ein anderer Text, solange diese Stelle zu sehen ist, etwa an der
   * Stempeluhr, wenn die Person schon eingestempelt ist.
   */
  textWhenVisible?: { selector: string; text: string };
  /**
   * Die Markierung endet über dieser Stelle. So zeigt eine Station eine
   * ganze Karte ohne ihren Knopf, der die nächste Station ist.
   */
  endBefore?: string;
  /**
   * Auf welcher Seite die Station steht, wenn nicht auf der Seite der Tour.
   * Gesucht wird erst, wenn diese Seite geladen ist: sonst träfe die Tour
   * einen gleichnamigen Knopf der Seite, die gerade noch zu sehen ist.
   */
  pathPattern?: RegExp;
  /**
   * Klickt die Person diese Stelle an oder öffnet sie die Seite des Zweigs,
   * geht die Tour dort weiter statt zu enden. So zeigt die Kinder-Tour den
   * Import, wenn die Person „Importieren“ wählt.
   */
  branch?: SetupTourBranch;
  /**
   * Geht von selbst weiter, sobald diese Stelle zu sehen ist, etwa wenn nach
   * dem Hochladen die Vorschau erscheint. „Weiter“ bleibt daneben.
   */
  advanceWhenVisible?: string;
  /** Was die Sprechblase sagt, solange die Stelle fehlt. */
  missingText?: string;
}

/**
 * Die Kindakte `/students/<id>` (mit Schul-Präfix im Pfad-Routing), auf die
 * die Eltern-Tour aus der Kinderliste wechselt. Nicht die Unterseiten der
 * Datenverwaltung wie `/database/students/import`.
 */
export const CHILD_RECORD = /^(?!.*\/database\/)(?:\/[^/]+)?\/students\/[^/]+$/;

export interface SetupTour {
  /** Die Seite, auf der die Tour läuft. */
  path: string;
  /**
   * Die Adresse, mit der die Tour die Seite öffnet, wenn sie mehr trägt als
   * den Pfad, etwa eine Ansicht und einen Filter. Die Tour erkennt die Seite
   * weiter am Pfad.
   */
  href?: string;
  stops: readonly SetupTourStop[];
}

const create = '[data-setup-tour="create"]';
const formSubmit = '[data-setup-tour="form-submit"]';
/** Ein Formular der Datenverwaltung, erkannt an seinem Speichern-Knopf. */
const DATA_FORM = `form:has(${formSubmit})`;
/** Das Menü neben einer eingetragenen Person, die man einladen kann. */
const GUARDIAN_MENU = '[data-setup-tour="guardian-menu"]';

/**
 * Der Weg über die Seitenleiste: die Gruppe „Verwaltung“ aufklappen, dann
 * „Datenverwaltung“, dann die Seite. Was schon offen ist, entfällt.
 */
function viaSidebar(path: string, label: string): SetupTourStop[] {
  const subItem = `[data-setup-tour="nav-${path}"]`;
  const database = '[data-setup-tour="nav-database"]';
  return [
    {
      target: '[data-setup-tour="nav-group-verwaltung"]',
      title: "Verwaltung öffnen",
      text: "Die Daten deiner OGS findest du unter „Verwaltung“. Wähle „Verwaltung“.",
      advance: "click",
      nav: true,
      skipWhenVisible: database,
    },
    {
      target: database,
      title: "Datenverwaltung öffnen",
      text: "Hier in der Seitenleiste legst du die Daten deiner OGS an. Wähle „Datenverwaltung“.",
      advance: "click",
      nav: true,
      skipWhenVisible: subItem,
    },
    {
      target: subItem,
      title: `${label} öffnen`,
      text: `Wähle „${label}“.`,
      advance: "click",
      nav: true,
    },
  ];
}

/** Der Reiter „Zeitkonten“ der Personalseite. */
const TIME_ACCOUNTS_TAB = '[role="tab"][data-tab-value="accounts"]';

/** Die Karte „Neue Einladung“, erkannt an ihrem Senden-Knopf. */
const INVITE_FORM = 'div:has(> form [data-setup-tour="invite-submit"])';

const IMPORT_SUBMIT = '[data-setup-tour="student-import-submit"]';
const IMPORT_UPLOAD = '[data-setup-tour="student-import-upload"]';

/** Zweige einer Tour, auf eigener Seite und mit eigener Zählung. */
export type SetupTourBranch = "student-import";

export const SETUP_TOUR_BRANCHES: Readonly<Record<SetupTourBranch, SetupTour>> =
  {
    "student-import": {
      path: "/database/students/import",
      stops: [
        {
          target: "section:has(#format-select)",
          title: "Vorlage herunterladen",
          text: "Wähle ein Format und dann „Vorlage herunterladen“. Trage deine Kinder in die Datei ein und speichere sie.",
          advance: "next",
        },
        {
          target: 'section:has([aria-label="Import-Modus"])',
          title: "Neue Kinder anlegen",
          text: "Beim ersten Import lässt du „Nur neue anlegen“ gewählt.",
          advance: "next",
        },
        {
          target: IMPORT_UPLOAD,
          title: "Datei hochladen",
          text: "Ziehe die ausgefüllte Datei hierher oder wähle „Datei auswählen“. Danach zeigt moto eine Vorschau.",
          advance: "next",
          advanceWhenVisible: IMPORT_SUBMIT,
        },
        {
          target: IMPORT_SUBMIT,
          title: "Prüfen und importieren",
          text: "Prüfe die Vorschau. Hat eine Zeile einen Fehler, korrigiere die Datei und lade sie neu hoch. Dann wähle den grünen Knopf.",
          advance: "click",
          missingText:
            "Noch keine Datei hochgeladen. Wähle „Zurück“ und lade deine Datei hoch.",
        },
      ],
    },
  };

export const SETUP_TOURS: Readonly<
  Partial<Record<SchoolSetupStepKey, SetupTour>>
> = {
  team: {
    path: "/database/personal",
    stops: [
      ...viaSidebar("/database/personal", "Personal"),
      {
        target: create,
        title: "Personal einladen",
        text: "Wähle „+ Personal“.",
        advance: "click",
      },
      {
        // „+ Personal“ klappt auf, wenn die Schule auch Externe anlegen
        // darf (#4573). Sonst öffnet der Knopf das Formular direkt, und
        // diese Station entfällt. Am Formular statt am Klick erkannt: Mit
        // der Tastatur gewählt, löst der Eintrag keinen Klick aus.
        target: '[data-setup-tour="invite-create"]',
        title: "Einladung wählen",
        text: "Wähle „Personal einladen“.",
        advance: "click",
        advanceWhenVisible: INVITE_FORM,
        skipOnBack: true,
        missingText: "Wähle „Zurück“ und dann noch einmal „+ Personal“.",
      },
      {
        // Die Karte „Neue Einladung“ (Kopf und Formular), erkannt an ihrem
        // Senden-Knopf; die Markierung endet über dem Knopf.
        target: INVITE_FORM,
        endBefore: '[data-setup-tour="invite-submit"]',
        title: "Angaben eintragen",
        text: "An die E-Mail-Adresse schickt moto die Einladung. Die Rolle bestimmt, was die Person sehen und ändern darf. Mit dem Namen erkennst du die Person in der Liste, auch bevor sie die Einladung annimmt. Die Position ist freiwillig.",
        advance: "next",
      },
      {
        target: '[data-setup-tour="invite-submit"]',
        title: "Einladung senden",
        text: "Wähle „Einladung senden“. Die Person bekommt eine E-Mail.",
        advance: "click",
      },
    ],
  },
  rooms: {
    path: "/database/rooms",
    stops: [
      ...viaSidebar("/database/rooms", "Räume"),
      {
        target: create,
        title: "Raum anlegen",
        text: "Wähle „+ Raum“.",
        advance: "click",
      },
      {
        // Das ganze Formular „Neuer Raum“ bis über den Speichern-Knopf.
        target: DATA_FORM,
        endBefore: formSubmit,
        title: "Angaben eintragen",
        text: "Gib dem Raum einen Namen, zum Beispiel „Gruppenraum 1“. Die Kategorie hilft beim Finden, zum Beispiel Sport für die Turnhalle. Gebäude, Etage, maximale Belegung und Farbe kannst du später nachtragen.",
        advance: "next",
      },
      {
        target: formSubmit,
        title: "Speichern",
        text: "Speichere den Raum. Lege danach die nächsten an.",
        advance: "click",
      },
    ],
  },
  groups: {
    path: "/database/groups",
    stops: [
      ...viaSidebar("/database/groups", "Gruppendaten"),
      {
        target: create,
        title: "Gruppe anlegen",
        text: "Wähle „+ Gruppe“.",
        advance: "click",
      },
      {
        // Das ganze Formular „Neue Gruppe“ bis über den Speichern-Knopf.
        target: DATA_FORM,
        endBefore: formSubmit,
        title: "Angaben eintragen",
        text: "Gib der Gruppe einen Namen. Gruppenraum und Gruppenleitung kannst du später nachtragen. Als Leitung stehen nur Personen zur Wahl, die ihre Einladung schon angenommen haben.",
        advance: "next",
      },
      {
        target: formSubmit,
        title: "Speichern",
        text: "Speichere die Gruppe.",
        advance: "click",
      },
    ],
  },
  students: {
    path: "/database/students",
    stops: [
      ...viaSidebar("/database/students", "Kinderdaten"),
      {
        // Am Handy gibt es den Import nicht: Beide Stationen entfallen dort.
        target: '[data-setup-tour="student-menu"]',
        title: "Viele Kinder auf einmal",
        text: "Hast du eine Liste? Mit „Importieren“ übernimmst du alle Kinder in einem Schritt. Öffne dafür dieses Menü. Für ein einzelnes Kind wähle „Weiter“.",
        advance: "next",
        optional: true,
        skipCount: 2,
        advanceWhenVisible: '[data-setup-tour="student-import"]',
      },
      {
        // Nur bei offenem Menü da. Bleibt es zu (etwa mit „Weiter“ von der
        // Station davor) oder geht es wieder zu, entfällt die Station sofort.
        target: '[data-setup-tour="student-import"]',
        title: "Importieren wählen",
        text: "Wähle „Importieren“, dann zeigt die Tour, wie es geht. Für ein einzelnes Kind wähle „Weiter“.",
        advance: "next",
        skipWhenVisible: 'body:not(:has([data-setup-tour="student-import"]))',
        skipOnBack: true,
        // Wer hier auf „Importieren“ klickt, sieht, wie der Import geht.
        branch: "student-import",
      },
      {
        target: create,
        title: "Ein Kind anlegen",
        text: "Oder lege ein Kind einzeln an. Wähle „+ Kinder“.",
        advance: "click",
      },
      {
        // Der Scrollbereich des Formulars „Neues Kind“: das Formular, das den
        // „Erstellen“-Knopf trägt, und darin sein erster Block.
        target:
          'form:has([data-setup-tour="student-submit"]) > div:first-child',
        title: "Angaben eintragen",
        text: "Trage Vorname, Nachname und Klasse ein. Betreuungszeiten kannst du gleich mit eintragen.",
        advance: "next",
      },
      {
        target: '[data-setup-tour="student-submit"]',
        title: "Erstellen",
        text: "Wähle „Erstellen“. Danach steht das Kind in der Liste.",
        advance: "click",
      },
    ],
  },
  guardians: {
    path: "/database/students",
    stops: [
      ...viaSidebar("/database/students", "Kinderdaten"),
      {
        // Die Zeilen der Kinderliste verlinken auf die Kindakte mit ?from=.
        target: 'a[href*="/students/"][href*="?from="]',
        title: "Kind öffnen",
        text: "Eltern lädst du beim Kind ein. Wähle ein Kind.",
        advance: "click",
      },
      {
        target: '[role="tab"][data-tab-value="erziehungsberechtigte"]',
        pathPattern: CHILD_RECORD,
        title: "Erziehungsberechtigte",
        text: "Hier stehen die Eltern des Kindes. Wähle „Erziehungsberechtigte“.",
        advance: "click",
      },
      {
        target: '[data-setup-tour="guardian-add"]',
        pathPattern: CHILD_RECORD,
        title: "Eltern eintragen",
        text: "Noch niemand eingetragen? Wähle „Hinzufügen“.",
        advance: "click",
        // Steht schon jemand mit E-Mail-Adresse da, entfällt das Eintragen.
        skipWhenVisible: GUARDIAN_MENU,
        skipCount: 3,
      },
      {
        // Der Scrollbereich des Formulars: das Formular mit dem
        // Speichern-Knopf der Erziehungsberechtigten, darin sein erster Block.
        target:
          'form:has([data-setup-tour="guardian-submit"]) > div:first-child',
        pathPattern: CHILD_RECORD,
        title: "Angaben eintragen",
        text: "Trage Vor- und Nachnamen ein. Wichtig für die Einladung: Trage auch die E-Mail-Adresse ein. Ohne sie kann moto die Person nicht einladen.",
        advance: "next",
      },
      {
        target: '[data-setup-tour="guardian-submit"]',
        pathPattern: CHILD_RECORD,
        title: "Speichern",
        text: "Speichere die Person. Danach steht sie beim Kind.",
        advance: "click",
      },
      {
        target: GUARDIAN_MENU,
        pathPattern: CHILD_RECORD,
        title: "Menü öffnen",
        text: "Öffne das Menü neben dem Namen.",
        advance: "click",
      },
      {
        target: '[role="menu"]',
        mobileTarget: GUARDIAN_MENU,
        pathPattern: CHILD_RECORD,
        title: "Einladen",
        text: "Wähle „Einladen“. Die Person bekommt eine E-Mail mit einem Link zur Eltern-App.",
        advance: "click",
      },
    ],
  },
  worktime: workTimeTour(),
};

/**
 * Die Tour zu den Personen ohne Soll (#6919). Sie führt nicht durch die
 * Seitenleiste: Die Tour öffnet die Zeitkonten gleich mit dem Filter „ohne
 * Soll“. Die Checkliste startet sie im Monat, den sie gezählt hat.
 */
function workTimeTour(): SetupTour {
  return {
    path: "/staff",
    href: staffWithoutTargetHref(),
    stops: [
      {
        // Nur wer schon auf der Personalseite steht, sieht noch die Liste
        // der Personen. Öffnet die Tour die Seite, sind die Zeitkonten da.
        target: TIME_ACCOUNTS_TAB,
        title: "Zeitkonten öffnen",
        text: "Unter „Zeitkonten“ siehst du, wer noch kein Soll hat. Wähle „Zeitkonten“.",
        advance: "click",
        skipWhenVisible: `${TIME_ACCOUNTS_TAB}[aria-selected="true"]`,
      },
      {
        target: '[data-setup-tour="time-accounts-without-target"]',
        title: "Personen ohne Soll",
        text: "Bei diesen Personen fehlt das Soll. In der Tabelle steht bei ihnen „Kein Soll“. Trage nach der Tour bei jeder das Arbeitszeitmodell ein.",
        advance: "next",
        missingText:
          "Hier steht kein Hinweis. Dann haben in diesem Monat alle ein Soll.",
      },
    ],
  };
}
