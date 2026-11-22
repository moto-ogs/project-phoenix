import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function traegerCareReductionsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerCareReductions,
    title: "Ermäßigungen im Monatsbeitrag",
    question:
      "Wie lege ich Geschwister, Einkommensstufen und Höchstbeträge fest?",
    summary:
      "Du legst fest, wann eine Familie weniger zahlt. Der Monatslauf rechnet jede Ermäßigung selbst aus. Sie steht als eigene Zeile auf der Rechnung.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "SlidersHorizontal",
    requirements: [
      "Deine Rolle im Träger-Büro ist Abrechnung.",
      "Die Preise der Module stehen in der `Preisliste`.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Regel anlegen",
        description:
          "Es gibt vier Arten: Einkommensstufen, Geschwister, Alleinerziehende und Höchstbetrag. Der Monatslauf rechnet sie in dieser Reihenfolge.",
        steps: [
          "Wähle `Preise und Ermäßigungen` und dann den Reiter `Ermäßigungen`.",
          "Wähle bei der Art den Knopf `Geschwisterregel anlegen`, `Regel für Alleinerziehende anlegen`, `Stufe anlegen` oder `Höchstbetrag anlegen`.",
          "Gib einen Namen ein. Er steht so auf der Rechnung.",
          "Wähle die Monate und die Schulen, für die die Regel gilt.",
          "Soll die Regel nur für einzelne Module gelten, wähle die Module. Sonst lass das Feld leer.",
          "Wähle die Wirkung: `Anteil weniger`, `Betrag weniger` oder `Fester Preis`. Trage die Zahl ein. Bei Geschwistern gibt es auch `Preis laut Preisliste`.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Geschwister",
        description:
          "Geschwister sind Kinder mit derselben Rechnungsadresse. Das Kind mit dem höchsten Beitrag ist das 1. Kind. Bei gleichem Beitrag zählt das ältere Kind zuerst.",
        steps: [
          "Wähle bei `Wer zahlt weniger?`, für welche Kinder die Regel gilt.",
          "`Nur weitere Kinder` heißt: Die ersten Kinder zahlen den vollen Beitrag. Wähle bei `Ab dem Kind`, ab welchem Kind die Familie weniger zahlt, zum Beispiel ab dem 2. Kind.",
          "`Alle Kinder der Familie` heißt: Ab einer Kinderzahl zahlt jedes Kind mit Vertrag weniger, auch das erste. Wähle bei `Ab so vielen Kindern` die Kinderzahl, zum Beispiel 2.",
          "Wähle bei `Geschwister zählen an` die Schulen, deren Kinder mitzählen. Lässt du das Feld leer, zählen nur die Schulen der Regel. Bei `Alle Kinder der Familie` zählen die Schulen der Regel immer mit.",
          "`Fester Preis` heißt: Das Kind zahlt genau diesen Betrag. `Betrag weniger` zieht den Betrag vom Preis ab.",
          "`Preis laut Preisliste` heißt: Jedes weitere Kind zahlt je Modul und Tag den Preis unter `Jedes weitere Kind` der Preisliste. Die Zahl trägst du dort ein, nicht in der Regel. Bei `Alle Kinder der Familie` zahlt auch das erste Kind diesen Preis.",
          "Sollen Geschwister an zwei Standorten getrennt zählen, lege je Standort eine eigene Regel an. Lass `Geschwister zählen an` leer.",
          "Sollen auch Geschwister ohne Betreuungsvertrag zählen? Schalte `Geschwister ohne Vertrag mitzählen` ein. Bei `Alle Kinder der Familie` zählt sonst nur, wie viele Kinder einen Vertrag haben.",
        ],
      },
      {
        title: "Kinderzahl der Familie prüfen",
        description:
          "Eltern geben an, wie viele Kinder ihre Familie hat: bei der Anmeldung, über den Link aus der Vertragsmail oder im Vertrag in der Eltern-App. Die Zahl aus der Anmeldung kommt mit dem Vertrag. Du bestätigst die Zahl. Erst dann zählt sie.",
        steps: [
          "Wähle `Familien und Zahlung` und dann den Reiter `Kinderzahl`.",
          "Unter `Zu prüfen` stehen neue Angaben der Eltern und Zahlen, die bald ablaufen.",
          "Wähle bei der Familie `Prüfen`. Im Menü einer Familie heißt es `Kinderzahl bestätigen` oder `Kinderzahl ändern`.",
          "Prüfe die Zahl. Ändere sie, wenn nötig.",
          "Wähle, ab wann die Zahl gilt. Soll sie nur eine Zeit lang gelten, wähle auch `Gilt bis`.",
          "Wähle `Kinderzahl bestätigen`.",
        ],
      },
      {
        title: "Kinderzahl aus einer Datei nachtragen",
        description:
          "Du führst die Kinderzahl schon in einem anderen Programm, zum Beispiel OGS Connect? Dann trägst du viele Zahlen auf einmal aus einer CSV-Datei nach. Jede Zahl gilt als von dir bestätigt. moto bewahrt die Datei nicht auf.",
        steps: [
          "Speichere die Liste als CSV-Datei. Jede Zeile nennt ein Kind mit Vertrag: Vorname, Nachname und die Zahl der Kinder in der Familie.",
          "Wähle `Familien und Zahlung` und den Reiter `Kinderzahl`. Wähle oben rechts das Menü mit den drei Punkten und dann `Aus Datei nachtragen`.",
          "Du kennst den Aufbau noch nicht? Wähle `Beispieldatei`.",
          "Ziehe die Datei in das Feld oder wähle `Datei wählen`.",
          "Prüfe unter `Spalten zuordnen`, aus welcher Spalte jedes Feld kommt. Hat die Datei keine Spalte für die Schule, wähle `Schule für alle Zeilen`.",
          "Wähle bei `Kinderzahl gilt ab` den Tag, ab dem die Zahlen der Datei belegt sind, zum Beispiel den Tag, an dem du die Liste erstellt hast. moto schlägt heute vor.",
          "Nennt deine Datei den Tag je Kind? Ordne die Spalte `Gültig ab` zu. Eine Spalte mit dem Namen `Kinderzahl gilt ab` erkennt moto von selbst. Eine Zeile ohne Tag bekommt den Tag, den du für die ganze Datei gewählt hast.",
          "Prüfe die Zeilen unter `Prüfen und übernehmen`. `Bereit` übernimmt moto. Bei `Fehlerhaft` und `Widerspruch in der Datei` steht der Grund in der Spalte `Hinweis`.",
          "`Andere Zahl bestätigt` heißt: Für die Familie gilt schon eine andere Zahl. moto ändert sie nicht. Ändere sie in der Liste über `Kinderzahl ändern`.",
          "`Verschiedene Angaben` heißt: Für die Familie sind verschiedene Kinderzahlen bestätigt. Bestätige die Kinderzahl in der Familienliste. Die Datei löst diesen Widerspruch nicht.",
          "Ist die bisherige Zahl einer Familie abgelaufen? Oder endet sie vor dem Tag aus deiner Datei? Dann übernimmt moto die Zahl aus der Datei. Sie gilt frühestens ab dem Tag nach dem Ablauf.",
          "Wähle unten `übernehmen`. Die Zahlen stehen danach in der Liste mit dem Stand `Bestätigt`. Beginnt eine Zahl erst später, steht dort bis dahin ein anderer Stand, zum Beispiel `Gilt später` oder `Abgelaufen`.",
        ],
      },
      {
        title: "Nachweis eintragen",
        description:
          "Einkommensstufe und Ermäßigung für Alleinerziehende brauchen einen Nachweis je Kind.",
        steps: [
          "Wähle `Familien und Zahlung` und dann den Reiter `Nachweise`.",
          "Wähle beim Kind das Menü und dann `Einkommensstufe eintragen` oder `Alleinerziehend eintragen`.",
          "Wähle die Stufe. Nenne den geprüften Nachweis, zum Beispiel Einkommensteuerbescheid 2025.",
          "Trage ein, wann du ihn geprüft hast und ab wann er gilt.",
          "Wähle `Nachweis speichern`.",
        ],
      },
      {
        title: "Nachweise ändern und vorab eintragen",
        description:
          "Die Liste zeigt alle Zeiträume, auch abgelaufene und zukünftige.",
        steps: [
          "Wähle beim Kind das Menü. Jeder Nachweis zeigt seinen Zeitraum.",
          "Wähle beim passenden Zeitraum `Einkommensstufe ändern` oder `Alleinerziehend ändern`.",
          "Für einen weiteren Zeitraum wählst du `Einkommensstufe eintragen` oder `Alleinerziehend eintragen`.",
          "Beende den bisherigen Zeitraum, bevor der neue beginnt. Zeiträume derselben Art dürfen sich nicht überschneiden.",
          "Wähle `Nachweis speichern`.",
        ],
      },
      {
        title: "Kinderzahl und Nachweise herunterladen",
        steps: [
          "Wähle `Familien und Zahlung` und dann den Reiter `Kinderzahl` oder `Nachweise`.",
          "Wähle oben rechts das Menü mit den drei Punkten. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`. Die Datei enthält die ganze Liste, ohne Suche.",
          "Die Datei enthält personenbezogene Daten. Jeder Download wird protokolliert.",
        ],
      },
    ],
    result:
      "Der nächste Monatslauf rechnet die Ermäßigungen aus. Jede Rechnung zeigt jede Ermäßigung mit Namen und Betrag. Bei Geschwistern steht dabei, das wievielte Kind es ist, zum Beispiel `2. Kind von 3`. Gilt die Regel für alle Kinder der Familie, steht dort die Kinderzahl, zum Beispiel `2 Kinder in der Familie`.",
    differences: [
      "Geschwister erkennt moto an derselben E-Mail-Adresse der Rechnung. Haben zwei Familien dieselbe Adresse, zählen ihre Kinder zusammen. Hat eine Familie zwei Adressen, zählen ihre Kinder nicht als Geschwister. Gleiche die Adresse dann im Vertrag an.",
      "Gilt ein Nachweis erst ab Mitte des Monats, zählt er für den ganzen Monat.",
      "Zählt eine Regel die Kinderzahl, gilt die bestätigte Zahl. Es zählen aber immer mindestens die Kinder mit Vertrag. Geschwister ohne Vertrag stehen in der Reihe vorn: Bei 3 Kindern und einem Kind mit Vertrag ist es das 3. Kind.",
      "Geschwister zählen je Schule getrennt. Ein Kind mit Vertrag an einer anderen Schule zählt bei der Kinderzahl nur mit, wenn die Regel unter `Geschwister zählen an` auch diese Schule nennt. Geschwister ohne Vertrag zählen an jeder Schule mit.",
      "Eine Angabe der Eltern, die du noch nicht bestätigt hast, zählt nicht. Ist die Zahl abgelaufen, zählen nur die Kinder mit Vertrag. Der Monatslauf nennt diese Kinder dann unter `Kinderzahl der Familie fehlt`.",
      "Ein Vertrag ohne E-Mail-Adresse der Eltern ist eine eigene Familie, zum Beispiel nach einem Import. Die Liste nennt sie nach dem Kind und zeigt `Vertrag Nr.`. Sie bekommt ihre eigene Kinderzahl.",
      "Aus einer Datei gilt die Zahl ab dem Tag, den du beim Nachtragen wählst. moto setzt den Beginn nie von selbst auf den Vertragsbeginn zurück. Für einen Monat zählt die Zahl, die am Ersten gilt. Gilt am Ersten keine, zählt die erste Zahl, die in dem Monat beginnt. Einen anderen Beginn wählst du später über `Kinderzahl ändern`.",
      "Steht bei einer Familie `Verschiedene Angaben`? Die Verträge der Familie nennen verschiedene Zahlen. Bestätige eine Zahl für die Familie. Oder wähle im Menü `Kinderzahl entfernen`. moto fragt vorher nach. Bis dahin zählen nur die Kinder mit Vertrag.",
      "Eine Rechnung, die schon ausgestellt ist, bleibt, wie sie ist. Eine geänderte Regel gilt ab dem nächsten Monatslauf.",
    ],
    notes: [
      "moto speichert nur die Art des Nachweises und das Prüfdatum. Das Dokument und das Einkommen bleiben bei dir.",
      "Jedes Öffnen der Seite `Nachweise` steht im Zugriffsprotokoll.",
      "Bei der Kinderzahl speichert moto nur die Zahl. Namen und Geburtstage der Geschwister ohne Vertrag erfasst moto nicht. Jedes Öffnen und Ändern steht im Zugriffsprotokoll.",
    ],
    related: [HELP_TOPICS.traegerCareMonths, HELP_TOPICS.traegerAccessLog],
  };
}
