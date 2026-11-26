import type { HelpTopic, HelpPresenceMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Der Tagesplan (#2383) ist in der echten App der oberste Eintrag im
 * Tagesbetrieb und hatte bisher keine Hilfeseite. Inhalt belegt aus
 * `components/timetable/tagesplan-view.tsx`: chronologische Blockliste,
 * Jetzt-Linie, Tippen auf einen laufenden Block oeffnet dessen Kinderliste,
 * ein startbarer Block startet ueber `Starten` (#3622). Bei einfacher Anwesenheit greift
 * der BinaryModeGuard, deshalb steht das Thema in DETAILED_ONLY_TOPIC_IDS.
 */
export function dayPlanTopic(presenceMode: HelpPresenceMode): HelpTopic {
  return {
    id: HELP_TOPICS.dayPlan,
    title: "Den Betreuungstag von heute verfolgen",
    question: "Wo sehe ich den Betreuungstag von heute?",
    summary:
      "Die Seite `Heute` zeigt die Betreuungsblöcke des Tages nach Uhrzeit.",
    group: "tagesplanung",
    audience: "caregiver",
    icon: "ClockAfternoon",
    requirements: [
      "Deine OGS hat den Betreuungsplan eingeschaltet.",
      "Du darfst den Betreuungsplan sehen.",
    ],
    steps: [
      "Öffne `Heute` in der Seitenleiste.",
      "Du siehst die Blöcke des Tages von früh nach spät.",
      "Blöcke zur selben Zeit stehen nebeneinander, unter `Gleichzeitig`.",
      "Eine Linie zeigt, wo du gerade im Tag stehst.",
      "Tippe auf einen laufenden Block. Das öffnet seine Kinderliste.",
      "Hat dein Block noch nicht begonnen? Wähle `Starten`.",
    ],
    result:
      "Nach `Starten` öffnet moto die Kinderliste des Blocks in `Aktuelle Aufsicht`.",
    differences: [
      "`Läuft` heißt: der Block ist gerade aktiv. `Beendet` und `Nicht gestartet` kannst du nur ansehen.",
      "`Fällt aus` zeigt zusätzlich den Grund.",
      "Laufen mehr als zwei Blöcke gleichzeitig? Dann wische auf dem Handy zur Seite, um alle zu sehen.",
      "Ein `Dienst` ist eine Aufgabe ohne Kinder, etwa die Busaufsicht. Er hat keinen Knopf `Starten`.",
      "Blöcke, für die du eingeteilt bist, sind in ihrer Farbe hinterlegt. Das gilt auch für eine Vertretung.",
      "Welche Blöcke du siehst, legt deine OGS fest. Manche sehen den ganzen Tag der Schule, andere nur die eigene Einteilung.",
      "Ob du nur eigene oder alle Blöcke starten darfst, legt deine OGS fest. Wer einen fremden Block startet, wird nicht zur Aufsicht.",
      ...(presenceMode === "unknown"
        ? ["Bei einfacher Anwesenheit gibt es die Seite `Heute` nicht."]
        : []),
    ],
    notes: [
      "Mit den Pfeilen oben rechts siehst du einen anderen Tag.",
      // #8134: der ganze Plan steht direkt unter `Heute`.
      "Steht unter `Heute` auch `Betreuungsplan`? Dort siehst du die ganze Woche der OGS.",
      "Betreut deine OGS am Wochenende? Dann zeigt die Seite `Heute` auch Samstag und Sonntag. Dort gilt der Freitagsplan.",
    ],
    troubleshootingDetails: [
      // Live geprueft: der haeufigste Leerzustand einer Betreuungskraft.
      "Steht dort `Heute ist keine Betreuung geplant`? Dann bist du für diesen Tag nicht eingeteilt. Die Einteilung macht deine Leitung.",
      "Steht dort `Der Betreuungsplan ist ausgeschaltet`? Dann nutzt deine OGS diese Funktion nicht.",
      "Steht dort `Kein Zugriff auf den Betreuungsplan`? Frag deine Leitung, ob sie deinen Zugang prüft.",
    ],
    related: [HELP_TOPICS.carePlan, HELP_TOPICS.activeSupervision],
  };
}
