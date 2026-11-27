import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/ferienwochen/zusatztage` (#4817, ADR 0329): die OGS legt einen einzelnen
 * Betreuungstag außerhalb der Ferien für sich selbst an, etwa einen
 * Brückentag. Anmeldungen, Plätze und Abrechnung bleiben beim Träger.
 */
export function schoolExtraCareDayTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadExtraCareDay,
    title: "Zusatztag für deine OGS anlegen",
    question: "Wie biete ich Betreuung an einem Brückentag an?",
    summary:
      "Ein Zusatztag ist ein einzelner Betreuungstag außerhalb der Ferien, zum Beispiel ein Brückentag oder ein beweglicher Ferientag. Du legst ihn für deine OGS an.",
    group: "auswertung",
    audience: "lead",
    icon: "CalendarStar",
    requirements: [
      "Du darfst die Schließtage deiner OGS planen. Das darf die Leitung.",
      "Der Tag ist an deiner OGS kein Feiertag und kein Schließtag.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Zusatztag anlegen",
        steps: [
          "Klappe in der Seitenleiste `Eltern` auf.",
          "Öffne `Ferienwochen`.",
          "Wähle oben `Zusatztage`. Du findest `Zusatztage` auch bei den `Schließtagen`.",
          "Wähle `Zusatztag anlegen`.",
          "Trage den `Name des Zusatztags` ein, zum Beispiel Brückentag nach Himmelfahrt.",
          "Wähle den `Tag`. Möglich ist ein Tag von Montag bis Freitag.",
          "Trage unter `Betreuungszeit` `Beginn` und `Ende` ein.",
          "Trage `Anmeldebeginn` und `Anmeldeschluss` ein. Der Anmeldeschluss liegt spätestens am Zusatztag.",
          "Wähle unter `Beitrag` `Im Monatsbeitrag enthalten` oder `Mit Tagespreis`. Mit Tagespreis trägst du den `Preis pro Tag in Euro` ein.",
          "Gibt es an dem Tag Mittagessen? Schalte `Mittagessen anbieten` ein.",
          "Schreibe unter `Hinweise für Eltern`, was Eltern wissen müssen.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Veröffentlichen",
        steps: [
          "Öffne den Zusatztag in der Liste `Zusatztage`.",
          "Wähle oben `Veröffentlichen`.",
          "Bestätige mit `Veröffentlichen`.",
          "Unter `Link für Eltern` steht danach der Link zur Anmeldung. Kopiere ihn mit `Link kopieren` und gib ihn an die Eltern weiter.",
        ],
      },
    ],
    result:
      "Der Zusatztag ist für die Anmeldung freigegeben. Eltern melden ihr Kind über den Link oder in der Eltern-App an. Dein Träger bestätigt die Anmeldungen. Bestätigte Kinder stehen danach unter `Ferienwochen`.",
    notes: [
      "`Im Monatsbeitrag enthalten`: Eltern melden nur an, dass ihr Kind kommt. Sie sehen keinen Preis.",
      "`Mit Tagespreis`: Eltern buchen den Tag dazu. Den Preis rechnet dein Träger ab.",
      "Dein Träger sieht den Zusatztag in seinem Portal und kann ihn ändern. Dort werden auch die Plätze begrenzt.",
      "Ein gespeicherter Zusatztag ist zuerst ein Entwurf. Ein veröffentlichter Zusatztag wird nicht wieder zum Entwurf.",
    ],
    differences: [
      "`Im Monatsbeitrag enthalten` und `Mit Tagespreis` lassen sich nicht wählen? Der Zusatztag ist veröffentlicht. Eltern haben sich auf diesen Beitrag verlassen. Er bleibt dann so.",
      "Ein Zusatztag fehlt in der Liste? Die Liste zeigt nur Zusatztage, die deine OGS selbst angelegt hat. Einen Zusatztag deines Trägers siehst du nach dem Veröffentlichen unter `Ferienwochen`.",
      "Du siehst oben kein `Zusatztage`? Dir fehlt das Recht, Schließtage zu planen. Frage deine Leitung.",
    ],
    troubleshootingDetails: [
      "Der Zusatztag lässt sich nicht speichern, weil keine Betreuung ist? Der Tag ist ein Feiertag oder ein Schließtag. An einem Feiertag gibt es keinen Zusatztag. Einen Schließtag änderst du zuerst unter `Schließtage`.",
      "`Veröffentlichen` lässt sich nicht wählen? Speichere zuerst deine Änderungen.",
    ],
    related: [HELP_TOPICS.leadHolidayWeeks, HELP_TOPICS.leadHolidayGuestGroup],
  };
}
