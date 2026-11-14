---
status: accepted
---

# Schulsuche findet Notizkarten mit der Zielgruppe der Kinderakte

Entscheidung vom 2026-11-14 für
[#7012](https://github.com/moto-ogs/project-phoenix/issues/7012). Sie
erweitert [ADR 0231](0231-schulsuche-ist-eine-leseprojektion-ueber-personen-raeume-und-gruppen.md)
um die beiden Punkte, die dort offen blieben. Sie fügt People Directory die
öffentliche Lesefähigkeit `StudentNoteSearch` hinzu, aber keine Tabelle, keine
Spalte, keinen Index, keine Lesegrant der Projektion und keine Policy-Regel.

## Kontext

„Überall suchen“ fand Kinder über Namen, Klasse, Gruppe, Elternnotiz und
Anmeldeantwort, nicht über den Reiter „Notizen“. Dort steht, was das Team über
ein Kind festhält („beim Ausflug Heimweh“, „Gespräch mit der Mutter“). Wer
sich an einen Vorfall erinnert, aber nicht an das Kind, fand es nicht.

Jede Notiz hat eine Zielgruppe: alle, die das Kind lesen dürfen
(`all_staff`), das Betreuungsteam des Kindes (`care_team`: eigene OGS-Gruppe,
eigene Klasse oder eigenes Angebot des Kindes heute) oder die Leitung der
genannten Gruppe (`group_leads`). Die eigene Notiz sieht ihr Autor immer, die
Verwaltung alle. Ob jemand zum Betreuungsteam gehört, hängt am Kind und an
Daten dreier anderer Owner.

In „Alle Kinder“ waren nur Ja/Nein- und Auswahlfragen der Anmeldung
filterbar. Text-, Zahl- und Datumsfragen fand nur die Suche, höchstens acht
Kinder und ohne Export.

## Entscheidung

1. **Notizen sind durchsuchbar, mit genau der Regel der Kinderakte.**
   People Directory sucht in `users.student_notes` über
   `StudentNoteSearch.SearchStudentNotes` in einer Anweisung. Sie wendet die
   Teile der Zielgruppe an, die für jedes Kind gleich sind (`all_staff`,
   eigene Notizen, Leitungsnotizen der geleiteten Gruppen, Verwaltung), und
   lässt `care_team`-Notizen fremder Autoren mit `CareTeamOnly` durch. Sie
   liefert je Kind die neueste passende Notiz; eine Notiz, die ohne
   Betreuungsteam erreichbar ist, geht vor.
   - Den Leser bestimmt der Port `NoteAudience` der Projektion. Die Root
     bindet ihn wie `NewParentGuardianPolicy` an die kanonische Regel:
     Security Runtimes `ResolveStudentNoteAudience`, aus denselben Fakten wie
     die Notizrouten (eigene und vertretene Gruppen, geleitete Gruppen,
     Angebote, Klassen aus `CallerRows`). Für jede `CareTeamOnly`-Notiz fragt
     die Projektion dieselbe Regel mit Gruppe und Klasse des Kindes und seinen
     Angeboten von heute. Die Angebote aller dieser Kinder kommen in einer
     Lesung von Timetable & Activities (`ActivityEnrollments`, über dieselbe
     Lesung `GetActiveStudentEnrollmentsByStudentIDs` wie bei den
     Notizrouten).
   - Ein Kind außerhalb des Betreuungsteams bleibt Treffer, wenn seine
     Anmeldeantwort passt, sonst ist es keiner.
   - Notizen brauchen denselben Scope wie Elternnotizen und Anmeldeantworten
     (`ChildDetails`: `users:read` und ein Personaleintrag der Schule, oder
     Admin), wie die Notizrouten selbst.
   - Die Projektion liest die Tabelle nicht selbst. Eine Lesegrant auf
     `users.student_notes` hätte die Zielgruppe ein zweites Mal in SQL der
     Projektion verlangt; die Regel bliebe nur bei People Directory und
     Security Runtime richtig.
2. **Ein Notiztreffer zeigt einen Auszug.** Wie Elternnotiz und lange
   Anmeldeantwort: höchstens 120 Zeichen um den Treffer. Der Leser darf die
   Notiz ohnehin lesen; „Notiz passt“ ohne Text zwänge ihn, jede Akte zu
   öffnen. Der Treffer öffnet den Reiter „Notizen“ des Kindes. Die Notiz
   erscheint nach den direkten Treffern und vor den Anmeldeantworten.
3. **Der Suchtext bleibt aus dem Log.** Die Anweisung beginnt mit dem Marker
   aus ADR 0231 Punkt 5. Er steht jetzt als `collation.RedactLiteralsInLog`
   im Shared Kernel neben `UnaccentLikePatternSQL`, und
   `protocol.RedactLiteralsInLog` ist derselbe Wert. Jeder Owner darf den
   Shared Kernel lesen; eine Regel von People Directory auf Transaction
   Runtime wäre eine neue Kante zwischen bestehenden Punkten.
4. **Freitext-, Zahl- und Datumsfragen filtern nach „Angabe vorhanden“.**
   `StudentAnswerFilters` bietet für diese Fragen die eine Antwort
   `AnswerGivenValue` (`*`), `StudentsWithAnswer` liest sie als „die neueste
   Antwort sagt etwas“. Eine geleerte Antwort ersetzt eine ältere wie bisher.
   Liste, Zählung und Export nutzen den bestehenden Pfad ohne Änderung.
   - **Wenige verschiedene Antworten werden Auswahl.** In der Seed-Schule
     schrieben fast alle Familien bei „Allergien“ „keine“; „Angabe
     vorhanden“ allein zeigt dann fast alle Kinder. Gibt es zu einer Frage
     zwei bis zwölf verschiedene Antworten (gefaltet wie die Suche, also
     „keine“ = „ Keine “), steht jede als eigene Option darunter, die
     häufigste zuerst, benannt nach ihrer häufigsten Schreibweise, gekürzt
     auf 60 Zeichen. Ihr Wert ist ein Schlüssel der gefalteten Antwort
     (`~` und FNV-64a), nie der Text: Der Filter steht in der Adresse, und
     Antworten wie „Laktoseintoleranz“ gehören nicht lesbar in Zugriffslogs.
     Der Schlüssel ist kein Geheimnis; wer eine kurze Antwort rät, kann ihn
     nachrechnen. Mehr als zwölf verschiedene Antworten sind ein Text, keine
     Auswahl; dann bleibt „Angabe vorhanden“.
   - **Kein „enthält …“:** Der Filter steht in der Adresse der Liste
     (`enrollment_answer`), ein Suchtext darf dort nicht stehen (ADR 0231
     Punkt 5). Nach Inhalten sucht „Überall suchen“.
   - **Kein „keine Angabe“:** Ein Kind ohne Antwort ist ebenso eines, das
     ohne Online-Anmeldung kam oder vor der Frage angemeldet wurde; die Liste
     würde das als „leer gelassen“ lesen lassen.
   - „Angabe vorhanden“ zählt jede eingetragene Antwort, auch „keine“. Die
     Hilfe sagt das; eine Liste von Wörtern, die „nichts“ bedeuten, wäre eine
     Vermutung über fremden Text. Die aufgelisteten Antworten zeigen
     stattdessen, wie viele „keine“ geschrieben haben.
5. **Keine neue Regel.** Die Ports der Projektion (`StudentNoteSearch`,
   `ActivityEnrollments`, `NoteAudience`) nennen eigene Werte. Die Root
   übersetzt sie in People Directorys und Timetables Werte
   (`schoolSearchNotes`, `schoolSearchActivities`) und bindet die Regel der
   Notizkarte (`schoolSearchNoteAudience`). Die Regel application →
   Enrollment public entfällt: Die Anwendung nennt Enrollments Werte nicht
   mehr selbst.

## Folgen

Eine Suche mit `ChildDetails` liest zusätzlich die Zuordnungen des Lesers
(pro Anfrage gemerkt), eine Anweisung bei People Directory und, nur bei
`care_team`-Notizen, eine Lesung der Angebote. Die Projektion bleibt bei
genau zwei eigenen Anweisungen (Query-Budget `modules.schoolsearchview.search`).
Wie bei den Anmeldeantworten wächst die Zahl der Notiztreffer mit der Schule;
die Anweisung liefert höchstens eine Zeile je Kind.

`modules/peopledirectory/compose` stellt die Suche neben der Fassade bereit,
wie `StudentNoteTeam` (#6854); ihr Budget in
`backend/test/module_legacy_budget_ratchet_test.go` steigt um 2 Zeilen auf
999 und nennt diese Entscheidung. Die Suche läuft wie `ListSchoolSharedNotes` in der
Schul-Transaktion der Anfrage und öffnet keine eigene; das Register der
Transaktionsgrenzen wächst nicht.

Gesundheitsangaben bleiben versiegelt und nicht durchsuchbar (ADR 0231).

## Nachweis

`TestStudentNoteSearchAppliesTheCardsAudience` prüft die Anweisung gegen die
echte Tabelle: Zielgruppen, Löschung, Mandant, neueste Notiz, LIKE-Zeichen.
`TestCareTeamNotesReachOnlyTheCareTeam` und
`TestNoteHitsFollowTheDirectHitsBeforeTheAnswers` prüfen Reihenfolge,
Rückfall und die eine Angebotslesung, `TestSchoolSearchNoteAudienceAsksTheCardsRule`
die Root-Bindung an die Regel und `TestNoteCardsOpenWithTheChildDetails`, dass
nur `ChildDetails` Notizen öffnet. `TestFreeAnswerFiltersListFewDistinctAnswers`
prüft die aufgelisteten Antworten, ihre Schlüssel und die Grenze. Enrollments Tests prüfen „Angabe vorhanden“ mit
geleerten und geerbten Antworten.
