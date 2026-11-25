import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Mensa-Abrechnung des Trägers (#4686): je Schule je Essen oder als
 * Pauschale, abgerechnet im Monatslauf aus der Freigabe der OGS-Leitung.
 */
export function traegerCareMealsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerCareMeals,
    title: "Mensa abrechnen",
    question: "Wie rechne ich das Essen ab, pro Essen oder als Pauschale?",
    summary:
      "Du legst pro Schule fest, wie die Mensa abgerechnet wird. Der Monatslauf setzt freigegebene Monate auf die Rechnung des Kindes.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "UtensilsCrossed",
    requirements: [
      "Deine Rolle im Träger-Büro ist Abrechnung.",
      "Die OGS-Leitung gibt jeden Monat in moto frei. Erst dann wird er abgerechnet.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Preis festlegen",
        steps: [
          "Wähle `Preise und Ermäßigungen` und dann den Reiter `Mensa`.",
          "Wähle bei der Schule `Preis festlegen`.",
          "Wähle bei `Gültig ab` den ersten Monat.",
          "Wähle die Abrechnungsart: `Pro Essen` oder `Pauschale`.",
          "Trage den Betrag ein, zum Beispiel 4,80 pro Essen.",
          "Wähle `Preis speichern`.",
        ],
      },
      {
        title: "Im Monatslauf",
        description:
          "Die Mensa steht im Monatslauf als eigene Zeile pro Monat auf der Rechnung des Kindes, zum Beispiel „2 Mittagessen im Januar 2026“.",
        steps: [
          "Wähle `Abrechnungsläufe` und dann den Reiter `Monatsbeiträge`.",
          "Starte oder öffne den Lauf eines Monats.",
          "Die Karte `Mensa` nennt Monate, die eine Schule noch nicht freigegeben hat, und Kinder ohne Vertrag.",
          "`Nicht mehr abrechenbar` heißt: Die Anwesenheiten des Monats sind nach der Aufbewahrungsfrist der Schule gelöscht. Diesen Monat rechnet kein Lauf mehr ab.",
          "`Nach der Ausstellung geändert` heißt: Die Schule hat einen Monat erneut freigegeben, der schon auf einer Rechnung steht. Storniere diese Rechnung. Der nächste Lauf dieses Monats stellt sie mit den neuen Zahlen neu aus.",
          "Prüfe die Rechnungen und gib den Lauf frei.",
        ],
      },
    ],
    result:
      "Jeder freigegebene Mensa-Monat steht genau einmal auf einer Rechnung. Gibt eine Schule einen Monat später frei, rechnet ihn der nächste Lauf nachträglich ab.",
    notes: [
      "Nach einem Storno stellst du die Mensa im ursprünglichen Rechnungsmonat neu aus. Starte dafür einen weiteren Lauf dieses Monats.",
      "Ob die Mensa auf der Rechnung der Betreuung steht oder eine eigene Rechnung bekommt, lege unter `Einstellungen` und dann `Abrechnungsvorgaben` in der Karte `Zahlung und Rechnungen` beim `Mittagessen` fest. Eine eigene Mensa-Rechnung hat ihren eigenen Zahlungsweg und ihr eigenes Zahlungsziel. Im Monatslauf schließt du sie getrennt von der Betreuung aus.",
      "Ermäßigungen wie Geschwister oder Einkommensstufen gelten nur für die Module. Die Mensa zahlen Eltern voll.",
      "Ein Preis, mit dem schon abgerechnet ist, bleibt für diese Monate. Ändere ihn ab einem späteren Monat.",
    ],
    related: [HELP_TOPICS.traegerCareMonths, HELP_TOPICS.traegerCareReductions],
  };
}
