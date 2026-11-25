import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Essensplan unter `/meal-plan`. Wochenweise, mit ausdruecklichem Speichern:
 * Aenderungen sind bis dahin nur Entwurf (page.tsx:799).
 */
export function mealPlanTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadMealPlan,
    title: "Einen Speiseplan veröffentlichen",
    question: "Wie zeige ich den Eltern den Speiseplan?",
    summary: "Trage die Gerichte pro Tag ein. Eltern sehen den Plan sofort.",
    group: "elternarbeit",
    audience: "lead",
    icon: "UtensilsCrossed",
    steps: [
      "Klappe in der Seitenleiste `Eltern` auf.",
      "Öffne `Speiseplan`.",
      "Blättere oben unter dem Titel mit den Pfeilen zur gewünschten Woche. `Diese Woche` bringt dich zurück.",
      "Trage bei einem Tag unter `Gericht eintragen…` das Gericht ein.",
      "Trage bei Bedarf einen `Hinweis (optional)` dazu ein.",
      "Öffne unter dem Gericht die Auswahl `Allergene` und hake die Allergene an. Danach stehen dort die Buchstaben, zum Beispiel `A, G`.",
      "Mit `+ Gericht` ergänzt du ein zweites Gericht für denselben Tag.",
      "Wähle `Speichern`.",
    ],
    result: "Der Plan erscheint sofort im Elternportal.",
    notes: [
      "Pro Tag sind mehrere Gerichte möglich.",
      "Änderst du einen Tag, der schon Gerichte hatte, bekommen die Eltern einen Hinweis in moto. Das gilt nur für Kinder, die an dem Tag ein Essen gebucht haben. Mehrere Änderungen einer Woche in 10 Minuten werden ein Hinweis.",
      // „Heute anders“ zeigt dem Team den geänderten Tag (#7666).
      "Am Tag selbst sieht das Team auf der `Startseite` unter `Heute anders`, dass der Speiseplan geändert wurde. Die Gerichte stehen dort nicht.",
      "Zur Auswahl stehen die 14 Hauptallergene, jedes mit einem festen Buchstaben. Die Liste ist für alle Schulen gleich.",
      "Eltern sehen die Buchstaben am Gericht und darunter die Erklärung. Dort steht auch, dass die Angaben von der Schule oder vom Caterer kommen.",
      "Mit `Vorwoche übernehmen` holst du die Gerichte der Vorwoche in diese Woche.",
      "Der heutige Tag trägt das Kennzeichen `Heute`.",
      "Die Woche oben gilt für den Plan und für die `Bestellung` darunter.",
      "Ganz unten steht die Liste für die Küche. Mit `Tag` und `Woche` wechselst du die Ansicht.",
      "Die Wochenliste zeigt jedes angemeldete Kind mit einem Haken pro Tag. Darüber steht, wie viele Kinder an jedem Tag essen.",
      "Öffne `Tagesliste herunterladen` oder `Wochenliste herunterladen`. Wähle `PDF` oder `Excel`.",
      "Bis wann Eltern ändern können, legst du unter `Einstellungen` im Bereich `Mittagessen` fest.",
      "An Feiertagen und Schließtagen gibt es kein Essen. Die Wochenliste zeigt dort `kein Essen`.",
    ],
    differences: [
      "Deine Änderungen zählen erst mit `Speichern`. Vorher steht `Verwerfen` daneben.",
      "Beim Wechseln der Woche mit offenen Änderungen fragt moto nach.",
      "Auch beim Neuladen mit `Wiederholen` fragt moto bei offenen Änderungen nach.",
    ],
    troubleshootingDetails: [
      "Bekommen Eltern keinen Hinweis zu Änderungen? Prüfe unter `Einstellungen` den Schalter `Hinweis bei geändertem Speiseplan`. Für vergangene Tage gibt es keinen Hinweis.",
      "Meldet moto beim Speichern, dass jemand anderes den Speiseplan inzwischen geändert hat? Deine Änderungen bleiben stehen. Mit `Verwerfen` siehst du den neuen Stand. Mit `Speichern` ersetzt du ihn durch deine Änderungen.",
      "Fehlt `Speiseplan` in der Seitenleiste? Dann ist die Funktion für deine OGS ausgeschaltet, oder deiner Rolle fehlt das Recht `Mittagessen: Lesen`.",
    ],
    related: [
      HELP_TOPICS.leadParentAnnouncement,
      HELP_TOPICS.leadParentVisibility,
      HELP_TOPICS.settings,
    ],
  };
}
