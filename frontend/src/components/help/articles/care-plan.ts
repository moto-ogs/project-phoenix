import type { HelpTopic, HelpPresenceMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";
import { SIMPLE_NAV_DIFFERENCE } from "../help-article-shared";

export function carePlanTopic(presenceMode: HelpPresenceMode): HelpTopic {
  return {
    id: HELP_TOPICS.carePlan,
    title: "Den Betreuungsplan ansehen",
    question: "Wie sehe ich den Betreuungsplan an?",
    summary:
      "Prüfe, welche Betreuung für die Schule geplant ist und wo du selbst eingesetzt bist.",
    group: "tagesplanung",
    audience: ["caregiver", "lead"],
    icon: "Table",
    steps: [
      "Klappe in der Seitenleiste `Team` auf und öffne `Mein Kalender`.",
      "Wähle den Tab `Betreuungsplan`.",
      "Wähle oben `Tag` oder `Woche`.",
      "Nutze die Pfeile oder `Heute`, um zum passenden Tag zu wechseln.",
      presenceMode === "binary"
        ? "Gruppe und Fachkräfte stehen im Block, wenn sie zugeordnet sind."
        : "Raum, Gruppe und Fachkräfte stehen im Block, wenn sie zugeordnet sind.",
      "Ein durchgestrichener Name heißt: abwesend. `(Ersatz)` steht hinter einer Ersatzkraft.",
      "Wähle einen Block, um alle Kinder zu sehen.",
    ],
    result:
      "Du siehst, was die OGS geplant hat und wo du eingesetzt bist. Als Betreuungskraft kannst du den Plan nicht verändern.",
    differences: [
      // Live geprueft: die Kopfzeile des Reiters traegt das Kennzeichen.
      "Steht oben rechts `Nur ansehen`? Dann darfst du den Plan lesen, aber nicht ändern.",
      SIMPLE_NAV_DIFFERENCE,
    ],
    notes: [
      // #4766: Filter Gruppe und Person, auch in der Leseansicht.
      "Nur eine Gruppe oder eine Person sehen? Wähle oben bei `Alle Gruppen` eine Gruppe oder bei `Alle Personen` eine Person. Die Person sieht auch ihre Vertretungen.",
      // #4768: Raumfilter.
      "Nur einen Raum sehen? Wähle oben bei `Alle Räume` einen Raum.",
      "Die Adresse der Seite behält deine Auswahl. So kannst du den gefilterten Plan teilen.",
      // #5028: Sa/So nur in der Woche des heutigen Wochenendes.
      "Betreut deine OGS am Wochenende? Dann gilt dort der Freitagsplan. Am Wochenende zeigt die Wochenansicht dieser Woche auch Samstag und Sonntag.",
    ],
    troubleshootingDetails: [
      "Der Tab `Betreuungsplan` fehlt? Frag deine Leitung, ob sie deinen Zugang prüft.",
      "Steht dort `Noch kein Planungszeitraum`? Dann hat deine Leitung den Zeitraum noch nicht angelegt.",
      "Steht dort `Für diese Auswahl ist nichts geplant`? Stelle die Filter wieder auf `Alle Gruppen`, `Alle Personen` und `Alle Räume`.",
    ],
    related: [HELP_TOPICS.mySchedule, HELP_TOPICS.activeSupervision],
  };
}
