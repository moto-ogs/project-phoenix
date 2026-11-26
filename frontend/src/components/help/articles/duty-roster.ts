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
      "Klappe in der Seitenleiste `Planung` auf.",
      "Öffne `Dienstplan`.",
      "Wähle oben `Woche`, `Person` oder `Halbjahr`.",
      "Blättere zur gewünschten Woche.",
      "Wähle in der Zeile einer Person den passenden Tag.",
      "Trage die Schicht ein und speichere sie.",
    ],
    result:
      "Die Person sieht ihre Schichten unter `Mein Kalender`. Dort tragen sie die Farbe `Schicht`.",
    notes: [
      "Jede Schicht kann eine Dienstart tragen. Die Farbe kommt von der Dienstart.",
      "Über `Dienstarten verwalten` pflegst du die Arten.",
      // #6845: eine genutzte Dienstart wird archiviert statt gelöscht.
      "Löschst du eine Dienstart, die geplante Dienste tragen, behalten diese Dienste sie. Sie verschwindet nur aus der Auswahl für neue Dienste.",
      // ADR 0116: die ausgerichtete Ferienwoche im Dienstplan.
      "Richtet deine OGS eine Ferienwoche für den Träger aus, steht im Kopf jedes Tages `Ferienbetreuung`. Darunter stehen die Zahl der Kinder und die Betreuungszeit. Plane dafür Schichten. In der Ansicht `Halbjahr` zeigt eine Sonne die Woche.",
      "Unter dem Plan steht `Stunden der Woche`. Dort siehst du pro Person die Stunden pro Dienstart und das Soll.",
      "Unter `Person` siehst du die Woche einer Person in Viertelstunden. Darunter stehen die Stunden pro Tag und Dienstart.",
      "Ziehe dort über die Viertelstunden, um eine Schicht anzulegen.",
      "Wähle im Drei-Punkte-Menü `Drucken oder exportieren`. Wähle Vorlage, Fassung und Zeitraum. `Drucken` öffnet die Druckansicht. Für eine Datei wähle das Format und `Herunterladen`.",
      "Die Vorlage `Stundenübersicht` druckt diese Stunden als Liste.",
      "Eine Serie lässt Ferien, Schließtage und Feiertage aus. Arbeitet die Person auch in den Ferien, setze bei der Serie das Häkchen `Auch in den Ferien und an Schließtagen planen`.",
      "An Feiertagen plant eine Serie nie eine Schicht.",
      // #4709: der Vertretungspool des Trägers.
      "Fehlt jemand, findest du im Drei-Punkte-Menü `Springer des Trägers`. Dort blockst du eine Fachkraft deines Trägers für einen Tag.",
    ],
    differences: [
      "Eine neue Schicht auf einem Schließtag löst eine Rückfrage aus.",
      // #4708: die Arbeitszeitregeln des Trägers über alle Einsatzorte.
      "Arbeitet die Person auch an einer anderen Schule deines Trägers, zählt moto beide Schulen zusammen. Verletzt eine Schicht eine Arbeitszeitregel, fragt moto nach. Du änderst die Zeiten oder wählst `Trotzdem planen`, wo nötig mit einer `Begründung`.",
      "Eine Schicht zur selben Zeit an einer anderen Schule speichert moto nicht.",
      "Eine Schicht mit `Vom Träger geplant` hat die Personalverwaltung deines Trägers eingetragen.",
      // #7021: Abwesenheiten von vor #6847 übernimmt die Leitung selbst.
      "Steht über dem Plan `Abwesenheiten fehlen im Plan`? Diese Abwesenheiten gelten schon, die Personen stehen aber noch im Plan. Wähle `In den Plan übernehmen` oder `Alle übernehmen`. Abgesagte Schichten und Vertretungen bleiben, wie sie sind. Soll die Person doch arbeiten, wähle `Ausblenden`.",
      "Ist ein Tag nicht vollständig durch Schichten abgedeckt, weist moto darauf hin.",
    ],
    troubleshootingDetails: [
      "Fehlt eine Person im Plan? Dann ist sie noch nicht als Personal angelegt.",
      // #7306: die eigenen Seiten brauchen ein Personalprofil der Schule.
      "Fehlen dir selbst `Mein Dienstplan`, `Mein Kalender` und `Zeiterfassung`? Diese Seiten zeigen deine eigenen Zeiten und Termine. Dafür brauchst du in dieser Schule ein eigenes Personalprofil. Über den Träger fehlen diese Seiten deshalb.",
      // #7351: Planen braucht ein Personalprofil oder den Weg über den Träger.
      "Steht über dem Plan `Du kannst den Dienstplan nur ansehen`? Zum Planen brauchst du in dieser Schule ein eigenes Personalprofil. Die Leitung kann es anlegen. Über den Träger planst du auch ohne Profil. `Krank melden` und das Übernehmen von Abwesenheiten fehlen dann aber.",
    ],
    related: [
      HELP_TOPICS.leadWorkTimeReview,
      HELP_TOPICS.leadCarePlan,
      HELP_TOPICS.leadInviteStaff,
      HELP_TOPICS.leadStaffPool,
    ],
  };
}
