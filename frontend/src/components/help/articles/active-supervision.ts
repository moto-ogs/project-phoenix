import type { HelpTopic, HelpPresenceMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function activeSupervisionTopic(
  presenceMode: HelpPresenceMode,
): HelpTopic {
  if (presenceMode === "binary") {
    return {
      id: HELP_TOPICS.activeSupervision,
      title: "Eine Aufsicht starten, führen und beenden",
      question: "Wie arbeite ich mit einer laufenden Aufsicht?",
      summary:
        "Bei einfacher Anwesenheit führt moto keine Aufsichten für einzelne Räume oder Aktivitäten.",
      group: "gruppen",
      audience: ["caregiver", "lead"],
      icon: "Eye",
      steps: [
        "Öffne `Alle Kinder`.",
        "Nutze `An- & Abmelden`, um die Anwesenheit zu erfassen.",
      ],
      result:
        "Der Bereich `Aktuelle Aufsicht` wird nicht angezeigt. moto speichert nur, ob ein Kind anwesend ist.",
      related: [HELP_TOPICS.webAttendance, HELP_TOPICS.rooms],
    };
  }
  if (presenceMode === "unknown") {
    return {
      id: HELP_TOPICS.activeSupervision,
      title: "Eine Aufsicht starten, führen und beenden",
      question: "Wie arbeite ich mit einer laufenden Aufsicht?",
      summary:
        "Der Bereich ist nur sichtbar, wenn deine OGS Räume und Aktivitäten erfasst.",
      group: "gruppen",
      audience: ["caregiver", "lead"],
      icon: "Eye",
      steps: [
        "Prüfe, ob `Aktuelle Aufsicht` in der Seitenleiste steht.",
        "Ist der Bereich vorhanden? Öffne dort einen Raum oder geplanten Termin.",
        "Fehlt der Bereich? Erfasse die Anwesenheit unter `Alle Kinder`.",
      ],
      result: "Diese Aufsicht gibt es nur bei detaillierter Anwesenheit.",
      related: [HELP_TOPICS.rooms, HELP_TOPICS.webAttendance],
    };
  }

  return {
    id: HELP_TOPICS.activeSupervision,
    title: "Eine Aufsicht starten, führen und beenden",
    question: "Wie arbeite ich mit einer laufenden Aufsicht?",
    summary:
      "Übernimm einen Raum oder einen geplanten Termin und halte die Kinderliste aktuell.",
    group: "gruppen",
    audience: ["caregiver", "lead"],
    icon: "Eye",
    steps: [],
    instructionGroups: [
      {
        title: "Eine Aufsicht starten",
        steps: [
          "Öffne `Aktuelle Aufsicht`.",
          "Wähle unter `Als Nächstes` einen geplanten Termin.",
          "Starte ihn, sobald die Schaltfläche freigegeben ist.",
          "Öffne unter `Räume` einen offenen Raum, zum Beispiel den Schulhof.",
          "Wähle `Zur Aufsicht` und dann `Beaufsichtigen`.",
          // Live geprueft: der gruene Streifen steht immer oben auf der
          // Seite, auch ohne geplanten Block und ohne NFC.
          "Oder wähle `Spontane Aktivität starten`, wenn nichts geplant ist.",
          "Prüfe Raum, Aktivität und Betreuungsteam.",
          "Nach dem Start einer spontanen Aktivität öffnet sich `Anwesende Kinder hinzufügen`. Wähle dort die Kinder für die Aktivität aus.",
        ],
      },
      {
        // #3823, ADR 0091: externe Kräfte mit einer von drei Zugangsstufen.
        title: "Weitere Betreuer eintragen",
        steps: [
          "Öffne in der laufenden Aufsicht oben das Menü mit den drei Punkten.",
          "Wähle `Betreuer hinzufügen`.",
          "Wähle die Person unter `Betreuer auswählen` und dann `Hinzufügen`.",
          "Fehlt die Person, zum Beispiel jemand von der Musikschule? Wähle `Externe Person eintragen`.",
          "Trage `Vorname` und `Nachname` ein.",
          "Wähle den `Zugang`: `Kein Zugang`, `Nur ansehen` oder `Eigene Termine betreuen`.",
          "Bei `Nur ansehen` und `Eigene Termine betreuen` trägst du die `E-Mail-Adresse` ein. Die Person bekommt dann eine Einladung.",
          "Wähle `Eintragen`. Du kannst die Person sofort auswählen.",
          "Beim Start einer spontanen Aktivität geht das genauso unter `Weitere Betreuer`.",
          "Wurde eine AG-Leitung hinzugefügt? Sie öffnet die Kinderliste unter `Aktuelle Aufsicht`.",
        ],
      },
      {
        // #4763: ändert nur die laufende Aufsicht, nie die Planung.
        title: "Die Aufsicht übergeben oder abgeben",
        steps: [
          "Wähle in deiner laufenden Aufsicht `Aufsicht übergeben`.",
          "Übernimmt eine andere Person? Wähle `An Person übergeben`, dann die Person unter `An wen übergibst du?` und `Übergeben`.",
          "Bleibt schon jemand anderes als Aufsicht im Raum? Wähle `Aufsicht abgeben` und dann `Abgeben`.",
          "Die Kinder bleiben im Raum und die Aktivität läuft weiter. Die Planung ändert sich nicht.",
        ],
      },
      {
        title: "Die Kinderliste führen",
        steps: [
          "Suche ein Kind in der laufenden Aufsicht.",
          "Wähle `Hinzufügen`, wenn das Kind anwesend ist und zur Aufsicht kommen soll.",
          "Mehrere Kinder auf einmal? Wähle `Anwesende Kinder`. Dort stehen die Kinder, die gerade in der OGS sind und laut Gehzeit noch bleiben. Hake die Kinder an und wähle `Kinder hinzufügen`.",
          // #4571: live geprüft im Dialog `Anwesende Kinder hinzufügen`.
          "Du kennst die Kinder an ihrem Betreuungsangebot, zum Beispiel „bis 16 Uhr“? Wähle `Nach Angebot` und darunter das Angebot. Dann stehen dort nur Kinder, die dieses Angebot heute gebucht haben. Kinder, die heute früher gehen oder abgemeldet sind, fehlen. moto merkt sich das Angebot für das nächste Mal.",
          "Prüfe geplante Abholzeiten und Hinweise in der Liste.",
          "Wechselt ein Kind den Raum oder geht nach Hause? Ändere seinen Aufenthaltsort.",
        ],
      },
      {
        title: "Die Aufsicht beenden",
        steps: [
          "Wähle `Beenden`.",
          "Prüfe im Fenster, ob noch Kinder anwesend sind.",
          "Bestätige das Ende der Aufsicht.",
        ],
      },
    ],
    result:
      "Die Aufsicht ist abgeschlossen. Aus Versehen beendet? Wähle `Rückgängig`. Später öffnest du den Termin unter `Beendete und abgelaufene Blöcke` mit `Wieder öffnen`. Das geht bis zum geplanten Ende, mindestens fünf Minuten lang.",
    differences: [
      "Bei einem laufenden Termin können weitere Betreuungskräfte der Aufsicht beitreten.",
      "Ein geplanter Termin hat feste Zeiten. Vorher sind Start oder Ende möglicherweise gesperrt.",
      "Deine OGS kann erlauben, einen Termin einige Minuten vor dem Ende zu beenden.",
      "Steht am Termin `Nur für Eingeplante`? Dann dürfen hier nur eingeplante Kräfte starten. Deine OGS kann das Starten für das ganze Team freigeben.",
      "Du startest einen Termin, für den du nicht eingeplant bist? Dann wirst du nicht zur Aufsicht. Wer beenden darf, legt deine OGS fest.",
      "Fehlt `Beenden`? Dann dürfen hier nur eingeplante Kräfte beenden. Deine OGS kann das Beenden für das ganze Team freigeben.",
      // #5676: Wieder öffnen bis zum geplanten Ende.
      "Fehlt `Wieder öffnen`? Dann ist das geplante Ende vorbei. Oder jemand anderes hat den Termin beendet. Dann kann nur diese Person oder die Leitung ihn wieder öffnen.",
      // #4372: offene Räume ohne eigene Aufsicht stehen unter `Räume`.
      "Läuft deine Aufsicht in einem offenen Raum? Dann steht der Raum unter `Aktuelle Aufsicht`. Alle anderen offenen Räume findest du unter `Räume`.",
      "Hast du mehrere Aufsichten? Auf dem Handy stehen sie oben auf der Seite `Aufsicht` als Reiter.",
      // #5035: mit dem Überblick über alle Aufsichten stehen auch fremde da.
      "Siehst du auch Aufsichten von anderen? Deine eigene steht zuerst und öffnet sich zuerst. Bei einer fremden steht oben `Nicht deine Aufsicht`.",
      "Welche Räume offen sind, legt deine OGS fest.",
      "`Abgeben` ist gesperrt? Dann bist du die einzige Aufsicht. Übergib die Aufsicht an eine Person oder beende die Aktivität.",
      "Eine externe Person steht danach unter `Personal` in der Gruppe `Extern`, mit jedem Zugang. In Zeiterfassung und Dienstplan erscheint sie nicht.",
      "`Nur ansehen` fehlt? Diesen Zugang darf nur vergeben, wer Personal verwalten darf.",
      "Fehlt `Spontane Aktivität starten`? Dann hat deine OGS in den `Einstellungen` unter `Betrieb` den Schalter `Spontane Aktivitäten erlauben` ausgeschaltet.",
      "Fehlt ein Kind unter `Anwesende Kinder`? Ist seine Gehzeit schon erreicht, steht es nur unter `Alle anwesenden`. Ist es noch nicht angemeldet, suchst du es über `Kind hinzufügen`.",
      "Fehlt `Nach Angebot`? Dann hat deine OGS kein aktives Betreuungsangebot, das als Betreuungstag zählt.",
      // Einstellung „Kinder nur über ‚Alle Kinder‘ finden“ (#1321).
      "Fehlt `Aktuelle Aufsicht` in der Navigation? Öffne `Alle Kinder`. Wähle im Menü mit den drei Punkten `Zur Aufsicht`.",
      // App-Oberfläche unter 40rem (#8070): Kind-Blatt statt Karte.
      "Auf dem Handy öffnet ein Tipp auf ein Kind ein Blatt mit seinen Angaben und Aktionen, zum Beispiel `Raum verlassen`. Die wichtigste Aktion der Seite steht unten über der Leiste.",
    ],
    // Einstellung „Angebote auf der Kinderkarte“ (#6487, #8194), standardmäßig aus.
    notes: [
      "Die Karten können auch die Angebote des Tages zeigen, zum Beispiel „14:00–15:00 Töpfer-AG“. Deine Leitung schaltet das in den Einstellungen bei `Angebote auf der Kinderkarte` ein.",
    ],
    troubleshooting: HELP_TOPICS.attendanceProblem,
    related: [HELP_TOPICS.rooms, HELP_TOPICS.ownGroups],
  };
}
