import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Der Formular-Editor unter `/enrollment-form`. Zwei Dinge sind hier
 * folgenreich und stehen deshalb gross im Artikel:
 *
 * 1. Das `Basisformular` existiert immer und ist ein Systemformular. Die
 *    Seite raet selbst davon ab, ohne Not eine Vorlage anzulegen. Wer das
 *    nicht weiss, baut eine ueberfluessige Vorlage.
 * 2. `Stammdaten-Vorschläge` schreiben die Antwort in die Daten des Kindes
 *    (TargetSuggestions, form-template-builder-sections.tsx), eine
 *    `Freie Zusatzfrage` bleibt bei der Anmeldung. Gleiche Frage, anderes
 *    Ergebnis -- und im Formular sehen beide gleich aus.
 *
 * Die Vorlage wirkt erst, wenn eine Anmeldephase sie auswaehlt: dort im
 * Abschnitt `Formular` die Option `Eigene Vorlage wählen`
 * (phases-editor.tsx:1565).
 */
export function enrollmentFormTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadEnrollmentForm,
    title: "Ein eigenes Anmeldeformular anlegen",
    question: "Wie frage ich bei der Anmeldung mehr ab?",
    summary:
      "Nur nötig, wenn das Basisformular nicht reicht. Du legst dann eine Vorlage an.",
    group: "anmeldeverwaltung",
    audience: "lead",
    icon: "FileText",
    requirements: ["Du hast das `Basisformular` angesehen und etwas vermisst."],
    image: "/help/screens/anmeldung-pdf-anhaenge.webp",
    imageAlt:
      "Zwei PDF-Anhänge mit eigenen Bezeichnungen und Aktionen im Formular-Editor",
    steps: [],
    instructionGroups: [
      {
        title: "Erst prüfen, ob du eine Vorlage brauchst",
        description:
          "Das `Basisformular` ist immer da und fragt Elternteil, Kind, Klassenstufe und das gewünschte Betreuungsangebot ab. Für die meisten OGS reicht das.",
        steps: [
          "Klappe in der Seitenleiste `Eltern` auf.",
          "Öffne `Anmeldungen` und danach `Anmeldeformulare`.",
          "Wähle beim `Basisformular` die `Vorschau`.",
          "Fehlt nichts? Dann bist du fertig. Lege keine Vorlage an.",
        ],
      },
      {
        title: "Eine Vorlage anlegen",
        description:
          "Eine Vorlage ergänzt das Basisformular. Sie ersetzt es nicht.",
        steps: [
          "Wähle oben rechts `+ Neue Vorlage`.",
          "Trage bei `Name der Vorlage` ein, wofür sie gilt, zum Beispiel `Ferienbetreuung Sommer 2026`.",
          "Gehe `Pflichtstatus der Basisfelder` durch. Was auf `Optional` steht, kannst du zur Pflicht machen.",
          "Ergänze unter `Was Eltern zusätzlich beantworten sollen` deine Fragen.",
          "Sieh rechts in der Vorschau nach, wie das Formular wirkt.",
          "Wähle unten `Formularvorlage erstellen`.",
        ],
      },
      {
        title: "Die richtige Sorte Frage wählen",
        description:
          "Zwei Sorten sehen im Formular gleich aus, landen aber woanders. Das ist die wichtigste Entscheidung in diesem Fenster.",
        steps: [
          "Soll die Antwort später beim Kind stehen? Nimm einen `Stammdaten-Vorschlag` und wähle `Hinzufügen`.",
          "Zur Auswahl stehen unter anderem `Abholzeiten`, `Ankunftszeiten`, `Erlaubte Heimwege` und `Gesundheitsinformationen`.",
          "Geht es nur um diese eine Anmeldung? Wähle `+ Freie Zusatzfrage`.",
          "Frage etwas zum Kind, zum Beispiel zum Schwimmen? Schalte bei der Frage `Pro Kind abfragen` ein. Dann beantworten Eltern sie für jedes Kind.",
          "Für Allergien und andere Gesundheitsangaben nimm den Stammdaten-Vorschlag `Gesundheitsinformationen`, keine freie Zusatzfrage. Nur dort fragt das Formular die nötige Einwilligung der Eltern ab.",
          "Willst du nur etwas erklären, ohne zu fragen? Wähle `Infotext`.",
        ],
      },
      {
        title: "Eltern Dateien hochladen lassen",
        description:
          "Mit dem Typ `Datei` laden Eltern im Formular Nachweise hoch, zum Beispiel einen Steuerbescheid.",
        steps: [
          "Wähle `+ Freie Zusatzfrage` und schreibe die Frage.",
          "Stelle bei `Typ` die Option `Datei` ein.",
          "Wähle bei `Erlaubte Dateiarten` aus `PDF`, `JPG` und `PNG`.",
          "Wähle bei `Maximale Größe pro Datei` eine Größe von 1 bis 10 MB.",
          "Sollen Eltern mehrere Dateien schicken? Wähle `Mehrere Dateien erlauben`. Dann sind bis zu 5 Dateien möglich.",
        ],
      },
      {
        title: "Die Einkommenserklärung hinzufügen",
        description:
          "Die Vorlage fragt die Einkommensstufe ab und verlangt einen Nachweis, wenn nicht der volle Beitrag gilt.",
        steps: [
          "Wähle `+ Einkommenserklärung`.",
          "moto fügt zwei Fragen hinzu: `Einkommensstufe` und `Einkommensnachweis`.",
          "Passe bei `Einkommensstufe` die `Auswahloptionen` an deine Beitragsstufen an.",
          "Der `Einkommensnachweis` erscheint nur, wenn Eltern nicht `Voller Beitrag` wählen.",
        ],
      },
      {
        title: "PDF-Dateien zu einem Hinweis hinzufügen",
        steps: [
          "Wähle `Infotext` und schreibe deinen Hinweis.",
          "Wähle beim Hinweis `PDFs hinzufügen`. Du kannst mehrere Dateien gleichzeitig auswählen.",
          "Gib jeder Datei unter `Bezeichnung für Eltern` einen verständlichen Namen.",
          "Füge weitere Dateien mit `Weitere PDFs hinzufügen` hinzu.",
          "Zum Austauschen wähle bei der jeweiligen PDF `Ersetzen`.",
          "Zum Wegnehmen wähle das Kreuz bei der jeweiligen PDF.",
          "Wähle `Änderungen speichern` und danach `Vorschau öffnen`.",
        ],
      },
      {
        title: "Eltern unterschreiben lassen",
        description:
          "Die Eltern unterschreiben am Ende des Formulars mit dem Finger, dem Stift oder der Maus. Das Verfahren heißt einfache elektronische Signatur mit gezeichneter Unterschrift.",
        steps: [
          "Öffne deine Vorlage.",
          "Schalte im Abschnitt `Unterschrift` den Schalter `Unterschrift erforderlich` ein.",
          "Wähle `Änderungen speichern`.",
        ],
      },
      {
        title: "Die Vorlage in der Anmeldephase auswählen",
        description:
          "Eine Vorlage wirkt erst, wenn eine Phase sie benutzt. Ohne diesen Schritt sehen die Eltern weiter das Basisformular.",
        steps: [
          "Öffne `Anmeldephasen`.",
          "Öffne die Phase zum Bearbeiten.",
          "Wähle im Abschnitt `Formular` die Option `Eigene Vorlage wählen`.",
          "Wähle deine Vorlage aus der Liste.",
          "Speichere die Phase.",
        ],
      },
      {
        title: "Eigene Texte für Eltern übersetzen",
        description:
          "Eltern wählen im Formular oben ihre Sprache. moto übersetzt nur die festen Texte. Deine eigenen Fragen und Zustimmungen übersetzt du selbst.",
        steps: [
          "Öffne deine Vorlage und gehe nach unten zu `Übersetzungen für Eltern`.",
          "Wähle die Sprache, zum Beispiel `Russisch`.",
          "Links steht dein deutscher Text. Trage rechts bei `Übersetzung` den Text in der Sprache ein.",
          "Wähle unten `Änderungen speichern`.",
          "Denselben Abschnitt findest du beim Bearbeiten einer Anmeldephase und eines Betreuungsangebots.",
        ],
      },
    ],
    result:
      "Eltern füllen in dieser Phase das Basisformular und deine zusätzlichen Fragen aus.",
    notes: [
      "Fragt dein Träger nach dem Ferienwunsch, schalte bei `Ferienwunsch (Kind)` den Schalter `Ferienwunsch abfragen` ein. Eltern wählen dann für jedes Kind Ja oder Nein.",
      "Eine Vorlage gilt für alle Phasen, die sie auswählen. Du brauchst nicht für jede Phase eine eigene.",
      "Mit `Vorschau öffnen` siehst du den Entwurf in einem neuen Tab, bevor du speicherst.",
      "Die Vorschau zeigt nur deine Fragen, keine Betreuungsangebote. Unter `Angebote prüfen` öffnest du die Vorschau jeder Phase, die die Vorlage nutzt. Dort stehen die Angebote, auch wenn die Phase noch nicht aktiv ist.",
      "Haben deine Betreuungsangebote eine Gehzeit, brauchst du keine Frage nach `Abholzeiten`. Eine Antwort darauf ersetzt die Gehzeit des Angebots beim Kind.",
      "Die Zustimmungen `Datenschutzinformation`, `Fotoeinwilligung` und `E-Mail-Kontakt` tragen `Aus Einstellungen übernommen`. Sie kommen aus deinen Einstellungen und lassen sich pro Vorlage ausblenden.",
      "Über `+ Eigene Zustimmung hinzufügen` ergänzt du einen Text, der nur in dieser Vorlage steht.",
      "Die `Datenschutzinformation` hat kein Häkchen. Eltern sehen den Text und können ihn öffnen. moto speichert bei jeder Anmeldung, welche Fassung das Formular gezeigt hat.",
      "Für Fotos im Internet schaltest du bei der Zustimmung `Einvernehmen aller Sorgeberechtigten abfragen` ein. Mit dem Häkchen bestätigen Eltern dann auch, dass alle anderen Sorgeberechtigten einverstanden sind.",
      "Fragst du `Gesundheitsinformationen` ab, zeigt das Formular dazu eine Einwilligung für Gesundheitsangaben. Eltern müssen nichts eintragen. Tragen sie etwas ein, setzen sie dafür das Häkchen. Deshalb lässt sich `Pflichtfrage` bei diesem Feld nicht einschalten.",

      "Jede PDF-Datei darf höchstens 10 MB groß sein.",
      "Eltern können alle Dateien ohne Elternkonto öffnen und herunterladen.",
      "Infotexte und Blöcke mit `Nur Hinweis` brauchen keine Zustimmung.",
      "Auch bei Zustimmungen kannst du mehrere PDF-Dateien hinzufügen.",
      "Beim Verwerfen werden neue, ungespeicherte Dateien entfernt. Frühere Formularfassungen behalten ihre Dateien.",
      "Eine Frage vom Typ `Datei` gilt immer für die ganze Anmeldung, nicht pro Kind.",
      "Mit `Unterschrift erforderlich` können Eltern die Anmeldung erst nach der Unterschrift absenden. Ändern sie die Anmeldung später, unterschreiben sie neu.",
      "Statt zu zeichnen können Eltern ihren Namen tippen. Das steht im Nachweis als `Name getippt`.",
      "Hochgeladene Nachweise öffnet nur, wer das Recht `Nachweise aus Anmeldungen ansehen` hat. Die Leitung hat es immer.",
      "Nachweise werden nach einer festen Frist gelöscht. Die Frist legt das moto-Team fest.",
    ],
    differences: [
      "Bei einem `Stammdaten-Vorschlag` kannst du Beschriftung und Typ nicht ändern. Beides ist fest, damit die Antwort beim Kind ankommt.",
      "Manche Basisfelder stehen auf `Immer Pflicht` und lassen sich nicht abschalten, zum Beispiel `E-Mail (Elternteil)`.",
      "Steht bei einer Zustimmung `Ist für diese Vorlage ausgeblendet`, fragt dieses Formular sie nicht ab.",
    ],
    troubleshootingDetails: [
      "Die Eltern sehen deine Fragen nicht? Dann steht die Phase noch auf `Basisformular`. Wähle dort `Eigene Vorlage wählen`.",
      "In der Phase steht `Noch keine eigenen Formulare vorhanden`? Dann ist die Vorlage noch nicht gespeichert.",
      "Eine Antwort taucht beim Kind nicht auf? Dann war es eine `Freie Zusatzfrage`. Nur `Stammdaten-Vorschläge` schreiben in die Daten des Kindes.",
      "Eltern lesen einen Text auf Deutsch, obwohl du ihn übersetzt hast? Dann hast du den deutschen Text danach geändert. Bei der Übersetzung steht `Bitte prüfen`. Passe sie an oder wähle `Passt noch`, und speichere.",
      "Fehlt `Anmeldungen` in der Seitenleiste? Der Bereich ist der Leitung vorbehalten.",
    ],
    related: [
      HELP_TOPICS.leadEnrollmentSetup,
      HELP_TOPICS.enrollments,
      HELP_TOPICS.leadManageStudent,
    ],
  };
}
