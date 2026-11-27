import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/ferien/zusatztage` (#4817): ein einzelner Betreuungstag außerhalb
 * der Ferien, etwa ein Brückentag oder ein beweglicher Ferientag, für eine
 * oder mehrere Schulen. Im Monatsbeitrag enthalten oder mit Tagespreis.
 */
export function traegerExtraCareDayTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerExtraCareDay,
    title: "Zusatztag anlegen",
    question: "Wie biete ich Betreuung an einem Brückentag an?",
    summary:
      "Ein Zusatztag ist ein einzelner Betreuungstag außerhalb der Ferien, zum Beispiel ein Brückentag oder ein beweglicher Ferientag. Du legst ihn für eine oder mehrere Schulen an.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "CalendarStar",
    image: "/help/screens/traeger-zusatztag-anlegen.webp",
    imageAlt:
      "Das Formular eines Zusatztags mit Tag, Schulen, Betreuungszeit, Anmeldung und Beitrag.",
    requirements: [
      "Deine Rolle im Träger-Büro darf Anmeldungen verwalten. Das gilt für die Rolle Verwaltung.",
      "Der Tag ist an den gewählten Schulen kein Feiertag und kein Schließtag.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Zusatztag anlegen",
        steps: [
          "Wähle in der Navigation `Ferienbetreuung`.",
          "Wähle oben den Reiter `Zusatztage`.",
          "Wähle `Zusatztag anlegen`.",
          "Trage den `Name des Zusatztags` ein, zum Beispiel Brückentag nach Himmelfahrt.",
          "Wähle den `Tag`. Möglich ist ein Tag von Montag bis Freitag.",
          "Setze unter `Schulen` einen Haken bei jeder Schule, an der es Betreuung gibt. Mit `Alle Schulen` wählst du alle auf einmal.",
          "Trage unter `Betreuungszeit` `Beginn` und `Ende` ein. Die Zeit gilt für alle gewählten Schulen.",
          "Trage `Anmeldebeginn` und `Anmeldeschluss` ein. Der Anmeldeschluss liegt spätestens am Zusatztag.",
          "Wähle unter `Beitrag` `Im Monatsbeitrag enthalten` oder `Mit Tagespreis`. Mit Tagespreis trägst du den `Preis pro Tag in Euro` ein.",
          "Gibt es an dem Tag Mittagessen? Schalte `Mittagessen anbieten` ein. Mit Tagespreis trägst du den `Preis für ein Essen in Euro` ein.",
          "Schreibe unter `Hinweise für Eltern`, was Eltern wissen müssen. Zum Beispiel, ob ein Mittagessen nötig ist.",
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
      {
        title: "Zahlen pro Schule ansehen und herunterladen",
        steps: [
          "Öffne den Zusatztag. Unter `Kinder pro Schule` steht für jede Schule, wie viele Kinder einen Platz haben.",
          "Im Reiter `Plätze` begrenzt du die Plätze pro Schule und siehst die Warteliste.",
          "Im Reiter `Anmeldungen` prüfst und bestätigst du die Anmeldungen.",
          "Für eine Datei wählst du in der Liste `Zusatztage` oben rechts das Drei-Punkte-Menü. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`. Die Datei hat eine Zeile pro Zusatztag und Schule.",
        ],
      },
    ],
    result:
      "Der Zusatztag ist für die Anmeldung freigegeben. Eltern melden ihr Kind über den Link oder in der Eltern-App an. Bestätigte Kinder stehen an dem Tag bei der Schule unter `Ferienwochen`.",
    notes: [
      "`Im Monatsbeitrag enthalten`: Eltern melden nur an, dass ihr Kind kommt. Sie sehen keinen Preis. Der Zusatztag steht in keiner Abrechnung.",
      "`Mit Tagespreis`: Eltern buchen den Tag dazu. Der Preis geht in die Abrechnung der Ferienbetreuung. Geschwister und Befreiung gelten wie dort unter `Abrechnungsvorgaben`.",
      "Kinder der Schule erkennt moto wie bei der Ferienanmeldung. In der Anmeldung steht dann `Kind der Schule`. Es werden dafür keine Daten freigeschaltet.",
      "Mit `Mittagessen anbieten` wählen Eltern das Essen für jedes Kind dazu. Die Schule sieht unter `Ferienwochen`, wie viele Essen sie braucht. Ist der Tag im Monatsbeitrag enthalten, kostet das Essen nichts extra.",
      "Ein gespeicherter Zusatztag ist zuerst ein Entwurf. Ein Entwurf ist nicht für die Anmeldung freigegeben.",
      "Ein veröffentlichter Zusatztag wird nicht wieder zum Entwurf.",
      "Die Fragen an die Eltern änderst du im Reiter `Formular`, wie bei einem Ferienzeitraum.",
      "Auch eine Schule kann einen Zusatztag für sich selbst anlegen und veröffentlichen. Er steht dann in deiner Liste. Auf seiner Seite steht `Von der Schule angelegt`. Du bestätigst die Anmeldungen und rechnest einen Tagespreis ab.",
    ],
    differences: [
      "`Im Monatsbeitrag enthalten` und `Mit Tagespreis` lassen sich nicht wählen? Der Zusatztag ist veröffentlicht. Eltern haben sich auf diesen Beitrag verlassen. Er bleibt dann so.",
      "`Mittagessen anbieten` lässt sich nicht ausschalten? Für den Tag ist schon Mittagessen gebucht. Das Angebot bleibt dann.",
      "Bei einer Schule steht `Hat schon Anmeldungen und bleibt gewählt.`? Dort ist ein Kind angemeldet. Die Schule lässt sich dann nicht mehr abwählen.",
      "Du siehst in der Navigation kein `Ferienbetreuung`? Deine Rolle darf keine Anmeldungen verwalten. Frage im Träger-Büro nach der Rolle Verwaltung.",
    ],
    troubleshootingDetails: [
      "Unter den Schulen steht `An diesem Tag gibt es dort keine Betreuung`? Der Tag ist an dieser Schule ein Feiertag oder ein Schließtag. An einem Feiertag gibt es keinen Zusatztag. Bei einem Schließtag nimmst du die Schule zuerst unter `Schließtage` aus dem Schließtag heraus.",
      "Der Zusatztag lässt sich nicht speichern, weil keine Betreuung ist? Auch ein Schließtag, den die Schule selbst eingetragen hat, zählt. Frage bei der Schule nach.",
      "`Veröffentlichen` lässt sich nicht wählen? Speichere zuerst deine Änderungen. Der Zusatztag braucht mindestens eine Schule.",
      "Eine Schule fehlt unter `Schulen`? Das moto-Team ordnet die Schulen deinem Träger zu.",
    ],
    related: [
      HELP_TOPICS.traegerHolidayPeriod,
      HELP_TOPICS.traegerHolidayRegistrationReview,
      HELP_TOPICS.traegerHolidayPlaces,
      HELP_TOPICS.traegerClosingDays,
      HELP_TOPICS.traegerHolidayContribution,
    ],
  };
}
