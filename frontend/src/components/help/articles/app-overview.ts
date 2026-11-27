import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function appOverviewTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.appOverview,
    title: "Sich in moto zurechtfinden",
    question: "Wie ist moto aufgebaut?",
    summary:
      "Über die Navigation öffnest du die Bereiche, die du für deinen Arbeitstag brauchst.",
    group: "einstieg",
    audience: ["caregiver", "lead"],
    icon: "ListChecks",
    steps: [],
    instructionGroups: [
      {
        title: "Am Computer",
        steps: [
          "Nutze die Seitenleiste links, um einen Bereich zu öffnen.",
          "Wähle einen Eintrag mit Pfeil, um die zugehörigen Bereiche ein- oder auszublenden.",
          "Öffne oben rechts dein Profil, um deine Angaben anzusehen oder sich abzumelden.",
        ],
      },
      {
        // Beschreibt den Zweck jeder Gruppe, nicht ihre Eintraege. Welche
        // Seiten in einer Gruppe stehen, haengt von Rolle und Einstellungen
        // ab -- eine Aufzaehlung waere in der Haelfte der OGS falsch.
        // Quelle der Ordnung: STAFF_NAV_GROUPS in lib/staff-navigation.ts.
        title: "Wie die Seitenleiste geordnet ist",
        description:
          "Ganz oben steht die `Startseite`. Darunter bündeln Gruppen, was zusammengehört.",
        ordered: false,
        steps: [
          // #8134: der Betreuungsplan steht hier, direkt unter `Heute`.
          "`Tagesbetrieb`: alles für den laufenden Betreuungstag. Hier steht auch der `Betreuungsplan`, wenn deine OGS ihn nutzt. Diese Gruppe ist schon aufgeklappt.",
          "`Eltern`: was du mit den Familien austauschst.",
          "`Team`: Dein Dienstplan, dein Kalender, deine Arbeitszeit, deine Kolleginnen und Kollegen und die gemeinsamen Dateien. Wer nicht plant, findet diese Gruppe beim ersten Besuch schon aufgeklappt.",
          "`Planung`: was die Leitung zum Planen braucht, etwa der Dienstplan. Wer plant, findet diese Gruppe beim ersten Besuch schon aufgeklappt.",
          "`Verwaltung`: Stammdaten, Auswertungen und die Lohnabrechnung.",
          "In jeder Gruppe steht oben, was im Alltag am häufigsten gebraucht wird.",
          "Du siehst nur Gruppen, in denen etwas für dich dabei ist.",
          "Ganz unten stehen `Notfall` und `Hilfe`. Wer die OGS verwaltet, findet dort auch `Einstellungen`.",
        ],
      },
      {
        // Einstellung „Einfache Seitenleiste für die Betreuung“ (#6956);
        // Liste: STAFF_NAV_SIMPLE_ENTRIES in lib/staff-navigation.ts.
        title: "Die einfache Seitenleiste",
        description:
          "Deine OGS kann für die Betreuung eine einfache Seitenleiste einschalten. Dann stehen dort nur die Seiten für den Betreuungsalltag, ohne Überschriften zum Aufklappen.",
        ordered: false,
        steps: [
          "Du suchst eine Seite, die nicht dabei ist? Wähle ganz unten `Alle Seiten anzeigen`. Auf dem Handy steht der Knopf unter `Mehr`.",
          "Mit `Weniger Seiten anzeigen` kommst du zur einfachen Seitenleiste zurück.",
          "moto merkt sich deine Wahl auf diesem Gerät.",
          "Wer die OGS leitet, sieht immer alle Seiten. Die Leitung schaltet die einfache Seitenleiste unter `Einstellungen` › `Betrieb` ein.",
        ],
      },
      {
        title: "Auf dem Handy oder Tablet",
        steps: [
          "Nutze die Leiste unten, um häufige Bereiche zu öffnen.",
          "Wähle `Mehr`, um die übrigen Bereiche zu sehen.",
          "Dort stehen dieselben Gruppen wie in der Seitenleiste. Tippe auf eine Gruppe, um sie auf- oder zuzuklappen.",
          "Öffne oben rechts dein Profil, um deine Angaben anzusehen oder sich abzumelden.",
        ],
      },
      {
        // Baustein „Heute anders" (#7659), components/home/day-changes-block.tsx.
        title: "Was heute anders ist",
        description:
          "Weit oben auf der `Startseite` steht die Karte `Heute anders`. Sie zeigt, wer heute fehlt und wer vertritt. Sie zeigt auch Dienste, Angebote und AGs, die heute anders sind oder ausfallen. Dazu kommen die Hinweise der Leitung für heute.",
        ordered: false,
        steps: [
          "Unter `Betrifft dich` steht, was dich selbst angeht: deine Gruppen, Vertretungen, Termine und Dienste.",
          "Dort steht auch, ob du heute fehlst oder dein Dienst anders ist oder ausfällt.",
          "Unter `Schule` steht der Rest der Schule.",
          // Kinder in „Heute anders" (#7665): einzeln in den eigenen Gruppen,
          // sonst eine aufklappbare Zeile pro Gruppe oder Klasse.
          "Bei den Kindern steht, wer krank gemeldet oder entschuldigt ist, wer zu einer anderen Zeit geht, wer allein nach Hause geht und wer einen Hinweis zum Abholen hat.",
          "Die Kinder deiner Gruppen stehen einzeln da. Für die übrige Schule gibt es eine Zeile pro Gruppe, etwa `Gruppe Igel` mit `4 krank, 1 geht allein`. Tippe auf den Namen der Gruppe, um die Kinder zu sehen.",
          // Klassen in „Heute anders" (#7681): Ausflug aus dem Betreuungsplan,
          // Unterrichtsschluss aus dem Stundenplan; nie Namen oder Gründe.
          "Ist eine Klasse heute auf Ausflug oder endet ihr Unterricht zu einer anderen Zeit, steht das auch dort. Beispiel: `Bei Klasse 2c endet der Unterricht heute um 11:30 Uhr.`",
          "Bist du einer Klasse zugeordnet oder ist ein Kind deiner Gruppe auf dem Ausflug, steht die Klasse unter `Betrifft dich`.",
          // Darstellung über den Tag (#7660). Die Zeilen mit Uhrzeit und das
          // eingeklappte „erledigt“ beschreibt erst die erste Quelle mit
          // Uhrzeit (Termine, #7662/#7663), vorher gibt es sie nicht.
          "Neue Änderungen stehen oben. Längere Änderungen stehen kurz darunter, zum Beispiel mit `seit 3.11.`.",
          // Quelle Stundenplan (#7662): Uhrzeit und Raum.
          "Bei Angeboten und AGs stehen Uhrzeit und Raum unter dem Satz. Sie stehen nach Beginn geordnet.",
          // Abwesenheit und Vertretung bei einem Termin (#7675): Quelle
          // Personal, Link in den Vertretungsplan mit schedules:manage.
          "Auch wer nur bei einem Termin fehlt oder vertritt, steht mit Uhrzeit da. Beispiel: `Sara übernimmt heute „Chor“ für Ben.`",
          "Darfst du den `Vertretungsplan` öffnen, führt dich der Eintrag zu diesem Termin.",
          "`Schule` zeigt die ersten 5 Einträge, am Handy die ersten 3. Den Rest zeigt `weitere anzeigen`.",
          // Termine aus dem eigenen Kalender (#7663), api/day_changes_appointments.go.
          "Unter `Betrifft dich` stehen auch deine Termine aus `Mein Kalender`. Du siehst dort, welcher Termin heute ausfällt. Du siehst auch, welcher Termin heute woanders oder zu einer anderen Zeit ist.",
          "Dienste, Termine, Angebote und AGs, die schon vorbei sind, stehen ganz unten unter `erledigt`. Wähle `erledigt`, um sie zu sehen.",
          // Hinweise der Leitung in „Heute anders" (#7667), components/home/day-notice-row.tsx.
          "Einen Hinweis der Leitung, den du noch bestätigen sollst, siehst du ganz oben. Wähle `Zur Kenntnis nehmen`. Danach steht er unter `Schule`.",
          // Speiseplan in „Heute anders" (#7666): nur die Kurzinfo, ohne Gerichte.
          "Steht dort `Der Speiseplan für heute wurde geändert.`, gibt es heute etwas anderes zu essen. Was es gibt, steht auf der Seite `Speiseplan`.",
          // Gesperrte Räume in „Heute anders" (#8161), api/day_changes_room_closures.go.
          "Ist ein Raum heute gesperrt, steht er unter `Schule` mit dem Grund. Termine dort bleiben, bis die Leitung sie in einen anderen Raum verlegt.",
          "Tippe auf einen Eintrag, um die passende Seite zu öffnen.",
          "Steht dort `Heute läuft alles wie geplant.`, gibt es heute nichts Besonderes.",
          "Die Karte zeigt nie, warum jemand fehlt.",
          "Ändert sich etwas, zeigt die Karte es ohne Neuladen.",
          // Krank und Urlaub des Teams stehen seit #7668 nur noch hier, nicht
          // mehr in „Personal heute“ (components/home/staff-today-block.tsx).
          "Die Leitung sieht in `Personal heute`, wie viele in Aufsicht und eingestempelt sind. Wer krank oder im Urlaub ist, steht in `Heute anders`.",
        ],
      },
      {
        // Baustein „Betreuungsplan heute" (#8134), components/home/day-flow-block.tsx.
        // Die Karte gibt es nur mit Betreuungsplan; der Artikel kennt den
        // Schulschalter nicht, deshalb sagt der Text die Bedingung selbst.
        title: "Der Betreuungsplan von heute",
        description:
          "Nutzt deine OGS den Betreuungsplan? Dann zeigt die Karte `Betreuungsplan heute`, was in der ganzen OGS heute noch ansteht. Wer die OGS leitet, hat sie ganz oben auf der Startseite.",
        ordered: false,
        steps: [
          "Die Karte beginnt bei dem, was gerade läuft oder als Nächstes kommt. Die grüne Linie `Jetzt` zeigt die Uhrzeit.",
          "Jede Zeile zeigt Beginn und Ende, den Raum, die Kinder und das Team.",
          "Rechts steht, was gerade zählt: `Läuft`, `Nicht gestartet` oder `Fällt aus`. Beginnt ein Block in der nächsten Stunde, steht dort die Zeit bis zum Beginn.",
          "Tippe auf eine Zeile. Sie öffnet den Termin im `Betreuungsplan`. Hast du den Plan nicht in der Seitenleiste, öffnet sich `Heute`.",
          "Links neben `Jetzt` steht, wie viele Blöcke heute schon vorbei sind. Tippe darauf, um den ganzen Tag zu sehen.",
          "Passen nicht alle Blöcke auf die Karte? Darunter steht, wie viele noch kommen.",
          "Fällt ein Block aus, steht er immer auf der Karte, auch wenn nicht alle Blöcke Platz haben. Das gilt auch für deine eigenen Blöcke.",
          "Sind alle Blöcke vorbei, steht dort `Für heute ist nichts mehr geplant`. Die Karte nennt dann, was ausgefallen ist und was nicht gestartet wurde. `Plan öffnen` zeigt dir den ganzen Tag.",
          "Die Karte fehlt bei dir? Wähle `Anpassen`, dann `Bausteine` und dann `Betreuungsplan heute`.",
          // Karte nur mit Betreuungsplan, Leserecht und schulweiter Sicht
          // (#2380); sonst zeigt „Mein Tag“ die eigenen Einsätze.
          "Steht sie dort nicht? Dann nutzt deine OGS den Betreuungsplan nicht, oder du siehst nur deine eigenen Einsätze. Die zeigt die Karte `Mein Tag`.",
        ],
      },
      {
        // Labels aus home/page.tsx (Knopf „Anpassen", „Fertig") und
        // home-board.tsx („Bausteine", „Standardansicht wiederherstellen").
        title: "Die Startseite anpassen",
        description:
          "Die `Startseite` besteht aus Karten. Welche dort stehen, legst du selbst fest.",
        steps: [
          "Wähle auf der `Startseite` oben rechts das Symbol `Anpassen`.",
          "Wähle `Bausteine` und dann eine Karte, zum Beispiel `Kinder`.",
          "Die Karte steht jetzt unten. Am Computer ziehst du sie an ihren Platz.",
          "Wähle `Fertig`.",
        ],
      },
      {
        title: "Hilfe öffnen",
        steps: [
          "Siehst du oben rechts ein Fragezeichen? Es öffnet die passende Anleitung.",
          "Am Handy oder Tablet steht es rechts neben dem Seitennamen. Es steht vor den Knöpfen der Seite.",
          "Oder wähle `Hilfe`: am Computer unten in der Seitenleiste, auf dem Handy unter `Mehr`.",
        ],
      },
    ],
    result:
      "Du weißt, wo du die wichtigsten Bereiche und die passende Hilfe findest.",
    differences: [
      "Welche Bereiche du siehst, hängt von deiner Rolle und den Einstellungen deiner OGS ab.",
      // Menü mit einem Eintrag am Handy (#7799, OverflowMenu): die
      // Anleitungen nennen weiter „das Menü mit den drei Punkten“.
      "Eine Anleitung nennt das Menü mit den drei Punkten, aber am Handy steht dort ein Knopf wie `Einladen`? Hat das Menü nur einen Eintrag, zeigt moto am Handy gleich diesen Knopf. Tippe direkt darauf.",
      "Du siehst keine Überschriften wie `Tagesbetrieb` oder `Team`? Dann hat deine OGS die einfache Seitenleiste eingeschaltet. Alle Seiten zeigt `Alle Seiten anzeigen` ganz unten.",
      "Unter `Bausteine` fehlt eine Karte? Dann steht sie schon auf deiner Startseite. Oder deine Rolle oder deine OGS sieht sie nicht vor.",
      // Sichtregel von „Heute anders" (#7659): Namen nur für die eigenen
      // Gruppen, für die übrige Schule nur die Zahl; die Leitung sieht alle.
      // Der Baustein „Hinweise der Leitung“ ist seit #7668 weg; Pflicht und
      // Abschaltung der Schule gelten per Migration für „Heute anders“.
      "Die Karte `Hinweise der Leitung` fehlt auf der Startseite? Ihre Hinweise stehen jetzt in `Heute anders`. Alle Hinweise, auch für andere Tage, findest du weiter in der Seitenleiste unter `Hinweise der Leitung`.",
      // Kinder nur mit users:read, wie auf der Seite eines Kindes (#7665).
      "In `Heute anders` fehlen die Kinder und Klassen? Du siehst sie nur, wenn du auch die Krankmeldungen auf der Seite eines Kindes sehen darfst.",
      "In `Heute anders` stehen bei dir nur Zahlen statt Namen? Namen siehst du für deine eigenen Gruppen. Für den Rest der Schule zeigt die Karte nur, wie viele fehlen. Die Leitung sieht alle Namen.",
      // Termin-Vertretungen in „Heute anders" (#7675): Namen für eigene
      // Termine und das eigene Team, sonst nur die Zeile ohne Namen.
      "In `Heute anders` steht bei Terminen nur `ändert sich heute, wer betreut`? Namen siehst du bei deinen Terminen und deinen Gruppen. Für die übrigen Termine zeigt die Karte nur, wie viele es sind. Die Leitung sieht alle Namen.",
      // Dienste in „Heute anders" (#7661): die Betreuung sieht nur den
      // eigenen, wer den Dienstplan der Schule öffnen darf, sieht alle.
      "Du siehst in `Heute anders` nur deinen eigenen Dienst? Geänderte Dienste der anderen sieht nur, wer den `Dienstplan` der Schule öffnen darf.",
      // Sichtregel der Quelle Stundenplan (#7662): wie im Tagesplan.
      "In `Heute anders` fehlen Angebote anderer Leute? Die Karte zeigt die Termine, die du auch im Tagesplan siehst. Je nach Einstellung deiner Schule sind das nur deine eigenen.",
      // Link zum Speiseplan nur mit Leserecht des Speiseplans (#7666).
      "Du kannst `Der Speiseplan für heute wurde geändert.` nicht antippen? Dann darfst du den Speiseplan nicht öffnen. Frag in der Küche oder bei der Leitung, was es gibt.",
      // Kopfzeile aus BrandTraegerLine (#4656): nur bei einem Träger mit
      // mehreren Schulen, und nur am Computer, wo auch der Schulname steht.
      "Steht am Computer oben links unter dem Namen deiner Schule `Träger:` und ein Name? Das ist der Träger deiner Schule. Die Zeile gibt es nur, wenn dein Träger mehrere Schulen hat.",
    ],
    troubleshootingDetails: [
      "Das Anpassen der Startseite lädt nicht? Deine Karten bleiben lesbar. Wähle bei der Fehlermeldung `Wiederholen`.",
      "In `Heute anders` steht, dass etwas gerade nicht geladen werden konnte? Dann fehlt dieser Teil gerade. Lade die Seite später neu.",
    ],
    notes: [
      "Die Karte `Kinder` zählt die Kinder nach `Anwesend`, `Schule`, `Im Unterricht`, `Zuhause`, `Krank` und `Entschuldigt`. Ein Klick auf eine Zahl öffnet `Alle Kinder` mit diesem Filter. `Entschuldigt` zeigt auch Kinder auf Klassenfahrt. `Zuhause` zeigt auch Kinder, die heute nicht kommen. Ein Kind, das da ist, zählt immer bei `Anwesend`, auch mit Krankmeldung. Ein Kind, das zum Unterricht abgemeldet ist, zählt bei `Im Unterricht`, auch mit Krankmeldung.",
      "Zu viel verändert? Wähle in `Anpassen` den Knopf `Standardansicht wiederherstellen`.",
    ],
    related: [
      HELP_TOPICS.login,
      HELP_TOPICS.mySchedule,
      HELP_TOPICS.studentSearch,
    ],
  };
}
