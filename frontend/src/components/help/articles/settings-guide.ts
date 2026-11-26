import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Die wichtigsten Einstellungen je Bereich (#3727). Bewusst eine Auswahl, keine
 * vollständige Liste: Die vollständige Liste steht auf `/settings` selbst, mit
 * einem Satz unter jeder Einstellung. Bezeichnungen stammen aus der Registry
 * (`backend/modules/settings/internal/defaults/`) und aus `TAB_LABELS` in
 * `components/settings/settings-filter.ts`. Wer dort umbenennt, ändert hier mit.
 */
export function settingsGuideTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.settingsGuide,
    title: "Die wichtigsten Einstellungen im Überblick",
    question: "Welche Einstellungen gibt es, und was bewirken sie?",
    summary: "Was du in welchem Bereich der Einstellungen festlegst.",
    group: "konfiguration",
    audience: "lead",
    icon: "SlidersHorizontal",
    steps: [],
    instructionGroups: [
      {
        title: "Betrieb",
        description: "Wie dein Team im Alltag arbeitet.",
        ordered: false,
        steps: [
          "`Arbeit mit festen Gruppen`: Ob Kinder festen Gruppen angehören oder alle mit allen Kindern arbeiten.",
          "`Welche Gruppen und Blöcke sieht das Team?`: Was das Team im Überblick sieht. Was das Team bearbeiten darf, ändert das nicht.",
          "`Wo darf das Team Kinder an- und abmelden?`: Nur bei den eigenen Gruppen und Blöcken oder überall.",
          "`Wer darf Kinder krank oder entschuldigt melden?`: Nur OGS-Admins oder das ganze Team.",
          "`Übliche Ankunftszeit` und `Übliche Abholzeit`: Diese Zeiten trägst du im Wochenplan eines Kindes mit einem Klick ein.",
          "`Betreuungsplan nutzen`: Zeigt den Betreuungsplan im Menü.",
          "`Benachrichtigungen senden`: Hinweise in moto und auf dem Handy. Was ankommt, wählt jede Person selbst.",
          "`Team-Chat für Mitarbeitende`: Das Team schreibt sich Nachrichten. Eltern sehen davon nichts.",
          // #7208: Ausschalten beendet auch jede Foto-Einwilligung.
          "`Kinderfotos`: Fotos bei den Kindern. Nur mit Einwilligung der Eltern. Beim Ausschalten löscht moto alle Fotos sofort. Auch alle Foto-Einwilligungen enden. Nach dem Wiedereinschalten braucht jedes Foto eine neue Einwilligung.",
          "`Angebote auf der Kinderkarte`: Die Kinderkarten zeigen die Angebote des Tages mit Uhrzeit. Das gilt für `Gruppen`, `Alle Kinder` und `Aktuelle Aufsicht`.",
          "`Automatisch ausstempeln`: moto wartet nach Dienstende die eingestellte Zeit. Dann stempelt es aus. Das gilt nur bei einem geplanten Dienst.",
          "`Betreuer stempeln nur am NFC-Tablet`: Wer keine Zeiten anderer verwalten darf, stempelt nur noch mit dem eigenen Armband am Tablet. In der App geht das für diese Personen nicht mehr. Die Leitung stempelt weiter in der App und trägt fehlende Zeiten nach, zum Beispiel für `Unterwegs`. Den Schalter gibt es nur mit NFC-Tablets.",
          "`Wegpackzeit beim Ausstempeln (Minuten)`: Diese Minuten zählt moto bei jedem Ausstempeln dazu, etwa für das Aufräumen. Nicht beim Pausenbeginn und nicht beim automatischen Ausstempeln.",
          "`Arbeitszeit runden` und `Wie gerundet wird`: moto rundet die Dauer jedes Arbeitsblocks. Die Reihenfolge: gestempelte Dauer, plus Wegpackzeit, dann runden, dann Pause abziehen. Die gestempelten Uhrzeiten bleiben sichtbar.",
          "Wegpackzeit und Rundung gelten für Arbeitsblöcke, die nach der Änderung enden. Frühere Tage bleiben, wie sie sind.",
        ],
      },
      {
        title: "Elternportal",
        description: "Steht im Bereich `Betrieb` unter `Elternportal`.",
        ordered: false,
        steps: [
          "`Nachrichten von Eltern`: Eltern schreiben dem Team zu ihrem Kind.",
          "`Krankmeldung über Elternportal`: Eltern melden ihr Kind selbst krank.",
          "`Speiseplan`: Eltern sehen, was es diese und nächste Woche zu essen gibt.",
          "Alle Schalter für Eltern erklärt die Anleitung „Festlegen, was Eltern in moto sehen“.",
        ],
      },
      {
        title: "Erinnerungen",
        description: "Erinnerungen rund um Abholung, Aktivitäten und Termine.",
        ordered: false,
        steps: [
          "`Anstehende Abholung`: Erinnert, wenn die Abholzeit eines Kindes näher rückt.",
          "`Überfällige Abholung`: Erinnert, wenn ein Kind nach seiner Abholzeit noch da ist.",
          "`AG dauert länger`: Erinnert, wenn eine gestartete Aktivität nach ihrem Ende noch läuft. Du siehst den Raum und bei wie vielen Kindern die Abholzeit erreicht ist. Bei `Nachlauf in Minuten` legst du fest, wie lange moto wartet. Beendet moto Termine automatisch, wähle dort weniger Minuten als den Puffer.",
          "Die Erinnerung verschwindet, sobald jemand die Aktivität beendet.",
          "`Terminerinnerung für Eltern`: Eltern bekommen vor einem Termin eine E-Mail. Das gilt nur, wenn du beim Anlegen `Eltern per E-Mail benachrichtigen` wählst.",
        ],
      },
      {
        title: "Geräte",
        description: "Nur wenn deine OGS NFC-Tablets nutzt.",
        ordered: false,
        steps: [
          "`Geräte-PIN`: Mit dieser PIN meldet sich dein Team am Tablet an.",
          "`„Nach Hause“ ab Uhrzeit`: Ab dieser Uhrzeit können Kinder am Tablet „Nach Hause“ wählen.",
          "`„Toilette“ am Tablet anbieten`: Kinder können beim Auschecken „Toilette“ wählen. Für „Schulhof“ und „Raumwechsel“ gibt es eigene Schalter.",
        ],
      },
      {
        title: "Module",
        description: "Welche Zusatzmodule deine OGS gebucht hat.",
        ordered: false,
        steps: [
          "`Gebuchte Module`: Zeigt die Zusatzmodule deiner OGS.",
          "Die Schalter sind nur zur Information. Du kannst sie nicht ändern.",
          "Die gebuchten Module stehen im Vertrag mit moto. Wenn du etwas ändern möchtest, wende dich an das moto-Team.",
          "Mehr dazu steht in der Anleitung „Welche Module hat meine Schule?“.",
        ],
      },
      {
        title: "Anmeldung",
        description: "Wie Eltern ihr Kind bei dir anmelden.",
        ordered: false,
        steps: [
          "`Online-Anmeldung`: Eltern melden ihr Kind über ein Formular im Internet an. Einschalten lässt sie sich erst mit einer Datenschutzinformation unter `Rechtstexte`.",
          "`Name der Betreuung in Texten für Eltern`: So heißt deine Betreuung in den festen Texten der Anmeldung, der Eltern-App und in den E-Mails dazu. Auch Fehlermeldungen für Eltern und für dein Team nennen ihn. Wähle `OGS`, `GTS` oder `Eigener Name`. Bei `Eigener Name` wählst du auch den Artikel, der zu deinem Namen passt, zum Beispiel „der Hort“. Deine eigenen Texte im Formular ändern sich nicht.",
          "`Empfänger für neue Anmeldungen`: Diese Adressen bekommen bei jeder neuen Anmeldung eine E-Mail.",
          "`Rechtstexte`: Was Eltern im Formular lesen und bestätigen, zum Beispiel die Datenschutzinformation.",
        ],
      },
      {
        title: "Datenschutz",
        description: "Was moto speichert und wie lange.",
        ordered: false,
        steps: [
          "`Anwesenheitsprotokoll`: Das Team sieht die Anwesenheit und frühere Räume. Ausgeschaltet bleiben frühere Raumbesuche nur für den heutigen Tag. Beim Ausschalten bestätigst du zuerst die endgültige Löschung. Gib dafür `LÖSCHEN` ein. Das gilt auch bei `Zurücksetzen` auf den ausgeschalteten Standard. Abgeschlossene Raumbesuche vor heute werden sofort gelöscht. Das lässt sich nicht rückgängig machen. Erneutes Einschalten stellt nichts wieder her. Heutige Raumbesuche bleiben bis zum nächtlichen Löschen erhalten. Der aktuelle Raum und die Anwesenheitszeiten bleiben erhalten.",
          "Vor dem Einschalten prüft die Schule die Rechtsgrundlage. Sie ist für die Nutzung verantwortlich.",
          "`Nutzungsanalyse`: moto erhält Nutzungsstatistiken deiner Schule, aber keine eingegebenen Inhalte.",
          "Löschfristen wie `Anwesenheit aufbewahren (Tage)`: Wie lange moto Daten behält. Du kannst sie nur lesen.",
          "`Erziehungsberechtigte ohne Kind aufbewahren (Tage)`: Diese Frist stellst du selbst ein. Sie beginnt erst, wenn das letzte Kind der Person gelöscht ist.",
        ],
      },
      {
        title: "Kalender und Export",
        description: "Termine und Zeitkonten außerhalb von moto nutzen.",
        ordered: false,
        steps: [
          "`Kalenderzugang mit App-Passwort erlauben`: Das Team sieht seine Termine in einem Kalenderprogramm.",
          "`Zeitkonten per SFTP übertragen`: Nach der vollständigen Einrichtung kannst du die Zeitkonten im Export-Dialog selbst übertragen. Auch der automatische Versand an das Lohnbüro nutzt diese Gegenstelle, wenn unter `Abrechnung` der `Versandweg` `SFTP` gewählt ist.",
        ],
      },
      {
        title: "Sicherheit",
        description: "Wie gut Konten bei der Anmeldung geschützt sind.",
        ordered: false,
        steps: [
          "`Zwei-Faktor-Anmeldung (Code per E-Mail)`: Beim Anmelden kommt zusätzlich ein Code per E-Mail.",
          "`Fehlversuche bis zur Code-Sperre`: Nach so vielen falschen Bestätigungscodes pausiert die Code-Prüfung.",
          "`Dauer der Code-Sperre (Minuten)`: So lange pausiert danach die Code-Prüfung.",
        ],
      },
      {
        title: "Startseite für alle und Personalisierung",
        ordered: false,
        steps: [
          "`Startseite für alle`: Welche Bereiche alle auf ihrer Startseite sehen.",
          "`Personalisierung`: Ein eigenes Bild für die Login-Seite deiner OGS.",
        ],
      },
    ],
    notes: [
      "Unter jeder Einstellung steht in moto ein Satz, der sagt, was sie bewirkt.",
      "Du suchst eine bestimmte Einstellung? Nutze oben das Feld `Einstellung suchen`. Es sucht in allen Bereichen.",
    ],
    differences: [
      "Welche Bereiche und Einstellungen du siehst, hängt von deinen Rechten und den Funktionen deiner OGS ab.",
      "Manche Einstellungen erscheinen erst, wenn du eine andere einschaltest.",
    ],
    related: [
      HELP_TOPICS.settings,
      HELP_TOPICS.leadParentVisibility,
      HELP_TOPICS.leadNfcSettings,
    ],
  };
}
