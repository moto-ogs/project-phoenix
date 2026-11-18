import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function traegerDatevExportTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerDatevExport,
    title: "DATEV-Werte eintragen",
    question: "Wie bekommt mein Steuerbüro die Beiträge für DATEV?",
    summary:
      "Für jeden ausgestellten Lauf lädst du eine DATEV-Datei herunter. Sie enthält nur Buchungen, die noch in keiner DATEV-Datei waren. Dein Steuerbüro liest sie in DATEV ein. Vorher trägst du einmal die DATEV-Werte deines Steuerbüros ein.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "Settings",
    requirements: [
      "Deine Rolle im Träger-Büro hat das Recht Finanz-Export.",
      "Dein Steuerbüro hat dir die DATEV-Werte genannt.",
      "Bei Monatsbeiträgen hat jede Familie eine Debitorennummer. Bei Ferienbeiträgen steht sie in der Ferienanmeldung. Fehlt sie dort, gilt die Nummer der Familie.",
      "Der Monatslauf oder Ferienlauf ist ausgestellt.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "DATEV-Werte eintragen",
        description:
          "Das machst du nur einmal. Frage dein Steuerbüro nach den Werten.",
        steps: [
          "Wähle `Abrechnung`, dann den Reiter `Exporte`.",
          "Wähle oben rechts das Menü mit den drei Punkten und dann `DATEV-Werte`. Die Einstellungen öffnen sich im Bereich `DATEV`.",
          "Trage `Beraternummer` und `Mandantennummer` ein.",
          "Wähle die `Länge der Sachkonten`, den `Kontenrahmen` und den `Beginn des Wirtschaftsjahres`.",
          "Trage das `Standard-Erlöskonto` ein. Darauf bucht moto alles ohne eigenes Konto.",
        ],
      },
      {
        title: "Erlöskonten und Kostenstellen festlegen",
        description:
          "Nur nötig, wenn dein Steuerbüro Leistungen, Schulen oder Angebote getrennt bucht.",
        steps: [
          "Wähle `Abrechnung`, dann den Reiter `Exporte`.",
          "Wähle oben rechts das Menü mit den drei Punkten und dann `Konten und Kostenstellen`.",
          "Unter `Erlöskonten` wählst du bei `Monatsbeiträge`, `Mensa`, `Ferienbetreuung` oder `Mittagessen in den Ferien` `Ändern`. Trage das Konto ein und wähle `Speichern`. Ein Angebot kann ein eigenes Konto haben.",
          "Ohne eigenes Konto bucht `Mittagessen in den Ferien` auf das Konto der `Ferienbetreuung`. Daneben steht dann `wie Ferienbetreuung`.",
          "Unter `Kostenstellen (KOST1)` steht jede Schule mit zwei Zeilen. Wähle bei `Monatsbeiträge und Mensa` `Neue Kostenstelle`. Wähle den Tag bei `Gilt ab` und trage die `Kostenstelle` ein.",
          "Bucht dein Steuerbüro die Ferienbetreuung einer Schule getrennt? Dann trägst du bei `Ferienbetreuung` dieser Schule eine eigene Kostenstelle ein. Ohne sie bucht eine Ferienwoche auf die Kostenstelle der Schule. Daneben steht dann `wie Monatsbeiträge`.",
          "Eine Ferienwoche bucht auf die Schule, an der sie stattfindet. Hat diese Schule keine Kostenstelle, gilt `Ersatz für die Ferienbetreuung` unter `Alle Schulen`. Daneben steht dann `Ersatz-Kostenstelle`.",
          "Eine `Zweite Kostenstelle (KOST2)` je Angebot trägst du nur ein, wenn dein Steuerbüro sie braucht.",
        ],
      },
      {
        title: "Neue Buchungen herunterladen",
        description:
          "Die Spalte `DATEV-Datei` zeigt, wie viele neue Buchungen ein Lauf hat.",
        steps: [
          "Wähle `Abrechnung`, dann den Reiter `Exporte`.",
          "Wähle beim Lauf das Menü mit den drei Punkten und unter `Herunterladen` `DATEV-Datei`. Die Datei wird heruntergeladen. Sie enthält nur die neuen Buchungen.",
          "Gib die Datei an dein Steuerbüro.",
        ],
      },
      {
        title: "Alle Buchungen erneut herunterladen",
        description:
          "Nur wenn dein Steuerbüro eine frühere Datei nicht hat oder nicht einlesen konnte.",
        steps: [
          "Wähle beim Lauf das Menü mit den drei Punkten.",
          "Wähle `Alle Buchungen erneut`.",
          "Lies den Hinweis. Hat der Lauf Buchungen in mehreren Wirtschaftsjahren, wähle das `Wirtschaftsjahr`.",
          "Wähle `Erneut herunterladen`.",
        ],
      },
    ],
    result:
      "In der Datei steht jede Rechnung im Soll, jedes Storno und jede Gutschrift im Haben. Die Datei steht im `Exportprotokoll` mit ihrer Nummer. Eine Datei mit allen Buchungen steht dort als `Alle erneut: Wiederholung`. In jeder Rechnung zeigt `Verlauf`, in welcher Datei sie war.",
    notes: [
      "Bei Monatsbeiträgen trägst du die Debitorennummer bei `Empfänger und Zahlung` der Familie ein. Bei Ferienbeiträgen gilt die Nummer der Ferienanmeldung. Hat die Anmeldung keine, gilt die Nummer der Familie. DATEV nimmt nur Ziffern an, eine mehr als bei den Sachkonten. Bei 4 Stellen ist das zum Beispiel `10001`.",
      "Jede Buchung kommt nur einmal in eine DATEV-Datei. Stornierst du später eine Rechnung, steht das Storno in der nächsten Datei des Laufs. Die Rechnung selbst steht dort nicht noch einmal.",
      "Eine DATEV-Datei gilt für ein Wirtschaftsjahr. Liegt ein Storno im neuen Jahr, kommt es in eine eigene Datei. Lade dafür noch einmal die `DATEV-Datei` herunter.",
      "Hat ein Lauf keine neuen Buchungen, fehlt `DATEV-Datei` im Menü des Laufs. Dann entsteht keine Datei und keine Nummer.",
      "Die DATEV-Datei und die Sollstellung zählen in derselben Reihe von Dateinummern.",
      "Eine Rechnung über 0 € steht nicht in der DATEV-Datei. Sie bewegt kein Geld.",
      "Eine Rechnung hält Erlöskonto und Kostenstellen beim Ausstellen fest. Änderst du später ein Konto, gilt das nur für neue Rechnungen. Ein Storno bucht auf dieselben Konten wie seine Rechnung.",
      "Hat eine Rechnung Positionen auf verschiedenen Konten, steht sie mit einer Zeile je Konto in der DATEV-Datei. Ermäßigungen verteilen sich anteilig auf diese Zeilen.",
      "Eine Kostenstelle gilt ab ihrem Tag bis zur nächsten. Maßgeblich ist der erste Tag der Leistung, also der Monat oder die Ferienwoche.",
    ],
    differences: [
      "Über der Liste steht `Die DATEV-Datei fehlt noch`? Es fehlen DATEV-Werte. Der Hinweis nennt sie. Bis dahin fehlt `DATEV-Datei` im Menü des Laufs.",
      "Beim Lauf steht `Alles exportiert`? Alle Buchungen sind schon in einer DATEV-Datei. Darunter steht ihre Nummer.",
      "Du kannst die DATEV-Werte nur ansehen? Ändern darf, wer im Träger-Büro das Recht für die Einstellungen hat.",
      "Im `Exportprotokoll` steht `… mit Ersatz-Kostenstelle`? Diese Ferienwochen fanden an einer Schule ohne Kostenstelle statt. Die Datei bucht sie auf den `Ersatz für die Ferienbetreuung`. Darunter stehen Rechnung, Woche und Grund. Trage für die Schule eine Kostenstelle ein. Das gilt für neue Rechnungen.",
      "Im `Exportprotokoll` steht `… mit Konten vom Exporttag`? Diese Rechnungen wurden ausgestellt, bevor moto die Konten festgehalten hat. Die Datei nutzt dann die Werte vom Tag des Exports.",
    ],
    troubleshootingDetails: [
      "Es erscheint `Keine DATEV-Datei für …` mit ungültigen Debitorennummern? Eine ausgestellte Rechnung behält ihre Debitorennummer. Bei Monatsbeiträgen trägst du bei der Familie die richtige Nummer ein. Storniere dann die genannte Rechnung und stelle sie neu aus. Bei Ferienbeiträgen ohne Gutschrift stornierst du zuerst die Rechnung. Korrigiere die Debitorennummer in der Ferienanmeldung. Stelle dann die Rechnung neu aus. Waren Rechnung und Storno in keiner DATEV-Datei, heben sie sich auf. Danach lässt sich `DATEV` für den Lauf wieder wählen. Die neue Rechnung kommt mit ihrem Lauf in DATEV.",
      "Hat eine Ferienrechnung mit ungültiger Debitorennummer schon eine Gutschrift? Dann ist kein Storno möglich. Lade die Sollstellung des Laufs für dein Steuerbüro herunter. Es kann die Buchungen daraus manuell in DATEV erfassen. Der DATEV-Download dieses Laufs bleibt gesperrt.",
      "Es erscheint `Keine neuen Buchungen für …`? Jemand hat die Buchungen gerade heruntergeladen. Die Datei steht im `Exportprotokoll`.",
      "Der Hinweis nennt einen Wert, der `passt nicht`? Prüfe ihn mit deinem Steuerbüro. Das Erlöskonto darf höchstens so viele Ziffern haben wie deine Sachkonten.",
      "Es erscheint `Erlöskonto ist länger als deine Sachkonten` oder `Kostenstelle fehlt`? Schon festgehaltene Konten und Kostenstellen bleiben unverändert. Auch ein Storno übernimmt diese Werte. Lade dann die Sollstellung dieses Laufs herunter. Gib die Datei und den Hinweis an dein Steuerbüro. Es kann die genannten Werte berichtigen und manuell in DATEV buchen. Der DATEV-Download dieses Laufs bleibt dann gesperrt. Korrigiere unter `Konten und Kostenstellen` die Werte für neue Rechnungen.",
      "Ist in den DATEV-Werten `Kostenstelle ist Pflicht` an? Dann braucht jede Schule eine Kostenstelle. Sonst gibt es keine DATEV-Datei.",
    ],
    related: [
      HELP_TOPICS.traegerFinanceExports,
      HELP_TOPICS.traegerBillingTerms,
      HELP_TOPICS.traegerCareMonths,
    ],
  };
}
