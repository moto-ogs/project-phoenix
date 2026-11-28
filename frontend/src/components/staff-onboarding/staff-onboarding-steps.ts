import type {
  SetupTour,
  SetupTourStop,
} from "~/components/school-setup/setup-tours";
import type { SchoolSetupNextTopic } from "~/components/school-setup/school-setup-steps";
import { HELP_TOPICS, type HelpTopicId } from "~/lib/help-topics";
import {
  STAFF_ONBOARDING_STEP_KEYS,
  type StaffOnboardingState,
  type StaffOnboardingStepKey,
} from "~/lib/staff-onboarding-api";

/** Was die Checkliste zu einem Schritt zeigt (#3748). */
export interface StaffOnboardingStepContent {
  title: string;
  description: string;
  /** Hinweise, die eine Entscheidung verändern. */
  hints: readonly string[];
  helpTopic: HelpTopicId;
}

export const STAFF_ONBOARDING_STEP_CONTENT: Readonly<
  Record<StaffOnboardingStepKey, StaffOnboardingStepContent>
> = {
  groups: {
    title: "Meine Gruppe ansehen",
    description: "Sieh, welche Kinder in deiner Gruppe sind und wer da ist.",
    hints: [],
    helpTopic: HELP_TOPICS.ownGroups,
  },
  students: {
    title: "Ein Kind finden und Angaben ansehen",
    description: "Suche ein Kind und öffne seine Angaben.",
    hints: ["Dort stehen auch Abholberechtigte und Notfallkontakte."],
    helpTopic: HELP_TOPICS.studentSearch,
  },
  attendance: {
    title: "Ein Kind an- und abmelden",
    description: "Trage ein, wann ein Kind kommt und geht.",
    hints: [],
    helpTopic: HELP_TOPICS.webAttendance,
  },
  calendar: {
    title: "Meine Termine ansehen",
    description: "Sieh deine Termine und Einsätze im Kalender.",
    hints: [],
    helpTopic: HELP_TOPICS.mySchedule,
  },
  supervision: {
    title: "Eine Aufsicht starten",
    description: "Übernimm einen Raum oder einen geplanten Termin.",
    hints: [],
    helpTopic: HELP_TOPICS.activeSupervision,
  },
  work_time: {
    title: "Arbeitszeit erfassen",
    description: "Stemple dich zu Arbeitsbeginn ein und am Ende aus.",
    hints: [],
    helpTopic: HELP_TOPICS.trackWorkTime,
  },
};

/** Was an der Schule und für die Person gilt; entscheidet, welche Schritte es gibt. */
export interface StaffOnboardingContext {
  /** Die Person hat in dieser Schule ein eigenes Personalprofil. */
  hasOwnStaff: boolean;
  /** Feste Gruppen und mindestens eine eigene Gruppe. */
  hasOwnGroup: boolean;
  /** An- und Abmelden geht in moto, nicht nur am Tablet. */
  webAttendance: boolean;
  /** Die Person darf ihren Kalender sehen (`calendar:own`). */
  canSeeCalendar: boolean;
  /** Die Schule erfasst Räume (detaillierte Anwesenheit). */
  roomsTracked: boolean;
  /**
   * Die Person darf „Alle Kinder“ öffnen (`users:read`). Die AG-Leitung
   * darf es nicht (#4573); auch das An- und Abmelden führt dorthin.
   */
  canSearchChildren: boolean;
  /** Die Person darf eine Aufsicht starten (`groups:update` oder `schedules:read`). */
  canSupervise: boolean;
  /** Die Person erfasst Arbeitszeit (`time_tracking:own`); Externe nicht. */
  canTrackWorkTime: boolean;
}

export interface StaffOnboardingStep {
  key: StaffOnboardingStepKey;
  done: boolean;
  skipped: boolean;
}

function applies(
  key: StaffOnboardingStepKey,
  context: StaffOnboardingContext,
): boolean {
  switch (key) {
    case "groups":
      return context.hasOwnGroup;
    case "attendance":
      return context.webAttendance && context.canSearchChildren;
    case "calendar":
      return context.hasOwnStaff && context.canSeeCalendar;
    case "supervision":
      return context.roomsTracked && context.canSupervise;
    case "students":
      return context.canSearchChildren;
    case "work_time":
      return context.hasOwnStaff && context.canTrackWorkTime;
  }
}

/** Die Schritte, die für diese Person gelten, in Reihenfolge. */
export function staffOnboardingSteps(
  state: StaffOnboardingState,
  context: StaffOnboardingContext,
): StaffOnboardingStep[] {
  return STAFF_ONBOARDING_STEP_KEYS.filter((key) => applies(key, context)).map(
    (key) => ({
      key,
      done: state.doneSteps.includes(key),
      skipped: state.skippedSteps.includes(key),
    }),
  );
}

/** Der erste offene Schritt, oder `null`, wenn alles erledigt ist. */
export function firstOpenStaffStep(
  steps: readonly StaffOnboardingStep[],
): StaffOnboardingStepKey | null {
  return steps.find((step) => !step.done && !step.skipped)?.key ?? null;
}

/**
 * Die Kindakte `/students/<id>` (mit Schul-Präfix im Pfad-Routing), auf die
 * die Tour aus der Kindersuche wechselt. Nicht die Suche selbst.
 */
export const STAFF_CHILD_RECORD =
  /^(?!.*\/database\/)(?:\/[^/]+)?\/students\/(?!search$)[^/]+$/;

/** Ein Ziel in der Navigation, am Computer und auf dem Handy. */
interface NavEntry {
  /** Der Eintrag in der Seitenleiste (und gleich benannt im „Mehr“-Menü). */
  target: string;
  label: string;
  /** Der Eintrag in der unteren Leiste auf dem Handy, falls er dort steht. */
  mobile?: { target: string; label: string };
}

const MORE = '[data-setup-tour="nav-more"]';

/**
 * Der Weg zur Seite. Am Computer: erst die Gruppe der Seitenleiste
 * aufklappen, dann den Eintrag. Auf dem Handy: der Eintrag in der unteren
 * Leiste, oder erst „Mehr“ und dann der Eintrag im Menü. Was auf dem
 * jeweiligen Gerät nicht da ist, entfällt, weil die nächste Stelle schon zu
 * sehen ist.
 */
function viaNavigation(
  group: { key: string; label: string },
  entry: NavEntry,
): SetupTourStop[] {
  const entryTarget = entry.mobile
    ? `${entry.target}, ${entry.mobile.target}`
    : entry.target;
  const stops: SetupTourStop[] = [
    {
      target: `[data-setup-tour="nav-group-${group.key}"]`,
      title: `${group.label} öffnen`,
      text: `Wähle in der Seitenleiste „${group.label}“.`,
      advance: "click",
      nav: true,
      // Auf dem Handy gibt es keine Seitenleiste, aber die untere Leiste.
      skipWhenVisible: `${entryTarget}, ${MORE}`,
    },
  ];
  if (!entry.mobile) {
    stops.push({
      target: MORE,
      title: "Mehr öffnen",
      text: "Wähle unten „Mehr“.",
      advance: "click",
      nav: true,
      // Am Computer steht der Eintrag schon in der Seitenleiste.
      skipWhenVisible: entry.target,
    });
    stops.push({
      // Im Mehr-Menü klappen die Gruppen (#7048). Steht die Gruppe schon
      // offen oder läuft die Tour am Computer, ist der Eintrag zu sehen.
      target: `[data-setup-tour="mobile-nav-group-${group.key}"]`,
      title: `${group.label} öffnen`,
      text: `Wähle im Menü „${group.label}“.`,
      advance: "click",
      nav: true,
      skipWhenVisible: entry.target,
    });
  }
  stops.push({
    target: entryTarget,
    title: `${entry.label} öffnen`,
    text: `Wähle „${entry.label}“.`,
    ...(entry.mobile
      ? {
          textWhenVisible: {
            selector: entry.mobile.target,
            text: `Wähle unten „${entry.mobile.label}“.`,
          },
        }
      : {}),
    advance: "click",
    nav: true,
  });
  return stops;
}

/**
 * Ein Reiter der Kindakte: erst anklicken, dann zeigt die Tour seinen Inhalt.
 * Fehlt der Reiter (manche sehen ihn nur mit einem Recht), entfallen beide
 * Stationen still.
 */
function childTab(value: string, label: string, text: string): SetupTourStop[] {
  return [
    {
      target: `[role="tab"][data-tab-value="${value}"]`,
      pathPattern: STAFF_CHILD_RECORD,
      title: label,
      text: `Wähle „${label}“.`,
      advance: "click",
      optional: true,
      skipCount: 2,
    },
    {
      // Die erste Karte des offenen Reiters, nicht die ganze Seite.
      target: '[role="tabpanel"][data-state="active"] > :first-child',
      pathPattern: STAFF_CHILD_RECORD,
      title: label,
      text,
      advance: "next",
    },
  ];
}

const TAGESBETRIEB = { key: "tagesbetrieb", label: "Tagesbetrieb" };
const TEAM = { key: "team", label: "Team" };
const ALL_CHILDREN: NavEntry = {
  target: '[data-setup-tour="nav-/students/search"]',
  label: "Alle Kinder",
  mobile: {
    target: '[data-setup-tour="mobile-nav-/students/search"]',
    label: "Suchen",
  },
};
const SEARCH = 'input[placeholder^="Name suchen"]';
// The switch into the mode, desktop and phone; named by its visible text
// since #7112, so the tour finds it by a marker.
const CHECKIN_TOGGLE = "button[data-checkin-toggle]";
const CHECKIN_BAR = '[aria-label="An- und Abmelde-Modus"]';

/** Die geführten Touren der ersten Schritte (#3748). */
export const STAFF_ONBOARDING_TOURS: Readonly<
  Record<StaffOnboardingStepKey, SetupTour>
> = {
  groups: {
    path: "/ogs-groups",
    stops: [
      ...viaNavigation(TAGESBETRIEB, {
        target: '[data-setup-tour="nav-section-groups"]',
        label: "Gruppen",
        mobile: {
          target: '[data-setup-tour="mobile-nav-/ogs-groups"]',
          label: "Gruppen",
        },
      }),
      {
        // „Gruppen“ führt auf die Auswahlseite (#4351). Wer nur eine Gruppe
        // sieht, landet direkt in ihr; dann entfällt diese Station.
        target: '[data-setup-tour="group-tile"]',
        title: "Gruppe öffnen",
        text: "Wähle deine Gruppe. Sie ist mit „Meine Gruppe“ markiert.",
        advance: "click",
        pathPattern: /\/ogs-groups(\/overview)?$/,
        skipWhenVisible: '[data-setup-tour="student-card"]',
        optional: true,
      },
      {
        // Eine Karte statt der ganzen Seite: Auf dem Handy wäre sonst fast
        // der ganze Bildschirm markiert.
        target: '[data-setup-tour="student-card"]',
        title: "Deine Gruppe",
        text: "Hier siehst du die Kinder deiner Gruppe. Jede Karte zeigt, wo das Kind gerade ist und wann es kommt und geht.",
        advance: "next",
        missingText: "In deiner Gruppe ist noch kein Kind. Wähle „Weiter“.",
      },
      {
        target: SEARCH,
        title: "Kind suchen",
        text: "Viele Kinder? Gib hier einen Namen ein.",
        advance: "next",
      },
    ],
  },
  students: {
    path: "/students/search",
    stops: [
      ...viaNavigation(TAGESBETRIEB, ALL_CHILDREN),
      {
        target: SEARCH,
        title: "Kind suchen",
        text: "Gib einen Namen ein. Ein Teil des Namens reicht.",
        advance: "next",
      },
      {
        target: '[data-setup-tour="student-card"]',
        title: "Die Karte eines Kindes",
        text: "Schon die Karte zeigt das Wichtigste: wo das Kind gerade ist, wann es kommt und geht und wie es nach Hause kommt. Wähle eine Karte. Dann siehst du alle Angaben.",
        // Auf dem Handy öffnet die Zeile erst das Kind-Blatt (#8070).
        mobileText:
          "Die Zeile zeigt das Wichtigste: wo das Kind gerade ist und wann es geht. Tippe auf ein Kind und dann auf „Ganze Akte öffnen“. Dann siehst du alle Angaben.",
        advance: "click",
        missingText:
          "Hier steht noch kein Kind. Prüfe die Suche oder die Filter.",
      },
      {
        target: '[role="tablist"]',
        pathPattern: STAFF_CHILD_RECORD,
        title: "Angaben des Kindes",
        text: "Die Angaben sind nach Bereichen sortiert. Die Tour zeigt dir die wichtigsten.",
        advance: "next",
      },
      ...childTab(
        "stammdaten",
        "Stammdaten",
        "Hier stehen Klasse, Gruppe und Geburtsdatum. Wichtig für den Alltag: Gesundheitsinformationen, Notizen und die erlaubten Heimwege.",
      ),
      ...childTab(
        "nachrichten",
        "Nachrichten",
        "Hier schreibst du den Eltern dieses Kindes und liest ihre Antworten.",
      ),
      ...childTab(
        "erziehungsberechtigte",
        "Erziehungsberechtigte",
        "Hier stehen Eltern, Abholberechtigte und Notfallkontakte mit ihren Kontaktangaben.",
      ),
      ...childTab(
        "betreuungsplan",
        "Betreuungsplan",
        "Hier siehst du, was für das Kind an einem Tag oder in einer Woche geplant ist.",
      ),
      ...childTab(
        "betreuungszeiten",
        "Betreuungszeiten",
        "Hier stehen die regelmäßigen Ankunfts- und Abholzeiten des Kindes für jeden Wochentag.",
      ),
    ],
  },
  attendance: {
    path: "/students/search",
    stops: [
      ...viaNavigation(TAGESBETRIEB, ALL_CHILDREN),
      {
        target: CHECKIN_TOGGLE,
        title: "An- und abmelden",
        // Der Knopf heißt am Computer „An- & Abmelden“, auf dem Handy
        // „Kinder an- und abmelden“: deshalb ohne Namen.
        text: "Mit diesem Knopf meldest du Kinder an und ab. Wähle ihn.",
        advance: "click",
        missingText:
          "Diesen Knopf gibt es nur für heute. Wähle oben den heutigen Tag.",
      },
      {
        target: '[data-setup-tour="student-card"][data-checkin-mode]',
        title: "Karte antippen",
        text: "Ein Tipp auf die Karte meldet das Kind an. Ein zweiter Tipp meldet es wieder ab. Der Status steht auf der Karte.",
        advance: "next",
      },
      {
        target: CHECKIN_BAR,
        title: "Fertig",
        text: "Bist du fertig, wähle hier „Fertig“. Dann öffnet ein Tipp auf die Karte wieder die Angaben des Kindes.",
        advance: "next",
      },
    ],
  },
  calendar: {
    path: "/calendar",
    stops: [
      ...viaNavigation(TEAM, {
        target: '[data-setup-tour="nav-/calendar"]',
        label: "Mein Kalender",
      }),
      {
        target: '[aria-label="Ansicht wählen"]',
        title: "Tag, Woche oder Monat",
        text: "Wähle, wie viel du auf einmal siehst.",
        advance: "next",
      },
      {
        // Die ganze Fläche statt des Rasters: In einer leeren Woche ersetzt
        // die Seite das Raster durch einen Hinweis, und die Tour fände keine
        // Stelle mehr.
        target: ".moto-tenant-body",
        title: "Deine Termine",
        text: "Hier stehen deine Termine, Einsätze und Schichten. Wähle einen Eintrag für mehr Angaben. Ist noch nichts eingetragen, bleibt die Fläche leer. Mit den Pfeilen oben siehst du andere Wochen.",
        advance: "next",
      },
    ],
  },
  supervision: {
    path: "/active-supervisions",
    stops: [
      ...viaNavigation(TAGESBETRIEB, {
        target: '[data-setup-tour="nav-section-supervisions"]',
        label: "Aktuelle Aufsicht",
        mobile: {
          target: '[data-setup-tour="mobile-nav-/active-supervisions"]',
          label: "Aufsicht",
        },
      }),
      {
        // „Als Nächstes“, oder ohne Aufsicht die Karte „Keine aktive
        // Raum-Aufsicht“: nie beide, und nie die ganze Seite.
        target:
          '[data-setup-tour="supervision-next"], [data-setup-tour="supervision-empty"]',
        title: "Aufsicht übernehmen",
        text: "Unter „Als Nächstes“ startest du deinen nächsten geplanten Termin. Steht dort nichts, bist du noch keinem Betreuungsangebot zugeteilt.",
        // Ohne Aufsicht und geplanten Termin zeigt die Seite (#4372: auch mit
        // offenen Räumen) nur „Keine aktive Raum-Aufsicht“, ohne „Als Nächstes“.
        textWhenVisible: {
          selector: '[data-setup-tour="supervision-empty"]',
          text: "Gerade beaufsichtigst du keinen Raum, und für dich ist nichts geplant. Steht ein Termin an, erscheint er hier unter „Als Nächstes“. Dort startest du ihn. Erscheint hier nie etwas, bist du noch keinem Betreuungsangebot zugeteilt.",
        },
        advance: "next",
      },
    ],
  },
  work_time: {
    path: "/time-tracking",
    stops: [
      ...viaNavigation(TEAM, {
        target: '[data-setup-tour="nav-/time-tracking"]',
        label: "Zeiterfassung",
      }),
      {
        target: '[data-setup-tour="time-clock"]',
        title: "Stempeluhr",
        text: "Wähle zu Arbeitsbeginn den Arbeitsort und dann „Einstempeln“. Pausen und Arbeitsende erfasst du hier genauso.",
        // Wer schon eingestempelt ist, sieht keinen Knopf „Einstempeln“.
        textWhenVisible: {
          selector: 'button[aria-label="Ausstempeln"]',
          text: "Du bist schon eingestempelt. Hier siehst du, wie lange du heute arbeitest. Mit „Pause starten“ erfasst du eine Pause, mit „Ausstempeln“ dein Arbeitsende.",
        },
        advance: "next",
      },
    ],
  },
};

// Der Reiter „Meine Gruppe“ in „Alle Kinder“ (MY_GROUPS_SCOPE in
// students/search/child-scope-tabs.ts) und der Rahmen um ihr Menü.
const MY_GROUP_TAB = '[role="tab"][data-tab-value="groups"]';
const ALL_CHILDREN_MENU = '[data-setup-tour="child-search-menu"] button';

/**
 * Die Touren für Schulen, die Kinder nur über „Alle Kinder“ finden lassen
 * (#1321). Dort fehlen „Gruppen“ und „Aktuelle Aufsicht“ in der
 * Navigation; die Touren zeigen den Weg, den es dann wirklich gibt.
 */
const CHILD_SEARCH_ONLY_TOURS: Readonly<
  Partial<Record<StaffOnboardingStepKey, SetupTour>>
> = {
  groups: {
    path: "/students/search",
    stops: [
      ...viaNavigation(TAGESBETRIEB, ALL_CHILDREN),
      {
        target: MY_GROUP_TAB,
        title: "Deine Gruppe",
        text: "Wähle diesen Reiter. Dann siehst du nur die Kinder deiner Gruppe.",
        advance: "click",
      },
      {
        target: '[data-setup-tour="student-card"]',
        title: "Deine Gruppe",
        text: "Hier siehst du die Kinder deiner Gruppe. Jede Karte zeigt, wo das Kind gerade ist und wann es kommt und geht.",
        advance: "next",
        missingText: "In deiner Gruppe ist noch kein Kind. Wähle „Weiter“.",
      },
      {
        target: SEARCH,
        title: "Kind suchen",
        text: "Viele Kinder? Gib hier einen Namen ein.",
        advance: "next",
      },
    ],
  },
  supervision: {
    path: "/active-supervisions",
    stops: [
      ...viaNavigation(TAGESBETRIEB, ALL_CHILDREN),
      {
        target: ALL_CHILDREN_MENU,
        title: "Menü öffnen",
        text: "Wähle oben rechts das Menü mit den drei Punkten.",
        advance: "click",
        nav: true,
      },
      {
        target: 'a[role="menuitem"][href$="/active-supervisions"]',
        title: "Zur Aufsicht öffnen",
        text: "Wähle „Zur Aufsicht“.",
        // Am Handy liegt der Eintrag im Blatt: Die Station zeigt aufs Menü.
        mobileTarget: ALL_CHILDREN_MENU,
        mobileText: "Öffne das Menü noch einmal und wähle „Zur Aufsicht“.",
        advance: "click",
        nav: true,
      },
      ...STAFF_ONBOARDING_TOURS.supervision.stops.filter((stop) => !stop.nav),
    ],
  },
};

/** Die Touren passend zur Navigation der Schule. */
export function staffOnboardingTours(
  childSearchOnlyNavigation: boolean,
): Readonly<Record<StaffOnboardingStepKey, SetupTour>> {
  return childSearchOnlyNavigation
    ? { ...STAFF_ONBOARDING_TOURS, ...CHILD_SEARCH_ONLY_TOURS }
    : STAFF_ONBOARDING_TOURS;
}

/**
 * Nach den ersten Schritten: Anleitungen für Dinge, die seltener anfallen.
 * Titel und Texte folgen den Artikeln der Hilfe.
 */
export const STAFF_NEXT_TOPICS: readonly SchoolSetupNextTopic[] = [
  {
    title: "moto aufs Handy holen",
    description: "So öffnest du moto mit einem Tipp wie eine App.",
    link: { topic: HELP_TOPICS.installApp },
  },
  {
    title: "Ein Kind krank melden",
    description: "Trage ein, wenn ein Kind heute fehlt.",
    link: { topic: HELP_TOPICS.absences },
  },
  {
    title: "Urlaub beantragen",
    description: "Beantrage Urlaub und sieh, was noch übrig ist.",
    link: { topic: HELP_TOPICS.vacation },
  },
  {
    title: "Den Team-Chat nutzen",
    description: "Schreibe deinen Kolleginnen und Kollegen.",
    link: { topic: HELP_TOPICS.teamChat },
  },
];
