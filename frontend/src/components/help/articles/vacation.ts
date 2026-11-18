import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";
import { SIMPLE_NAV_DIFFERENCE } from "../help-article-shared";

export function vacationTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.vacation,
    title: "Urlaub beantragen und den Stand prüfen",
    question: "Wie beantrage ich Urlaub und prüfe den Stand?",
    summary: "Sende einen Urlaubsantrag und verfolge die Entscheidung.",
    group: "arbeitszeit",
    audience: ["caregiver", "lead"],
    icon: "SunHorizon",
    steps: [
      "Klappe in der Seitenleiste `Team` auf und öffne `Zeiterfassung`.",
      "Suche die Karte `Urlaub`.",
      "Wähle `Urlaub beantragen`.",
      "Wähle den Zeitraum und bei Bedarf einen halben Tag.",
      "Ergänze bei Bedarf eine Notiz.",
      "Prüfe deinen Resturlaub und mögliche Überschneidungen.",
      "Sende den Antrag ab.",
    ],
    result:
      "Der Antrag erscheint unter `Meine Anträge`. Dort siehst du, ob er offen, genehmigt, abgelehnt oder zur Rückfrage zurückgegeben wurde.",
    differences: [
      "Krankheit, Fortbildung und andere Abwesenheiten meldest du über `Abwesend` in der Stempeluhr. Dafür stellst du keinen Urlaubsantrag.",
      SIMPLE_NAV_DIFFERENCE,
    ],
    notes: [
      "Einen offenen oder zukünftigen genehmigten Antrag kannst du stornieren.",
      "Ist der Antrag genehmigt, fallen deine Schichten an den ganzen Urlaubstagen aus. Im Betreuungsplan stehst du dann als abwesend. Das Team sieht dort nur `Abwesenheit`.",
      "Stornierst du einen genehmigten Antrag, plant moto dich an diesen Tagen wieder ein.",
      "Bei einer `Rückfrage` schreibst du eine Antwort und wählst `Antwort senden & erneut einreichen`.",
      "Unter einem offenen Antrag steht `Mail an die Leitung`, wenn die Schule die Leitung per Mail informiert. Kam eine Mail nicht an, sage der Leitung direkt Bescheid.",
    ],
    related: [HELP_TOPICS.ownAbsence, HELP_TOPICS.correctWorkTime],
  };
}
