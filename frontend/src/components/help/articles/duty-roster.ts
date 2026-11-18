import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/dienstplan`. Ansichten `Woche`, `Person` und `Halbjahr`, Schichten je Person. */
export function dutyRosterTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadDutyRoster,
    title: "Einen Dienstplan erstellen",
    question: "Wie plane ich die Schichten des Teams?",
    summary: "Der Dienstplan zeigt, wer wann arbeitet.",
    group: "planung",
    audience: "lead",
    icon: "Clock3",
    steps: [
      "Klappen Sie in der Seitenleiste `Planung` auf.",
      "Öffnen Sie `Dienstplan`.",
      "Wählen Sie oben `Woche`, `Person` oder `Halbjahr`.",
      "Blättern Sie zur gewünschten Woche.",
      "Wählen Sie in der Zeile einer Person den passenden Tag.",
      "Tragen Sie die Schicht ein und speichern Sie sie.",
    ],
    result:
      "Die Person sieht ihre Schichten unter `Mein Kalender`. Dort tragen sie die Farbe `Schicht`.",
    notes: [
      "Jede Schicht kann eine Dienstart tragen. Die Farbe kommt von der Dienstart.",
      "Über `Dienstarten verwalten` pflegen Sie die Arten.",
      // #6845: eine genutzte Dienstart wird archiviert statt gelöscht.
      "Löschen Sie eine Dienstart, die geplante Dienste tragen, behalten diese Dienste sie. Sie verschwindet nur aus der Auswahl für neue Dienste.",
      // ADR 0116: die ausgerichtete Ferienwoche im Dienstplan.
      "Richtet Ihre OGS eine Ferienwoche für den Träger aus, steht im Kopf jedes Tages `Ferienbetreuung`. Darunter stehen die Zahl der Kinder und die Betreuungszeit. Planen Sie dafür Schichten. In der Ansicht `Halbjahr` zeigt eine Sonne die Woche.",
      "Unter dem Plan steht `Stunden der Woche`. Dort sehen Sie je Person die Stunden je Dienstart und das Soll.",
      "Unter `Person` sehen Sie die Woche einer Person in Viertelstunden. Darunter stehen die Stunden je Tag und Dienstart.",
      "Ziehen Sie dort über die Viertelstunden, um eine Schicht anzulegen.",
      "Wählen Sie im Drei-Punkte-Menü `Drucken oder exportieren`. Wählen Sie Vorlage, Fassung und Zeitraum. `Drucken` öffnet die Druckansicht. Für eine Datei wählen Sie das Format und `Herunterladen`.",
      "Die Vorlage `Stundenübersicht` druckt diese Stunden als Liste.",
      "Eine Serie lässt Ferien, Schließtage und Feiertage aus. Arbeitet die Person auch in den Ferien, setzen Sie bei der Serie das Häkchen `Auch in den Ferien und an Schließtagen planen`.",
      "An Feiertagen plant eine Serie nie eine Schicht.",
      // #4709: der Vertretungspool des Trägers.
      "Fehlt jemand, finden Sie im Drei-Punkte-Menü `Springer des Trägers`. Dort blocken Sie eine Fachkraft Ihres Trägers für einen Tag.",
    ],
    differences: [
      "Eine neue Schicht auf einem Schließtag löst eine Rückfrage aus.",
      // #4708: die Arbeitszeitregeln des Trägers über alle Einsatzorte.
      "Arbeitet die Person auch an einer anderen Schule Ihres Trägers, zählt moto beide Schulen zusammen. Verletzt eine Schicht eine Arbeitszeitregel, fragt moto nach. Sie ändern die Zeiten oder wählen `Trotzdem planen`, wo nötig mit einer `Begründung`.",
      "Eine Schicht zur selben Zeit an einer anderen Schule speichert moto nicht.",
      "Eine Schicht mit `Vom Träger geplant` hat die Personalverwaltung Ihres Trägers eingetragen.",
      // #7021: Abwesenheiten von vor #6847 übernimmt die Leitung selbst.
      "Steht über dem Plan `Abwesenheiten fehlen im Plan`? Diese Abwesenheiten gelten schon, die Personen stehen aber noch im Plan. Wählen Sie `In den Plan übernehmen` oder `Alle übernehmen`. Abgesagte Schichten und Vertretungen bleiben, wie sie sind. Soll die Person doch arbeiten, wählen Sie `Ausblenden`.",
      "Ist ein Tag nicht vollständig durch Schichten abgedeckt, weist moto darauf hin.",
    ],
    troubleshootingDetails: [
      "Fehlt eine Person im Plan? Dann ist sie noch nicht als Personal angelegt.",
      // #7306: die eigenen Seiten brauchen ein Personalprofil der Schule.
      "Fehlen Ihnen selbst `Mein Dienstplan`, `Mein Kalender` und `Zeiterfassung`? Diese Seiten zeigen Ihre eigenen Zeiten und Termine. Dafür brauchen Sie in dieser Schule ein eigenes Personalprofil. Über den Träger fehlen diese Seiten deshalb.",
    ],
    related: [
      HELP_TOPICS.leadWorkTimeReview,
      HELP_TOPICS.leadCarePlan,
      HELP_TOPICS.leadInviteStaff,
      HELP_TOPICS.leadStaffPool,
    ],
  };
}
