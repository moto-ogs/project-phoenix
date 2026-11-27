---
status: accepted
---

# „Heute anders“ liest die Quellen über Ports in einer eigenen Leseprojektion

Entscheidung vom 2026-11-20 zu
[#7658](https://github.com/moto-ogs/project-phoenix/issues/7658), aus der
[Spec zu #7128](https://github.com/moto-ogs/project-phoenix/issues/7128#issuecomment-7035643730).
Sie fügt den Projektions-Owner `day-changes-view` mit dem Paket
`modules/daychangesview` hinzu (Policy-Epoche 106). Sie fügt keine Tabelle,
kein Datenobjekt, keine Lesegrant, keine Regel und keine Route hinzu.

## Kontext

Die Staff-Startseite bekommt den Baustein „Heute anders“: alle Änderungen am
Regelbetrieb der Schule für heute an einem Ort. Die Einträge kommen aus
mehreren Owners: Abwesenheiten, Vertretungen und Dienste, abgesagte oder
verlegte Termine, Schließtage, Klassenausflüge und Stundenplanänderungen,
Krankmeldungen, Abholzeiten und Abholnotizen der Kinder, der geänderte
Speiseplan und die Hinweise der Leitung.

Kein bestehender Owner passt. `class-day-view` liest den Tag einer Klasse für
das Schulportal, `group-live-view` den Live-Stand einer Gruppe. Beide haben
eine andere Zielgruppe und einen anderen Ausschnitt. Ein Fachmodul als Heimat
würde dieses Modul für die Fakten und Rechte-Regeln aller anderen Quellen
verantwortlich machen und ihm Kanten zu fast allen Fachmodulen geben. Das
widerspricht [ADR 0071](0071-principle-owner-dependencies-point-one-way.md)
Punkt 2 und 3: Zwei Fachmodule haben je Paar nur eine Richtung, und viele
Quellen lesen ihrerseits schon andere Fachmodule.

Jede Quelle hat eine eigene Rechte-Regel. Beim Personal sieht die Betreuung
Namen nur für ihre eigenen Gruppen und Termine, sonst nur eine Zahl, und nie
einen Grund. Den Status eines Kindes sieht nur ein Konto mit `users:read`.
Ein Träger-Schließtag gilt nur bei aktueller Zugehörigkeit der Schule zum
Träger ([ADR 0194](0194-schliessstage-lesen-die-aktuelle-schulzugehoerigkeit.md)).

## Entscheidung

1. **Die Leseprojektion `day-changes-view`** (`modules/daychangesview`) ist
   ein Owner der Art `projection`. Sie ist nach der Lesung benannt, die sie
   bedient: die Änderungen am Regelbetrieb eines Tages
   ([ADR 0066](0066-principle-every-module-table-and-cross-owner-read-has-one-owner.md)
   Punkt 6). Der Name nennt bewusst nicht „heute“: v1 liest nur heute, eine
   Vorschau auf morgen (#7657) bliebe dieselbe Lesung.
2. **Sie schreibt nie und hat keine Tabellen.** Sie besitzt kein Datenobjekt
   und keine Lesegrant (ADR 0066 Punkt 4 und 5). Bestätigungen, etwa eines
   Hinweises der Leitung, laufen über den bestehenden Schreibweg des
   besitzenden Moduls.
3. **Sie liest jede Quelle über einen eigenen Port, nicht über SQL.** Die
   Projektion deklariert je Quelle einen schmalen Port in ihrem eigenen
   Vokabular. Die Root bindet ihn an die öffentliche Fähigkeit des
   besitzenden Moduls
   ([ADR 0067](0067-principle-owners-meet-through-contracts-and-write-together-in-workflows.md)
   Punkt 2, [ADR 0068](0068-principle-owners-compose-themselves-and-the-roots-only-wire.md)).
   Eine SQL-Projektion über die Tabellen der Module wird nicht gebaut. Sie
   müsste die Rechte-Regel jeder Quelle in eigenem SQL nachbauen, und jede
   spätere Änderung einer Regel müsste dort mitgezogen werden. Das
   Auswahlkriterium für eine neue SQL-Projektion aus
   [ADR 0081](0081-owner-granularity-follows-invariants-not-source-size.md#selection-criteria-accepted)
   trifft nicht zu: Keine Lesung braucht eine Anweisung über mehrere
   Schreib-Owner.

   Nach ADR 0066 Punkt 6 braucht eine Lesung über Ports im Verbraucher
   keinen eigenen Owner. Einen neuen Lese-Owner, der nur über Ports liest,
   erlaubt ADR 0081 nur mit einem eigenen ADR. Es zeigt Zweck und Nutzen und
   warum der Verbraucher nicht die Heimat ist. Hier gilt diese Ausnahme:
   - **Zweck:** die Änderungen am Regelbetrieb eines Tages, mit fester Route
     und fester Antwortform.
   - **Verbraucher:** die Startseite des Frontends, kein Backend-Owner. Im
     Frontend müsste sie jede Quelle über deren eigenen Endpunkt abfragen.
   - **Nutzen der Zusammenstellung:** Die Sichtregel „meine Gruppe heute“
     (Punkt 4) gilt nur für diese Lesung, nicht für die Detailseiten. Die
     Zuordnung zu den Abschnitten braucht die eigenen Gruppen und Dienste der
     Sitzung aus mehreren Quellen. Tag, Status pro Quelle und Teilausfall
     (Punkt 6 und 7) entstehen an einer Stelle im Backend statt in jedem
     Client.
4. **Jede Quelle wendet ihre eigene Rechte-Regel an.** Die Fähigkeit des
   besitzenden Moduls bekommt das Konto der Sitzung und liefert nur, was
   dieses Konto sehen darf, und ob es selbst beteiligt ist. Auch die
   Ausnahme „meine Gruppe heute“ gehört in die Quelle: Beim Personal liefert
   sie Namen für die eigenen Gruppen und Termine der Betreuung und für die
   übrige Schule nur die Zahl; die Leitung (Recht auf die Detailseite)
   bekommt alle Namen. Die Projektion filtert nicht nach Rechten. Sie ordnet die Einträge den Abschnitten
   „Betrifft dich“ und „Schule“ zu und sortiert sie. Was ein Konto mangels
   Recht nicht sehen darf, fehlt. Das ist kein Fehler und kein Teilausfall.
   Beim Personal hat die Antwort kein Feld für einen Grund, schon im Port
   nicht.
5. **Abhängigkeitsrichtung:** Zur Laufzeit hängt `day-changes-view` von
   den Quell-Modulen ab, nie umgekehrt: Ihr Verhalten braucht deren
   öffentliche Fähigkeiten. Diese Abhängigkeit läuft nur über die eigenen
   Ports der Projektion, die die Root bindet. Im Code importiert die
   Projektion kein Quell-Modul und kein Plattformmodul außer dem Shared
   Kernel (`calendar.Date`). Auch den Savepoint der Schul-Transaktion
   (Punkt 7) bekommt sie als Port; die Root bindet ihn an die Tenant
   Runtime. Ihr HTTP-Paket nutzt die gemeinsamen HTTP-Helfer
   (`api/common`). Kein Fachmodul hängt von der Projektion ab; die Policy
   verbietet das seit Epoche 91 (ADR 0071, #4540). Nur Roots binden sie.
   Damit entsteht kein Zyklus.
6. **Tenant und Tag.** Die Projektion liest nur die Schule der Sitzung, in
   der Schul-Transaktion der Anfrage mit RLS. Den Tag bestimmt das Backend
   als `calendar.Date` in der Zeitzone der Schule; es gibt keinen
   Datumsparameter. Quellen, die ein Datum als Text liefern, werden am Port
   in `calendar.Date` umgewandelt.
7. **Teilausfall.** Die Projektion ruft jede Quelle getrennt ab, jede in
   einem eigenen Savepoint der Anfrage-Transaktion (`tenant.WithSavepoint`).
   Ohne Savepoint würde ein fehlgeschlagenes Statement die ganze Transaktion
   abbrechen, und alle folgenden Quellen fielen mit aus. Schlägt eine Quelle
   fehl, enthält die Antwort die übrigen Einträge. Jede Quelle hat einen
   Status, „geladen“ oder „fehlgeschlagen“. Der Fehler wird mit slog geloggt, ohne
   personenbezogene Daten. Ein Fehler am Savepoint selbst bricht die Anfrage
   ab, weil der Zustand der Transaktion dann unbekannt ist.
8. **Strukturierte Antwort.** Die Antwort enthält keine fertigen deutschen
   Texte, sondern Art, Abschnitt, ganztägig oder Beginn und Ende, „seit“ und
   „bis“, beteiligte Personen, Gruppe oder Klasse, Raum, Link-Ziel und bei
   Zusammenfassungen die Zahlen mit den aufklappbaren Einzelzeilen. Die Texte baut das Frontend. Die
   Projektion löst kein SSE-Event aus. Das Frontend lädt bei den bestehenden
   Events der Quellen neu; fehlt einer Quelle ein Event, kommt es ohne Inhalt
   in deren Ticket dazu ([SSE-Vertrag](../agents/realtime.md)).

## Begriff

Ein Eintrag ist eine **Änderung am Regelbetrieb** (wie in #7127). Das Wort
„Abweichung“ wird vermieden: Im Glossar bezeichnet es schon die Änderung an
einer Träger-Kopie und die Schul-Abweichung einer Einstellung. Bestehende
Code-Namen wie das Event `staffing_deviation_changed` bleiben, neuer Code der
Projektion nutzt „change“.

## Folgen

- Die Tests folgen
  [ADR 0069](0069-principle-a-test-reaches-its-owner-the-typed-roots-and-the-shared-kernel.md):
  Router-Tests über die Route gegen die Test-Datenbank, für den Teilausfall
  ein Test der Komposition mit Fake-Ports.
- Jede Policy-Regel des Owners beschreibt nur das Ziel
  ([ADR 0070](0070-principle-only-the-target-is-a-rule-and-debt-leaves-with-evidence.md)).
  Eine Regel, die eine Kante von einem Fachmodul zur Projektion oder einen
  Zyklus öffnen würde, ist nicht zulässig.

- Das Paket `modules/daychangesview` enthält mit dieser Entscheidung nur
  seine Paketdoku. Die Prüfung der Policy nimmt einen neuen Projektions-Owner
  nur zusammen mit einem neu angelegten Paket an
  (`ownerPackagesAreCandidateCreated` in
  `backend/internal/architecture/policy_compare.go`). Ports, Komposition,
  Route und Regeln kommen mit dem ersten Ticket (#7659) dazu, je Quelle
  erweitert durch die Folgetickets.
- Jede Quelle kostet zwei Statements für den Savepoint (`SAVEPOINT`,
  `RELEASE`), eine fehlgeschlagene drei (dazu `ROLLBACK TO`). Das
  Query-Budget des Endpunkts zählt sie mit.
- ADR 0066 Punkt 6 bekommt einen Hinweis auf diese Ausnahme.
- Eine spätere SQL-Projektion für eine Quelle braucht eine eigene
  Entscheidung nach ADR 0081.

## Nachtrag 2026-11-20: Umsetzung der Quelle Personal (#7659)

- Die Route ist `GET /api/day-changes/today` (Basis, Staff-Portal). Pakete:
  `modules/daychangesview` (Ports, Zusammenstellung, Sortierung) und
  `modules/daychangesview/http`. Ein eigenes `compose`-Paket gibt es nicht:
  Die Projektion hat nichts Eigenes zu verdrahten, und die Root bindet die
  Ports in `backend/api/day_changes.go`.
- Die Quelle Personal stammt aus mehreren Ownern (Workforce für
  Abwesenheiten und Gruppen-Vertretungen, School Membership für die
  Gruppen-Lehrkräfte, Identity & Access für die eigenen Gruppen). Ein
  einzelnes besitzendes Modul gibt es dafür nicht. Ihre Sichtregel (Punkt 4)
  wendet deshalb die Root-Bindung des Personal-Ports an, also die
  Quell-Seite des Ports, nicht die Projektion. Die Leitung ist hier ein Konto
  mit `vacation:approve` oder `time_tracking:manage` (die Rechte der
  Abwesenheits-Detailseite) oder Admin; die Zahl für die übrige Schule
  bekommt ein Konto mit `users:read`.
- Terminbezogene Abwesenheit und Vertretung einzelner Termine
  (`schedule.instance_staff`) kommen als eigenes Folge-Ticket hinzu.

## Nachtrag 2026-11-20: Dienste in der Quelle Personal (#7661)

- Geänderte, abgesagte und vertretene Dienste des Dienstplans gehören zur
  Quelle Personal, nicht zu einer eigenen Quelle. Sie teilen Savepoint und
  Namensauflösung; ein eigener Status kostete fünf Statements mehr. Die
  Root-Bindung liest die Dienste über `ListStaffShifts` von Workforce in
  einem Read über die Woche um den Tag.
- Sichtregel: Die Betreuung sieht nur ihre eigenen Dienste und die
  Vertretung eines eigenen abgesagten Dienstes, auch keine Zahl für die
  übrige Schule. Die Leitung des Dienstplans ist Admin oder ein Konto mit
  `time_tracking:manage` (Recht der Seite `/dienstplan`) und sieht alle
  Dienste mit Namen.
- Eine Änderung ist ein abgesagter Dienst, ein Vertretungsdienst, eine auf
  heute oder von heute weg verschobene Serien-Ausprägung und eine Ausprägung
  mit anderen Zeiten als die Serie. Ein Dienst, den eine Abwesenheit
  abgesagt hat, ist keine: Die Abwesenheit ist der Eintrag. Ein Einzeldienst
  ist der Plan selbst.
- Die eigenen Gruppen liest die Quelle über `MyTeacherGroupIDs` von
  Identity & Access; die heute vertretenen Gruppen leitet sie aus den
  Gruppenübergaben des Tages ab, die sie ohnehin liest. Das ist die
  Team-Definition von #7138 und hält das Query-Budget des Endpunkts.

## Nachtrag 2026-11-20: Quelle Hinweise der Leitung und gemeinsamer Savepoint (#7667)

- Die Quelle Hinweise der Leitung liest Timetables bestehende Lesefähigkeit
  der heute geltenden Hinweise (`StaffNoticesOn`, Leserart Betreuung). Ihre
  Rechte-Regel ist die des bestehenden Lesewegs `GET /api/staff-notices/today`:
  `users:read`. Ohne dieses Recht liefert die Quelle nichts und bleibt
  „geladen“. Ein Hinweis, dessen Kenntnisnahme verlangt ist und fehlt, steht
  unter „Betrifft dich“ ganz oben; alle anderen stehen unter „Schule“.
  Bestätigt wird über `POST /api/staff-notices/{id}/acknowledge`.
- Timetable meldet neue, geänderte und gelöschte Hinweise nach dem Commit mit
  dem Event `staff_notices_changed` ohne Inhalt. Es läuft über Timetables
  bestehende After-Commit-Stelle `announceStaffingChanged`; die Wurzel bindet
  den Port für die Hinweise an das eigene Event.
- **Punkt 7 wird präzisiert.** Statt eines eigenen Savepoints je Quelle teilen
  sich aufeinanderfolgende Quellen einen Savepoint, solange sie gelingen.
  Schlägt eine fehl, rollt der Savepoint auch die Lesungen der Quellen davor
  zurück. Das ändert nichts, denn die Quellen lesen nur, und ihre Einträge
  liegen schon vor. Die übrigen Quellen bekommen danach einen neuen
  Savepoint. Damit ist jede Quelle weiter vor einem fehlgeschlagenen Statement
  einer anderen geschützt. Grund: Das Query-Budget eines Endpunkts darf nach
  der Architektur-Prüfung nicht wachsen. Ein Savepoint je Quelle hätte jede
  neue Quelle zwei Statements mehr gekostet als ihre eigenen Lesungen. Jetzt
  kostet der Rahmen zwei Statements je Anfrage, eine fehlgeschlagene Quelle
  zwei weitere (`ROLLBACK TO`, `RELEASE`) und einen neuen `SAVEPOINT`.
- Die Namen der Quelle Personal liest die Wurzel jetzt ohne das
  Beschäftigungsprofil: Die Übersicht braucht nur Mitgliedschaft und Person.

## Nachtrag 2026-11-20: Quelle Schließtage (#7664)

- Die Quelle `closing_days` liest über School Calendars `ListClosingDays`
  die Schließtage der Schule und die ihres aktuellen Trägers
  ([ADR 0194](0194-schliessstage-lesen-die-aktuelle-schulzugehoerigkeit.md))
  in einer Anweisung. Jeder Schließtag ist ein ganztägiger Eintrag unter
  „Schule“ und steht dort vor allen anderen Einträgen. Der Name des
  Schließtags ist der Text, den Schule oder Träger ihm gegeben haben; er ist
  kein Grund einer Person.
- Rechte-Regel: Ein Konto sieht die Schließtage, wenn es sie im Staff-Portal
  schon lesen darf: `schedules:read` oder `schedules:manage` (Stundenplan,
  Kalender) oder `time_tracking:own` oder `time_tracking:manage`
  (Zeiterfassung), sonst Admin. Der Link auf „Schuljahr und Kalender“ kommt
  nur mit `schedules:manage`, dem Recht dieser Seite.
- Live: Anlegen, Ändern und Löschen eines Schließtags der Schule senden über
  den bestehenden After-Commit-Haken der Stundenplan-Route das inhaltslose
  `staffing_deviation_changed` (Quelle `closing_days`). Ein neuer Haken oder
  ein neues Event hätte das schrumpfende Register der After-Commit-Haken
  wachsen lassen. Ein Schließtag des Trägers hat noch kein Signal; die
  Übersicht gleicht ihn beim Fokus und nach erneuter Verbindung ab.
- Budget: Die Quellen teilen sich einen Savepoint (wie im Nachtrag zu #7667).
  Die Personal-Quelle liest die heute vertretenen Gruppen aus den
  Gruppenübergaben des Tages statt aus einer eigenen Lesung der Vertretungen
  der Sitzung. Damit bleibt das Budget des Endpunkts bei 19 Anweisungen,
  gemessen mit einem Konto, das die Schließtage liest.
- Klassenausflug und Stundenplanänderung einer Klasse passen nicht mehr ins
  Budget, ohne es zu erhöhen. Sie kommen in einem Folge-Ticket.

## Nachtrag 2026-11-21: Abwesenheit und Vertretung einzelner Termine (#7675)

- Die Arten `block_staff_absent` (eine Kraft fehlt bei einem Termin, niemand
  übernimmt) und `block_substitution` (jemand übernimmt einen Termin) gehören
  zur Quelle Personal. Timetable liefert über `BlockStaffChangeQuery` die
  Termine des Tages mit einer abwesenden oder vertretenden Kraft samt allen
  Zuordnungen, in einer Anweisung und ohne Grund. Die Root-Bindung wendet die
  Personal-Regel an.
- Sichtregel: Namen sieht die Betreuung bei eigenen Terminen (sie steht in
  der Zuordnung) und wenn jemand aus ihrem Team fehlt oder übernimmt; die
  Leitung sieht alle. Für die übrigen Termine bekommt ein Konto mit
  `users:read` nur die Zahl (`block_change_count`), wie bei den
  Abwesenheiten.
- Team ist hier das Team der Person (Lehrkräfte der eigenen Gruppen und die
  Vertretungen des Tages), wie bei den tagesweiten Abwesenheiten. #7138
  bestimmt das Team eines Termins über dessen OGS-Gruppen; das kostet zwei
  weitere Anweisungen (Gruppen des Termins, Gruppen der geplanten Kinder) und
  passt nicht ins Budget. Ein Folge-Ticket kann es nach einer Einsparung
  nachziehen.
- Eine Abwesenheit, die eine Krankmeldung gesetzt hat oder die eine
  ganztägige Abwesenheit des Tages abdeckt, ist kein eigener Eintrag; ihre
  Vertretung schon. Bei einer halbtägigen Abwesenheit bleiben die Termine
  der anderen Tageshälfte Einträge.
- Die Projektion legt die Zeile „andere Leitung“ der Quelle Stundenplan mit
  dem Eintrag der Quelle Personal zum selben Termin zusammen und übernimmt
  deren Raum. Das ist kein Rechte-Filter: Fehlt der Eintrag der Quelle
  Personal, bleibt die Zeile des Stundenplans.
- Link: der Vertretungsplan des Tages mit dem Termin (`schedules:manage` oder
  Admin), sonst der Tagesplan (`schedules:read`).
- Budget: Die neue Anweisung wird an anderer Stelle eingespart. Die
  Gruppen-Lehrkräfte kommen mit ihren Personal-Datensätzen in einer Anweisung
  (School Membership), der geplante Raum einer Serie kommt mit dem Termin aus
  dem bestehenden Join der Vorlage, und die Quellen eines Savepoints lesen die
  Personalnamen gemeinsam. `api.day_changes.today` bleibt bei 19,
  `api.day_changes.today_activities` bei 20 Anweisungen.

## Nachtrag 2026-11-21: Klassenausflug und Unterrichtsschluss einer Klasse (#7681)

- **Klassenausflug** gehört zur Quelle Kinder (Betreuungsplan). Ein Ausflug
  über den ganzen Tag ist der Status-Tag `class_trip` je Kind, den die Quelle
  ohnehin liest. Ein Tagesausflug mit Rückkehrzeit ist die Ankunfts-Ausnahme
  je Kind mit dem Grund „Ausflug“ (`classday.IsClassTripArrival`); dafür liest
  die Quelle die Ankunfts-Ausnahmen des Tages in einer Anweisung. Die Klasse
  kommt mit Namen und Gruppe der Kinder aus derselben Lesung des People
  Directory (`ListStudentNamesByID` trägt jetzt Klasse und Gruppe). Eine
  eigene Quelle hätte Status-Tage und Kinder ein zweites Mal gelesen. Der
  Eintrag `class_trip` nennt Klasse, Rückkehrzeit und Zahl der Kinder, nie
  ein Kind oder einen Grund.
- **Geänderter Unterrichtsschluss** ist die Quelle `classes`. Timetable liest
  die klassenweiten Ankunfts-Ausnahmen aller Klassen eines Tages in einer
  Anweisung (`ClassArrivalDayQuery`). Der Eintrag
  `class_dismissal_changed` nennt Klasse und Uhrzeit, nie den Grund.
- Rechte-Regel beider Arten: `users:read` (oder Admin), das Recht der Seite
  eines Kindes und der Klassen-Ausnahmen. Ohne Recht fehlen die Einträge,
  die Quelle bleibt „geladen“.
- **Personal der Klasse** ist, wer der Klasse zugeordnet ist
  (`MySchoolClasses`, Identity & Access). Beim Ausflug zählt auch die
  Betreuung eines Kindes auf dem Ausflug (eigene Gruppe oder heute vertreten).
  Diese Einträge stehen unter „Betrifft dich“, alle anderen unter „Schule“.
- Live: Ein Tagesausflug und ein geänderter Unterrichtsschluss senden
  `arrival_schedule_changed`, ein Klassenfahrt-Status `student_updated`. Der
  Baustein lädt auf beide neu.
- **Budget:** Die eigenen Lehrkraft-Gruppen liest die Root jetzt in einer
  Anweisung von School Membership über den Personal-Datensatz
  (`TeacherStaffIDs`), statt über Identity & Access (Lehrkraft, Zuordnungen,
  Gruppen: drei Anweisungen). Personal und Kinder teilen das Ergebnis im
  Savepoint. Die Kinder kommen mit Namen in einer statt zwei Anweisungen.
  Dafür kommen die Ankunfts-Ausnahmen des Tages, die Klassen-Ausnahmen des
  Tages und die Klassen der Sitzung dazu. `api.day_changes.today` sinkt von
  19 auf 17, `api.day_changes.today.children` bleibt bei 24 (gemessen mit
  Ausflügen und Klassen-Ausnahmen), `api.day_changes.today_activities` bei 20.
- Die eigenen Gruppen der Quelle Kinder sind die Lehrkraft-Gruppen und die
  Vertretungen der Sitzung am Tag der Übersicht, wie `MyGroupIDs` sie
  bestimmt, aber für den Tag der Übersicht statt für den Kalendertag der Uhr.

## Nachtrag 2026-11-21: Quelle Termine im Kalender (#7663)

- Die Quelle Termine liest die Ausnahmen einzelner Kalendertermine über
  die bestehenden Lesefähigkeiten von Appointments
  (`ListAppointmentsVisibleToStaff`, `FindOccurrenceOverrides`,
  `FindRecurrenceRules`). Ihre Rechte-Regel ist die des eigenen Kalenders
  (`GET /api/calendar/my`): `calendar:own` und ein Personaldatensatz. Sichtbar
  sind nur Termine, die das Konto organisiert oder zu denen es eingeladen ist;
  die Leitung sieht hier keine fremden Termine. Darum steht jeder Eintrag
  unter „Betrifft dich“. Ohne Recht bleibt die Quelle „geladen“ und leer.
- Arten: `appointment_cancelled` (der Termin ist abgesagt oder der heutige
  Termin einer Serie ist einzeln abgesagt) und `appointment_changed` (der
  heutige Termin einer Serie hat einen anderen Ort oder eine andere Zeit).
  Die Rücknahme einer Absage hat keinen eigenen Zustand: Es gibt keinen
  Schreibweg dafür, und ein Termin ohne Ausnahme erscheint nicht.
- Die Quelle liest neben dem Personaldatensatz der Sitzung, den die Anfrage
  schon für die Quelle Personal kennt, höchstens drei Statements: die Termine,
  die Ausnahmen der Tage, die heute erreichen können, und die Regeln nur
  abgesagter Serien. Ohne `calendar:own` liest sie nichts.
- Ein heutiger Termin, der auf einen anderen Tag verlegt ist, findet heute
  nicht statt und erscheint als abgesagt. Ein Termin, der von einem anderen
  Tag auf heute verlegt ist, wird nicht gelesen. Beides kann heute noch kein
  Schreibweg des Kalenders erzeugen; es gibt nur die Absage.
- Ein Live-Signal gibt es noch nicht. Eine neue After-Commit-Stelle müsste das
  schrumpfende Register `durable_side_effect_notices.json` erweitern; das
  entscheidet #7693. Bis dahin wird die Übersicht beim Fokus, bei erneuter
  Verbindung und beim Laden aktuell.

## Nachtrag 2026-11-21: Quelle Speiseplan (#7666)

- Die Quelle Essen liest Meal Plans neue Lesefähigkeit `MenuChanges`
  (`MenuChangedOn`, ein Statement im Adapter des Owners). Meal Plan
  kennzeichnet einen Tag beim Speichern mit `menu_changed_at`, wenn ein schon
  veröffentlichtes Menü geändert wird. Das ist dieselbe Regel wie beim Hinweis
  an die Eltern (#7145): Die erste Veröffentlichung ist keine Änderung, ein
  erneutes Speichern desselben Menüs behält die Kennzeichnung, Löschen entfernt
  den Tag samt Kennzeichnung.
- Rechte-Regel: Jedes Konto des Staff-Portals sieht die Kurzinfo, auch ohne
  `meals:read`. Sie nennt kein Gericht. Den Link auf die Seite Speiseplan
  bekommt nur ein Konto, das den Speiseplan lesen darf (Regel von
  `GET /api/meal-plan/days`), damit niemand auf einer leeren Seite landet.
- Live: Meal Plan meldet ein gespeichertes oder gelöschtes Menü mit dem Event
  `meal_plan_changed` ohne Inhalt an die Schule. Die Wurzel bindet es als
  Middleware außerhalb der Anfrage-Transaktion der beiden Schreibrouten, sie
  sendet also nur nach einer bestätigten 2xx-Antwort, und braucht keinen
  neuen After-Commit-Eintrag.
- Query-Budget: Die Quelle kostet ein Statement. Zwei Einsparungen gleichen
  es aus. Die Quelle Personal liest die eigenen Lehrkraft-Gruppen und die
  Lehrkräfte dieser und der heute vertretenen Gruppen in einem Statement von
  School Membership (`GroupAssignmentFilter.GroupsOfTeacherStaffIDs`) statt in
  zweien; die Quellen Kinder und Klassen nutzen das Ergebnis im Savepoint
  weiter. Die beiden Termin-Lesungen von Timetable (`BlockStaffChanges` für
  Personal, `BlockDayChanges` für Stundenplan) teilen sich im Savepoint die
  Zuordnungen des Tages (`WithDayStaffShare`): Die erste liest alle Zeilen des
  Tages mit ihrem Termin in einem Statement, die zweite filtert sie.
  Das Team liest die Quelle Personal nur, wenn der Tag Abwesenheiten,
  Gruppenübergaben oder Terminänderungen hat; nur für diese entscheidet es,
  ob sie das Konto betreffen. `api.day_changes.today` bleibt bei 17,
  `api.day_changes.today.children` bei 24,
  `api.day_changes.today_activities` bei 20 und
  `api.day_changes.today_appointments` bei 15 Anweisungen.

## Nachtrag 2026-11-23: Budget mit Kalender-Recht (#7903)

- Das Szenario `api.day_changes.today` misst jetzt den realistischen Fall:
  eine Betreuung mit Gruppe und `calendar:own`, mit Abwesenheiten,
  Gruppenübergaben, geänderten Diensten und Termin-Ausnahmen (ein einzeln
  abgesagter Termin einer Serie und eine ganz abgesagte Serie). Gemessen
  vor dem Umbau: 20 Anweisungen bei einer Obergrenze von 17.
- Die Quelle Termine liest über die neue Lesefähigkeit
  `appointments.StaffDayAppointments` in einer statt drei Anweisungen:
  die sichtbaren Termine des Tages mit ihrer Regel und den Ausnahmen der
  Tage, die heute erreichen können (höchstens 31 Tage zurück, wie bisher).
  Appointments faltet die Zeilen der Verbindung zu einem Wert je Termin.
  Sichtregel (`calendar:own`, Organisator oder eingeladenes Personal) und
  Ergebnis bleiben gleich.
- Die Quelle Personal liest die Abwesenheiten mit Planwirkung und die
  Gruppenübergaben des Tages über `workforce.StaffDayReads` in einer statt
  zwei Anweisungen (zwei JSON-Listen in einem Select, dieselben Filter wie
  `ListStaffAbsences` und `ListGroupSubstitutions`).
- Beide Lesungen bindet die Root an die vorhandenen Kompositionen der
  Owner (`appointments.StaffDayAppointmentsOf`, Typprüfung des
  Work-Time-Service in `NewDayChanges`), ohne neue Kompositionszeilen.
- `api.day_changes.today` bleibt bei 17 Anweisungen.
  `api.day_changes.today_appointments` sinkt von 15 auf 12,
  `api.day_changes.today.children` von 24 auf 23 und
  `api.day_changes.today_activities` von 20 auf 19. Das Szenario
  `today_appointments` bleibt: Es misst die Sitzung ohne Gruppe mit
  engerer Obergrenze.

## Nachtrag 2026-11-25: Heute anders im Schulportal (#7670)

- Die Route ist `GET /school/day-changes/today` (Schulportal, nur
  Schul-Sitzungen) hinter `class_day:read`. Dieselbe Projektion
  (`daychangesview.NewSchool`) liest mit eigenen Quellen; Savepoint, Status
  pro Quelle und Sortierung bleiben gleich. Die Root bindet die Ports in
  `backend/api/day_changes_school.go`. Die Sichtregeln gelten für das
  Schulportal eigenständig und kommen nicht aus denen des Staff-Portals.
- **Abgrenzung zu `class-day-view`.** Die Kinder der eigenen Klassen
  (Krankmeldung, Abholzeit, Ausflug eines Kindes) liest die Projektion
  nicht. Sie stehen in den Zeilen des Klassentags, und die Startseite lädt
  dessen Klassenbericht (`assigned-classes`) ohnehin. Der Block zählt die
  geänderten Kinder pro Klasse aus diesem Bericht und springt zur ersten
  geänderten Zeile. So werden Kinderdaten nicht doppelt gelesen, und ihre
  Regel bleibt die des Klassentags (`education.class_teachers`).
- Quellen in diesem Schritt:
  - `classes`: geänderter Unterrichtsschluss der eigenen Klassen, unter
    „Betrifft dich“. Ein Konto mit `class_day:all_classes`
    (Schulverwaltung) sieht alle Klassen unter „Schule“. Kein Grund.
  - `closing_days`: Schließtage der Schule und ihres Trägers, mit
    `calendar:school`, dem Recht des Kalenders in moto schule, der sie
    schon zeigt. Link auf diesen Kalender.
- Neue Link-Ziele: `school_class` (Klassenseite, Klasse aus `class`) und
  `school_calendar`.
- Live: Der Block lädt bei `class_day_changed` und beim Fokus neu. Ein
  geänderter Unterrichtsschluss und ein Schließtag senden heute kein
  Ereignis an das Schulportal; der Abgleich beim Fokus holt sie.
- Budget: `school.day_changes.today` mit 10 Anweisungen, gleich bei einer
  und vier Klassen.
- Noch offen (Folge-Ticket): Klassenausflug als Klassen-Eintrag,
  Vertretungen bei den eigenen Aufsichten und Termine der Lehrkraft.
  Verkürzte Öffnung, Essensausfall, Raumsperren und Abholperson folgen mit
  #7654, #7656, #7653 und #7655.

## Nachtrag 2026-11-25: Aufsichten und Live-Signal im Schulportal (#8148)

- **Quelle `supervisions`:** Vertretungen bei den eigenen Aufsichten der
  Lehrkraft. Ein Eintrag `block_substitution` entsteht, wenn sie einen
  Termin übernimmt oder jemand ihren Termin übernimmt. Er steht unter
  „Betrifft dich“ und verlinkt auf die Aufsichten (`school_supervisions`).
  Die einzige Person eines Eintrags ist sie selbst; wer sie vertritt oder
  wen sie vertritt, steht ohne Namen und ohne Personal-ID in der Antwort,
  einen Grund gibt es nicht. Fehlt ein Kollege bei ihrem Termin ohne
  Vertretung, oder fehlt sie ohne Vertretung, ist das kein Eintrag.
- Rechte-Regel: `supervision:own`, das Recht der Seite Aufsichten, und eine
  eigene Zeile der Lehrkraft am Termin. Ohne Recht oder ohne
  Personaldatensatz bleibt die Quelle „geladen“ und leer.
- **Budget:** Timetable liest die klassenweiten Ankunfts-Ausnahmen des Tages
  und die geänderten Termine, an denen die Lehrkraft eingeteilt ist, in
  einer Anweisung (`timetable.SchoolDayChangeQuery`, zwei JSON-Listen in
  einem Select). Die Quellen `classes` und `supervisions` teilen sich das
  Ergebnis im Savepoint. `school.day_changes.today` bleibt bei 10
  Anweisungen, gemessen mit Klassen-Ausnahmen und einer Vertretung.
- **Live:** Der Hub leitet `arrival_schedule_changed` und
  `staffing_deviation_changed` wie `student_updated` inhaltslos als
  `class_day_changed` an die Schul-Clients derselben Schule weiter. Ein
  geänderter Unterrichtsschluss, ein Schließtag der Schule und eine
  Vertretung an einem Termin erreichen den Block damit ohne neue
  After-Commit-Stelle, ebenso ein Schließtag des Trägers (er meldet
  `staffing_deviation_changed` an jede betroffene Schule). Jedes dieser
  Events lädt die offenen Startseiten der Schule neu, auch wenn es eine
  andere Lehrkraft betrifft; der bestehende Debounce bündelt Serien.
- **Nicht in diesem Schritt (Folge-Ticket):** Der Klassenausflug als
  Klassen-Eintrag und die Termine der Lehrkraft (`calendar:school`). Beide
  brauchen eigene Lesungen anderer Owner (Ankunfts-Ausnahmen je Kind bei
  Care Plan, Status-Tage, Klassen der Kinder; Termine bei Appointments),
  für die es im Budget keine Einsparung gibt.

## Nachtrag 2026-11-26: Klassenausflug und Termine im Schulportal (#8155)

- **Klassenausflug:** kein Eintrag der Projektion, sondern ein Feld
  `trips` pro Klasse im Bericht `GET /school/class-day/assigned-classes`
  (Owner Klassentag), den die Startseite ohnehin lädt. Pro Klasse und
  Rückkehrzeit die Zahl der Kinder: eine Klassenfahrt (Status-Tag
  `class_trip`) ohne Zeit, ein Tagesausflug (Ankunfts-Ausnahme je Kind mit
  Grund „Ausflug“) mit der Zeit, zu der die Kinder in die OGS kommen. Kein
  Kind, kein Grund. Den Grund der Ausnahme liefert Care Plan in der Lesung
  der Betreuungstage mit, die der Bericht schon für „kommt heute nicht“
  macht (`PlannedCareDay.ArrivalReason`); das Budget
  `modules.classday.assigned_classes` bleibt bei 30. Der Block baut daraus
  Einträge der Art `class_trip` unter „Betrifft dich“, mit dem Satz des
  Staff-Portals. Die Schulverwaltung (`class_day:all_classes`) lädt den
  Bericht nicht und sieht keine Ausflüge im Block.
- **Termine:** neue Quelle `appointments` von `NewSchool`. Regel des
  Kalenders in moto schule: `calendar:school` und ein Personaldatensatz,
  sichtbar ist, was Appointments der Lehrkraft als Organisatorin oder
  eingeladenem Personal zeigt. `calendar:own` gilt hier nicht. Die
  Ausnahmen des Tages sind die des Staff-Portals; das Link-Ziel ist der
  Kalender von moto schule. Ohne Recht bleibt die Quelle „geladen“ und leer.
- **Budget:** Die Aufrufer-Kette las Person, Personal und Klassen in drei
  Anweisungen. Personaldatensatz und Klassen gehören beide School
  Membership und kommen jetzt in einer Anweisung
  (`schoolmembership.StaffClassReads`). Die frei gewordene Anweisung nutzt
  die Termin-Lesung; `school.day_changes.today` bleibt bei 10.
- **Live:** Ein Tagesausflug meldet `arrival_schedule_changed` und erreicht
  den Block als `class_day_changed`. Eine abgesagte oder geänderte
  Termin-Ausnahme sendet kein Signal an das Schulportal; der Block holt sie
  beim Fokus und beim erneuten Verbinden.

## Nachtrag 2026-11-26: Vorschau auf morgen (#7657)

- **Punkt 6 wird erweitert.** Die Übersicht liest heute oder morgen. Die
  Routen `GET /api/day-changes/today` und `GET /school/day-changes/today`
  nehmen den optionalen Parameter `date` (`YYYY-MM-DD`). Ohne ihn liest das
  Backend heute wie bisher. Die Projektion prüft den Tag
  (`daychangesview.Query.On`): erlaubt sind heute und der nächste
  Kalendertag in der Zeitzone der Schule. Jeder andere Tag und ein falsches
  Format antworten mit 400 und `general.input`. Ein eigener Pfad
  `/tomorrow` hätte die Route verdoppelt; der Filter ist ein Parameter
  (Backend-Regel 6). Der Pfad behält seinen Namen, damit Frontend, Proxy und
  Analytics-Routen unverändert bleiben.
- Die Quellen-Ports nahmen den Tag schon als `calendar.Date`; keine Quelle
  liest die Uhr. Sichtregel, Savepoint, Status pro Quelle und Query-Budget
  sind für morgen dieselben wie für heute.
- Morgen ist der nächste Kalendertag, auch am Wochenende oder an einem
  Schließtag. Der Schließtag steht dann als Eintrag da; die Vorschau springt
  nicht zum nächsten Betreuungstag. Es gibt keine Uhrzeit, ab der die
  Vorschau erscheint, und keine Schuleinstellung.
- Frontend: ein Umschalter „Heute / Morgen“ im Kopf von „Heute anders“
  (`components/home/day-switch.tsx`), im Staff-Portal und in moto schule.
  Die Sätze sind dieselben, nur „heute“ wird „morgen“. Der Klassenbericht
  von moto schule wird für den gezeigten Tag geladen. Das Ereignis
  `day_changes_tomorrow_shown` zählt, ob die Vorschau genutzt wird.
- **Nicht in diesem Schritt:** Elternportal (#7671) und Träger-Portal
  (#7672) haben eigene Lesewege (`ChildQuery.ChildDay`,
  `traegerview.DayChangesReport`). Sie folgen in einem eigenen Ticket.

## Nachtrag 2026-11-27: Vorschau auf morgen im Eltern- und Träger-Portal (#8236)

- **Elternportal.** `GET /parent/me/children/{studentId}/day-changes` nimmt
  das optionale `date`. `daychangesview.ChildQuery.ChildDayOn` prüft den Tag
  wie `Query.On` (heute oder morgen der Schule). Der Port
  `care.ChildDayChanges` bekommt den Tag; der leere Tag liest heute wie
  bisher. Die Beziehungsprüfung (`parent_portal.access`, `WithPermittedChild`)
  läuft zuerst und in derselben Transaktion: Ein Kind ohne Recht antwortet
  auch mit einem unzulässigen Tag mit 403/404, nie mit 400.
- **Träger-Portal.** `GET /traeger/schools/day-changes` nimmt `date`.
  `traegerview.DayChangesReport.SchoolsDayChanges` bekommt den Tag; erlaubt
  sind heute und morgen in Berlin, wie die Übersicht bisher heute las. Nur
  die Schulen des Trägers, ohne Person und ohne Grund, mit denselben
  Statements wie für heute.
- Andere Tage und falsche Formate antworten in beiden Portalen mit 400 und
  `general.input`. Kein Query-Budget wächst.
