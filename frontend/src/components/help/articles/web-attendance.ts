import type { HelpTopic, HelpPresenceMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function webAttendanceTopic(presenceMode: HelpPresenceMode): HelpTopic {
  const result =
    presenceMode === "detailed"
      ? "Mit `Anwesend (ohne Raum)` steht das Kind nach dem Anmelden unter `Unterwegs`. Mit einem Raum unter `Anmelden in` ist es sofort in diesem Raum. Nach dem Abmelden steht das Kind unter `Zuhause`, ein Raumbesuch endet dabei."
      : presenceMode === "binary"
        ? "Nach dem Anmelden steht das Kind auf `Anwesend`. Nach dem Abmelden steht es auf `Zuhause`."
        : "moto zeigt nach der Aktion den neuen Anwesenheitsstatus des Kindes.";

  return {
    id: HELP_TOPICS.webAttendance,
    title: "Ein Kind an- oder abmelden",
    question: "Wie melde ich ein Kind an oder ab?",
    summary: "Trage ein, ob ein Kind heute in der OGS ist.",
    group: "kinder",
    audience: "caregiver",
    icon: "ListChecks",
    steps: [],
    instructionGroups: [
      // #6953: das Ziel der Anmeldung gibt es nur bei der Erfassung mit
      // Räumen. Fällt ein Terminal aus, meldet das Team in der App an.
      ...(presenceMode === "binary"
        ? []
        : [
            {
              title: "Kinder direkt in einen Raum anmelden",
              description:
                "So machst du es, wenn ein Terminal ausfällt. Das Kind ist sofort im Raum, wie nach einem Scan am Terminal.",
              steps: [
                "Öffne `Alle Kinder` und wähle `An- & Abmelden`.",
                "Wähle unter `Anmelden in` den Raum oder die Aktivität.",
                "Auf den Karten steht jetzt `In … anmelden` mit dem Namen des Raums.",
                "Tippe die Kinder an. Jedes Kind ist sofort im Raum.",
                "Die Wahl bleibt, bis du sie änderst. Sie gilt auch nach dem Neuladen auf diesem Gerät.",
              ],
            },
          ]),
      {
        title: "Über die Angaben des Kindes",
        steps: [
          "Suche das Kind unter `Alle Kinder`.",
          "Öffne die Karte des Kindes.",
          "Wähle `Anmelden` oder `Abmelden`.",
          "Prüfe den Namen im Fenster.",
          "Bestätige mit `Anmelden`. Beim Abmelden wählst du `Geht nach Hause` oder `Geht zum Unterricht`.",
        ],
      },
      {
        title: "Direkt in der Kinderliste",
        steps: [
          "Öffne `Alle Kinder`.",
          "Wähle `An- & Abmelden`.",
          "Wähle die Karte des Kindes.",
          "Prüfe den neuen Status auf der Karte.",
          "Wähle danach `Fertig`.",
        ],
      },
      {
        // #4762: „Alle N auswählen“ nimmt nur die sichtbaren Karten und
        // lässt Kinder aus, die heute krank, entschuldigt oder nicht
        // erwartet sind.
        title: "Eine ganze Klasse anmelden",
        steps: [
          "Öffne `Alle Kinder`.",
          "Wähle im Filter `Klasse` die Klasse.",
          "Wähle `An- & Abmelden` und danach `Mehrere`.",
          "Tippe auf den Knopf mit `Alle` und der Zahl der Kinder.",
          "Die Zahl nennt die ausgewählten Kinder.",
          "Tippe Kinder an, die nicht da sind. So nimmst du sie wieder heraus.",
          "Wähle `Anmelden`.",
          "Lies den Hinweis `Noch nicht angemeldet`. Er nennt die Kinder, die noch fehlen.",
        ],
      },
    ],
    result,
    notes: [
      "Möchtest du mehrere Kinder ändern? Wähle `Mehrere`.",
      ...(presenceMode === "binary"
        ? []
        : [
            "Unter `Anmelden in` stehen Räume mit laufender Aufsicht, offene Räume und laufende Aktivitäten. Einen Raum ohne Aufsicht kannst du nicht wählen. Die App startet keine Aufsicht.",
            "Mit `Mehrere` und einem Raum meldet `In … anmelden` nur abwesende Kinder in den Raum an. Kinder, die schon da sind, bleiben, wo sie sind.",
            "Soll ein Kind, das schon angemeldet ist, in den Raum? Wähle `Mehrere`, markiere das Kind und wähle `In … holen`. Den Knopf siehst du als Leitung oder wenn du die Aufsicht im Zielraum hast. Sonst holst du das Kind auf der Seite des Raums.",
            "In `Direkt` meldet ein Tipp ein angemeldetes Kind immer ab, auch wenn ein Raum gewählt ist.",
          ]),
      "Der Knopf mit `Alle` lässt kranke und entschuldigte Kinder aus. Das gilt auch für Kinder auf Klassenfahrt oder mit „Kommt heute nicht“. Die Leiste nennt ihre Zahl.",
      "Im Hinweis `Noch nicht angemeldet` zeigt `Nur „Schule“ zeigen` die Kinder, die laut Tagesplan noch in der Schule sind und heute noch nicht da waren.",
      "In der Listenansicht kreuzt du die Kinder links an und wählst oben `Anmelden` oder `Abmelden`.",
      // Live geprueft: in `Direkt` schreibt jeder Tipp sofort, ohne Rueckfrage.
      // Ausnahme seit #3324: frühes Gehen öffnet vorher ein Fenster.
      "In `Direkt` meldet jeder Tipp sofort an oder ab. Auf der Karte steht `Tippen zum Anmelden`.",
      "Geht ein Kind zum Unterricht und kommt danach wieder? Öffne die Kindakte und wähle `Abmelden`. Wähle dann `Geht zum Unterricht`. Das Kind steht danach auf `Im Unterricht`, nicht auf `Zuhause`.",
      "Ein Tipp in `Direkt` und die Abmeldung über `Mehrere` zählen sonst als `Geht nach Hause`. Nur wenn ein Kind in einem Raum ist, fragt moto auch dort nach dem Ziel.",
      "Kommt das Kind zurück, meldest du es ganz normal an. Kommt es heute nicht zurück, steht es am Ende des Betreuungstags wieder auf `Zuhause`.",
      "Geht ein Kind früher als seine Abholzeit, fragt moto nach dem Grund. Der Grund ist freiwillig. Das Fenster bietet auch `Geht zum Unterricht` an.",
      "Den Grund siehst du danach beim Kind unter `Heutige Abholung`. Mit Anwesenheitsprotokoll steht er auch in der `Tagesauswertung` und im Verlauf.",
    ],
    differences: [
      "Fehlt `Anmelden in`? Dann erfasst deine OGS nur „Anwesend oder abwesend“ ohne Räume, oder dir fehlt das Recht, Kinder zu verschieben.",
      "moto zeigt nur die Aktion, die zum aktuellen Status passt.",
      "Fehlt `Anmelden` oder `Abmelden`? Frage deine Leitung nach dem Recht zum An- und Abmelden.",
      "moto fragt nie nach einem Grund? Dann hat deine Schule die Frage ausgeschaltet oder das Kind hat heute keine Abholzeit.",
    ],
    troubleshootingDetails: [
      "Steht unter `Anmelden in` plötzlich `Anwesend (ohne Raum)` und ein Hinweis? Dann läuft im gewählten Raum keine Aufsicht mehr. Wähle ein neues Ziel.",
    ],
    troubleshooting: HELP_TOPICS.attendanceProblem,
    related: [
      HELP_TOPICS.studentSearch,
      HELP_TOPICS.changeLocation,
      HELP_TOPICS.absences,
    ],
  };
}
