import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Reiter `Kontakte`. Live geprueft: eine Karte `Abholberechtigte und
 * Kontakte` mit dem Knopf `Kontakt oder Abholperson hinzufügen`, darunter
 * die Karte `Verbundene Konten` mit `Einladen`. Ein Zwischenschritt
 * `Person hinzufügen` erscheint nicht. Die Schalter `Darf abholen` und
 * `Notfallkontakt` stehen schon im Anlegen-Fenster; spaeter aendern darf sie
 * nur, wer `can_manage_pickup` hat -- sonst heisst das Fenster nur
 * `Hinweis zur Abholung` (guardians-panel.tsx).
 */
export function parentGuardiansTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentGuardians,
    title: "Kontakte und Abholung verwalten",
    question: "Wer darf mein Kind abholen und wer wird erreicht?",
    summary: "Du hinterlegst Kontakte und legst Abholrechte fest.",
    group: "mein-kind",
    audience: "parent",
    icon: "Users",
    steps: [],
    instructionGroups: [
      {
        title: "Einen Kontakt hinzufügen",
        steps: [
          "Tippe unten auf `Mein Kind`.",
          "Wähle den Reiter `Kontakte`.",
          "Tippe auf `Kontakt oder Abholperson hinzufügen`.",
          "Wähle im Fenster `Kontakt hinzufügen` die `Beziehung zum Kind`.",
          "Schalte bei Bedarf `Darf abholen` und `Notfallkontakt` ein.",
          "Trage `Vorname` und `Nachname` ein.",
          "Mit `Darf abholen` wählst du bei `An welchen Tagen?` alle Tage oder einzelne Tage.",
          "Unterschreibe die Erlaubnis im Feld und tippe auf `Unterschrift bestätigen`.",
          "Tippe unten auf `Kontakt hinzufügen`.",
        ],
      },
      {
        title: "Abholrecht später ändern",
        description:
          "Bei jeder Person stehen rechts zwei Symbole: der Stift für die Kontaktdaten, das zweite für die Abholung.",
        steps: [
          "Tippe bei der Person auf das zweite Symbol `Abholrecht verwalten`.",
          "Schalte im Fenster `Abholung verwalten` `Darf abholen` ein oder aus.",
          "Wähle bei `An welchen Tagen?` `An allen Tagen` oder `Nur an bestimmten Tagen` und dann die Tage.",
          "Erteile oder ändere das Abholrecht, unterschreibe im Feld. Tippe auf `Unterschrift bestätigen`.",
          "Schalte bei Bedarf `Notfallkontakt` ein.",
          "Trage bei Bedarf einen `Hinweis zur Abholung` ein.",
          "Tippe auf `Speichern`.",
        ],
      },
      {
        title: "Die eigene Anrede wählen",
        description:
          "Die Anrede ist freiwillig. Mit Anrede beginnen E-Mails zum Beispiel mit `Liebe Karin` oder `Lieber Jonas`, ohne Anrede mit `Guten Tag` und deinem Namen.",
        steps: [
          "Tippe bei deinem eigenen Namen auf den Stift `Bearbeiten`.",
          "Wähle bei `Anrede` `Frau`, `Herr` oder `Keine Angabe`.",
          "Tippe auf `Speichern`.",
        ],
      },
      {
        title: "Einer Person App-Zugang geben",
        steps: [
          "Gehe zur Karte `Verbundene Konten`.",
          "Tippe auf `Einladen`.",
          "Trage die E-Mail-Adresse der Person ein.",
          "Tippe auf `Einladung senden`.",
        ],
      },
    ],
    result:
      "Die OGS sieht den Kontakt sofort. Ein neues oder geändertes Abholrecht gilt erst, wenn die OGS es bestätigt hat. Bis dahin steht an der Person `Wartet auf die OGS`.",
    notes: [
      "An einer Person stehen `Primär`, `Darf abholen` oder `Notfallkontakt`. Gilt das Abholrecht nur an manchen Tagen, steht dort zum Beispiel `Nur Di, Do`.",
      "Du unterschreibst als einfache elektronische Signatur mit gezeichneter Unterschrift. Statt zu zeichnen, kannst du mit `Namen tippen` deinen Namen eintragen.",
      "Das Abholrecht wegnehmen geht sofort und ohne Unterschrift.",
      "Holt jemand nur an einem einzigen Tag ab? Dann änderst du die Abholung für diesen Tag.",
      "Ein Kontakt braucht kein eigenes Konto. Zum Beispiel Oma oder Opa.",
      "Eine Anrede wählt jede Person nur für sich selbst. Bei anderen Kontakten fehlt das Feld.",
      "Eine E-Mail beim Kontakt lädt niemanden ein. Der App-Zugang ist ein eigener Schritt.",
    ],
    differences: [
      "Dein Kind hat keinen OGS-Platz? Notfallkontakte bleiben möglich. Abholrechte und Hinweise zur Abholung fehlen dann. Bei bestehenden Kontakten öffnest du dafür `Notfallkontakt`.",
      "Unter `Verbundene Konten` siehst du, wer die Eltern-App für dein Kind nutzt.",
    ],
    troubleshootingDetails: [
      "moto sagt, die Person verwalte ihre Daten über ein eigenes Konto? Dann ändert sie ihre Angaben selbst.",
      "moto sagt, die Kontaktdaten würden von der Schule verwaltet? Dann wende dich an die OGS.",
      "Die Verwaltung ist deaktiviert? Dann nimmt deine OGS das nicht über die App an.",
      "`Einladen` fehlt? Dann darfst du für dieses Kind niemanden einladen. Frage die OGS.",
      "`Darf abholen` fehlt bei einer Person mit eigenem Konto? Ein Elternteil mit eigenem Konto regelt die OGS. Frage die OGS.",
    ],
    related: [
      HELP_TOPICS.parentChildData,
      HELP_TOPICS.parentPickupChange,
      HELP_TOPICS.parentChildOverview,
    ],
  };
}
