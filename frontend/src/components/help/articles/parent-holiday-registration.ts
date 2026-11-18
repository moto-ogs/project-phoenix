import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/ferienanmeldung/<link>` (#4661): der Link eines Trägers, ohne Konto, oder
 * die Karte `Ferienbetreuung` auf der Startseite der Eltern-App (#6671).
 * Die Frage nach dem Elternkonto, die zweite E-Mail und der Stand unter
 * `Ferienanmeldungen` (#6673). Der Stand über den Link der E-Mail, ohne
 * Konto (#6676). Anschrift, zweite Person und Kontakte aus dem Elternkonto
 * (#6682).
 */
export function parentHolidayRegistrationTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentHolidayRegistration,
    title: "Für die Ferienbetreuung anmelden",
    question: "Wie melde ich mein Kind für die Ferien an?",
    summary:
      "Du startest in der Eltern-App oder mit dem Link vom Träger. Du meldest bis zu drei Kinder an.",
    image: "/help/screens/ferienanmeldung-zweite-person.webp",
    imageAlt: "Die freiwillige Karte für die zweite sorgeberechtigte Person.",
    group: "anmeldung",
    audience: "parent",
    icon: "SunHorizon",
    requirements: [
      "Du hast die Eltern-App oder den Link zur Ferienanmeldung vom Träger.",
    ],
    steps: [
      "Öffne die Eltern-App. Auf der Startseite steht `Ferienbetreuung`. Wähle `Jetzt anmelden`.",
      "Ohne Eltern-App öffnest du den Link vom Träger.",
      "Trage unter `Kinder` Vorname, Nachname und Geburtsdatum ein.",
      "Wähle die `Schule` deines Kindes. Steht sie nicht in der Liste? Wähle `Eine andere Schule`.",
      "Wähle unter `Wochen` für jede Woche, wie lange dein Kind bleibt. Bei jeder Zeit steht der Preis pro Woche. Gibt es eine Woche an mehreren Schulen, wähle auch die Schule.",
      "Steht bei der Zeit „je Tag“? Dann wähle darunter die Tage, an denen dein Kind kommt. Der Preis gilt je Tag.",
      "Steht unter der Woche `Mit Mittagessen`? Setze den Haken, wenn dein Kind dort essen soll. Darunter steht, was das Essen kostet.",
      "Weitere Kinder fügst du mit `Geschwisterkind hinzufügen` hinzu.",
      "Trage `Deine Angaben` ein.",
      "Fragt der Träger die `Anschrift` ab, trage Straße, PLZ und Ort ein. Die Anschrift steht auf der Rechnung.",
      "Du kannst eine `Zweite sorgeberechtigte Person` angeben. Dann sind Vorname und Nachname nötig. E-Mail und Telefon sind freiwillig.",
      "Trage unter `Kontakte` jede weitere Person einmal ein. Wähle `Notfallkontakt`, `Darf die Kinder abholen` oder beides. Mindestens ein Notfallkontakt mit Telefon ist nötig.",
      "Setze die Haken unter `Einverständnis`. Dazu gehört das Sorgerecht: Du bist allein sorgeberechtigt, oder die andere sorgeberechtigte Person ist einverstanden.",
      "Trage unter `Deine Erklärung` deinen Vor- und Nachnamen ein. Damit gibst du die Erklärungen ab.",
      "Wähle `Weiter zur Zusammenfassung`.",
      "Prüfe alles. Unter `Beitrag` steht, was die Ferienbetreuung kostet.",
      "Bekommst du Leistungen wie Bürgergeld, Wohngeld oder Kinderzuschlag? Dann setze den Haken unter `Beitrag`, wenn er angeboten wird.",
      "Du kannst den Nachweis gleich darunter hochladen. Wähle bei `Nachweis über die Leistungen` den Knopf `Datei auswählen`. Erlaubt sind PDF, JPG und PNG.",
      "Ohne Eltern-App steht über dem Knopf die Frage `Möchtest du ein Elternkonto anlegen?`. Wähle `Ja` oder `Nein`.",
      "Wähle dann `Anmeldung absenden`.",
    ],
    result:
      "Du bekommst eine E-Mail: Die Anmeldung ist eingegangen. Das ist noch keine Zusage. Der Träger schreibt dir, ob dein Kind einen Platz bekommt. In der E-Mail steht auch `Deine Erklärung` mit dem genauen Text. Hebe die E-Mail auf. Mit `Stand ansehen` in der E-Mail siehst du jederzeit, wie weit deine Anmeldung ist. In der Eltern-App siehst du den Stand unter `Ferienanmeldungen`.",
    notes: [
      "Achtet der Träger auf den Ferienwunsch aus der OGS-Anmeldung, steht das über den Kindern. Mit Elternkonto siehst du beim Kind, was in der OGS-Anmeldung steht.",
      "Ein Elternkonto brauchst du nicht. Mit Konto siehst du in der Eltern-App den Stand der Anmeldung, die Bestätigung und die Rechnung.",
      "Hast du bei `Möchtest du ein Elternkonto anlegen?` `Ja` gewählt? Dann bekommst du eine zweite E-Mail. Öffne den Link darin. Lege zweimal dein Passwort fest und wähle `Konto anlegen`. Danach wählst du `Anmelden`.",
      "Hast du schon ein Elternkonto? Dann steht nach dem Link `Du hast schon ein Elternkonto`. Wähle `Anmelden`. Dein Passwort bleibt gleich.",
      "Unter `Ferienanmeldungen` steht jede Anmeldung mit ihrem Stand: `Eingegangen`, `Bestätigt` oder `Storniert`. Bei jedem Kind siehst du die Wochen mit `Platz reserviert`, `Warteliste` oder `Platz offen`. Auf der Startseite steht dazu die Karte `Deine Ferienanmeldungen`.",
      "Den Stand siehst du auch ohne Elternkonto. Wähle nach dem Absenden oder in der E-Mail `Stand ansehen`. Die Seite zeigt `Eingegangen`, `Bestätigt` oder `Storniert` und bei jedem Kind die Wochen mit ihrem Platz. Ändern kannst du dort nichts. Gib den Link nicht weiter.",
      "Ist die Anmeldung bestätigt, findest du die Bestätigung und die Rechnung unter `Dokumente`.",
      "Vergibt der Träger die Plätze nach festen Regeln? Dann steht im Formular `Fragen für die Platzvergabe`. Beantworte jede Frage mit Ja oder Nein. Das Büro kann nach einem Nachweis fragen. Nach dem Absenden steht bei jeder Woche `Platz offen`. Das Büro vergibt die Plätze. Du bekommst eine E-Mail.",
      "Nach dem Absenden siehst du bei jeder Woche `Platz` oder `Warteliste`. Ist eine Woche voll, steht dein Kind dort auf der Warteliste. Wird ein Platz frei, bekommt dein Kind ihn automatisch. Du bekommst dann eine E-Mail. Bei einer verbindlichen Anmeldung ist auch dieser Platz verbindlich.",
      "Liest du die Anmeldung in einer anderen Sprache? Dann steht unter jeder Erklärung eine Übersetzung. Es gilt der deutsche Text.",
      "Gesundheitsangaben sehen der Träger und die OGS, die dein Kind in der Ferienwoche betreut. Nur wenn du zustimmst.",
      "Die OGS, die dein Kind in einer Ferienwoche betreut, sieht Name und Telefon der zweiten sorgeberechtigten Person. Sie sieht auch die Antworten, die der Träger für sie freigibt. Zum Beispiel, ob dein Kind allein nach Hause gehen darf.",
      "Die OGS sieht diese Angaben schon vor der Ferienwoche. So kann sie sich vorbereiten. Die Liste der Kinder sieht sie bis zum letzten Tag der Woche. Name, Telefon und Antworten kann sie danach höchstens 7 Tage lesen. Dann werden sie gelöscht. Gesundheitsangaben sieht sie nur bis zum letzten Tag der Woche.",
      "Ein Kind von einer anderen Schule kommt als Feriengast.",
      "Manche Ferien haben eine Grenze, zum Beispiel höchstens 5 Tage je Kind. Dann steht sie über den Wochen. Eine ganze Woche zählt mit allen Tagen von Montag bis Freitag. Meldest du dein Kind ein zweites Mal an, zählen die Tage beider Anmeldungen zusammen.",
      "Ein Feiertag oder Schließtag ist bei den Tagen durchgestrichen. An diesem Tag ist keine Betreuung, du kannst ihn nicht wählen.",
      "Steht unter den Tagen `Schon voll`? An diesen Tagen sind alle Plätze vergeben. Wählst du einen davon, kommt dein Kind für diese Woche auf die Warteliste.",
      "Mit `Mit Mittagessen` isst dein Kind an jedem gebuchten Tag der Woche. Einzelne Essen abwählen geht nicht. Das Essen steht unter `Beitrag` als eigener Betrag. Ermäßigung und Befreiung gelten nur für die Betreuung, nicht für das Essen.",
      "Der Preis bei den Wochen gilt ohne Ermäßigung oder Befreiung. Geschwister und Leistungsbezug rechnet moto erst unter `Beitrag` ein.",
      "Der Beitrag gilt erst, wenn der Träger die Anmeldung bestätigt. Bei Leistungsbezug braucht der Träger einen Nachweis.",
      "Der Nachweis ist freiwillig. Du kannst ihn auch später beim Träger abgeben.",
    ],
    differences: [
      "Fragt das Formular `Hat dein Kind Allergien oder Unverträglichkeiten?`? Dann braucht der Träger die Angaben zu Allergien und Medikamenten. Wähle bei jeder Frage `Nein, keine` oder `Ja`. Bei `Ja` schreibe auf, was dein Kind hat. Weitere Hinweise bleiben freiwillig.",
      "Steht in der Eltern-App `Anmeldung ab` mit einem Datum? Dann beginnt die Anmeldung an diesem Tag. Ab dann siehst du den Knopf `Jetzt anmelden`.",
      "Du hast den Link geöffnet und bist nicht angemeldet? Oben steht `Du hast schon die Eltern-App?`. Wähle `Anmelden`. Danach kommst du zurück zum Formular.",
      "Ist die Anmeldung verbindlich, heißt der Knopf `Verbindlich anmelden`.",
      "Bist du mit deinem Elternkonto in moto angemeldet? Dann steht unter `Kinder` der Abschnitt `Deine Kinder aus dem Elternkonto`. Setze den Haken bei deinem Kind. Name, Geburtsdatum und Schule stehen dann schon im Formular, deine Angaben und deine Anschrift auch.",
      "Mit dem Haken trägt moto auch die `Zweite sorgeberechtigte Person` und die `Kontakte` ein. Die Angaben kommen von der Schule. Unter jedem Feld, das moto so ausfüllt, steht `Aus dem Elternkonto`. Änderst du das Feld, verschwindet der Satz.",
      "Kennt die Schule keine Telefonnummer einer Person, trage sie selbst ein.",
      "Gesundheitsangaben übernimmt moto nicht. Trage sie bei jedem Kind selbst ein.",
      "Du kannst alle Angaben vor dem Absenden ändern. Das gilt nur für die Ferienanmeldung. Bei der Schule ändert sich nichts.",
      "Mit Elternkonto fragt moto am Ende nicht nach einem Konto. Die Anmeldung steht sofort unter `Ferienanmeldungen`. Nach dem Absenden führt `Zu deinen Ferienanmeldungen` dorthin.",
    ],
    troubleshootingDetails: [
      "Du siehst in der Eltern-App keine `Ferienbetreuung`? Dann läuft gerade keine Anmeldung für die Schule deines Kindes. Oder die Frist ist vorbei. Hast du einen Link vom Träger, nutze den Link.",
      "moto meldet zu viele Tage je Kind? Die Grenze gilt für alle Anmeldungen des Kindes zusammen. Bitte wähle weniger Tage oder frage das Träger-Büro. Der Hinweis zeigt keine Tage aus anderen Anmeldungen.",
      "moto sagt, die Anmeldung sei nicht offen? Oben auf der Seite stehen die Tage, an denen du anmelden kannst.",
      "moto sagt, den Anmeldelink gebe es nicht? Frage den Träger nach dem richtigen Link.",
      "Steht vor dem Absenden `Die Sicherheitsprüfung lädt nicht`? Oft blockiert ein Werbeblocker die Prüfung. Schalte ihn für die Seite aus und wähle `Prüfung neu starten`. Hilft das nicht, wähle `Link kopieren` und öffne den Link in einem anderen Browser, zum Beispiel Chrome.",
      "Steht nach `Stand ansehen` `Wir finden diese Anmeldung nicht`? Öffne den Link noch einmal aus der E-Mail. Nach den Ferien löscht der Träger die Anmeldung. Dann gilt auch der Link nicht mehr.",
      "Der Link zum Elternkonto gilt nicht mehr? Er gilt 30 Tage. Hast du schon ein Konto, melde dich an. Sonst frag den Träger nach einem neuen Link.",
      "Du siehst eine Anmeldung nicht unter `Ferienanmeldungen`? Dort stehen Anmeldungen mit der E-Mail-Adresse deines Kontos. Hast du eine andere Adresse eingetragen, frage den Träger.",
    ],
    related: [HELP_TOPICS.parentEnroll],
  };
}
