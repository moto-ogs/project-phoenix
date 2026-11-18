import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";
import { SIMPLE_NAV_DIFFERENCE } from "../help-article-shared";

export function ownAbsenceTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.ownAbsence,
    title: "Eine eigene Abwesenheit eintragen",
    question: "Wie trage ich eine eigene Abwesenheit ein?",
    summary:
      "Melde Krankheit, Fortbildung oder eine andere Abwesenheit für den passenden Zeitraum.",
    group: "arbeitszeit",
    audience: ["caregiver", "lead"],
    icon: "BellRing",
    steps: [
      "Klappe in der Seitenleiste `Team` auf und öffne `Zeiterfassung`.",
      "Wähle in der `Stempeluhr` oben `Abwesend`.",
      "Wähle den runden Knopf `Abwesenheit melden`.",
      "Wähle unter `Art der Abwesenheit` den passenden Eintrag.",
      "Trage `Von` und `Bis` ein.",
      "Schalte bei Bedarf `Halber Tag` ein.",
      "Trage bei Bedarf eine `Bemerkung` ein.",
      "Wähle `Speichern`.",
    ],
    result:
      "Die Abwesenheit ist eingetragen und erscheint in deiner Zeiterfassung.",
    differences: [
      "Deine OGS kann zusätzliche Abwesenheitsarten anbieten.",
      "Manche Arten beantragst du, zum Beispiel einen Regenerationstag. Dann heißt der Knopf `Beantragen`. Deine Leitung gibt frei oder lehnt ab. Den Stand siehst du in der Karte `Urlaub` unter `Meine Anträge`.",
      "Urlaub beantragst du in der Karte `Urlaub` und nicht über diese Aktion.",
      "Freizeitausgleich trägt nur ein, wer die Zeiten des Teams verwalten darf.",
      SIMPLE_NAV_DIFFERENCE,
    ],
    notes: [
      "An ganzen Abwesenheitstagen fallen deine Schichten aus. Im Betreuungsplan stehst du als abwesend.",
      "In den Plänen sieht das Team nur, ob du krank oder abwesend bist. Die Art und deine Bemerkung sieht es nicht.",
      "Bei einem halben Tag bleiben deine Schichten stehen. Deine Leitung ändert sie bei Bedarf.",
      "Deine Abwesenheit steht danach in der Tabelle `Zeiterfassung` unter `Status`. Über das Stift-Symbol am Ende der Zeile öffnest du den Tag.",
      "Hat eine Art deiner OGS feste Tage, siehst du den Stand in der Karte `Kontingente`. Den Anspruch trägt deine Leitung ein.",
      "Arbeitest du an mehreren Schulen deines Trägers, zählen die Tage einer Art des Trägers an allen Schulen zusammen. Den Anspruch legt dann dein Träger fest.",
    ],
    related: [HELP_TOPICS.vacation, HELP_TOPICS.trackWorkTime],
  };
}
