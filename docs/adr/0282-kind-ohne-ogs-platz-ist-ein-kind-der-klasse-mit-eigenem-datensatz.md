---
status: accepted
---

# Ein Kind ohne OGS-Platz ist ein Kind der Klasse mit eigenem Datensatz

Entscheidung vom 25.10.2026 in
[#4803](https://github.com/moto-ogs/project-phoenix/issues/4803) (Variante A),
ergänzt am 16.11.2026. Sie löst für Schulen, die das einschalten, die
Klassenlisteneinträge von [#2382](https://github.com/moto-ogs/project-phoenix/issues/2382)
durch normale Kind-Datensätze ab. Sie genehmigt außerdem die geänderte Bindung
`roots/owners.CareStudents.FindCareStudents`. Es gibt keinen neuen Owner,
keinen neuen Port und keine Policy-Regel.

## Kontext

Ein Klassenlisteneintrag (`users.class_list_entries`) hat nur Name und Klasse.
An ihm hängen keine Person, keine Eltern und keine Beziehung zu
Sorgeberechtigten. Eltern-App, Krankmeldung, Elternbriefe und Elternsprechtag
hängen aber an Kind-Datensätzen und an der Beziehung zu den Sorgeberechtigten.
Deshalb erreichen sie Familien ohne OGS-Platz nicht. Ein zweiter Weg für Eltern
über Einträge (Variante B) hätte jede Rechteprüfung der Eltern verdoppelt.

## Entscheidung

- **Merkmal an der Mitgliedschaft.** `users.student_school_memberships.without_care_place`
  (School Membership, Migration `20261116221657`, Voreinstellung `false`) kennzeichnet ein
  Kind, das zur Klasse gehört, aber keinen OGS-Platz hat. Eine Prüfung hält es
  ohne Gruppe (`NOT without_care_place OR group_id IS NULL`). Die
  Schülerprojektion liest die Spalte mit. People Directory, Care Plan und
  Student Presence erhalten sie als Feld ihrer bestehenden Werte.
  `CareStudents.FindCareStudents` überträgt sie auf `careplan.CareStudent`.
  Sperrreihenfolge und Transaktion bleiben unverändert.
- **Nie OGS-Betreuung.** Care Plan zählt ein solches Kind an keinem Tag als
  Teilnehmer, auch wenn es als anwesend erfasst ist (`ParticipatingOn`,
  `HistoricalParticipationOn`). Damit fehlt es in jeder Liste, die auf der
  Teilnahme beruht: Kinderliste im Alltag, Gruppen, Tagesprotokoll, geplante
  Betreuungstage und Statistik. Es fehlt auch in den OGS-Lesern, die eigene
  Regeln haben:
  - Kiosk-Liste und Check-in: Ein- und Auschecken sowie Raumwechsel lehnen
    das Kind ab wie ein Kind mit beendeter Betreuung, damit der
    `/api/iot/*`-Vertrag gleich bleibt.
  - Essen und Statistik über `ListRosterOverlapping`. Caterer-Export und
    Essensabrechnung entstehen aus den Essenslisten. Die Betreuungsabrechnung
    folgt den Betreuungsverträgen; ein Kind ohne OGS-Platz hat keinen.
  - Abholplan (`PickupEligibleOn`), Ankunftszeiten und AGs (`AttendsOn`).
  - Geburtstagskarte.
  - Stichtagszahl, Kinderkontingent und Träger-Übersicht
    (`activelyManagedPredicate`, `childQuotaPredicate`).
- **Kind der Klasse.** Die Kinderliste in der Datenverwaltung
  (`AdministrativelyVisibleOn`) behält das Kind. Die Schule pflegt es dort und
  lädt die Eltern ein. Die Klassenliste der Tagesansicht zeigt es unter seiner
  Kind-ID als „Keine Betreuung“, wie bisher einen Eintrag. Krankmeldung,
  die Anwesenheit am Vormittag und „Fehlt ohne Meldung“ gelten für das Kind
  wie für jedes andere. Abholung, Übergabe an die OGS, Tageshinweise,
  Rückmeldungen zu Hausaufgaben und die Meldung von Ausflug oder Klassenfahrt
  an die OGS gibt es für das Kind nicht.
  Die Fehlzeitenliste zählt das Kind an jedem Tag, an dem es zur Klasse
  gehört (siehe Folgen).
  Elternsprechtag, Kalender und Elternbriefe lesen den Schul-Roster und
  erreichen die Familie ohne Änderung.
- **Eigener Schalter.** Die Schule bekommt die Funktion nur über eine eigene
  Einstellung, die das moto-Team umlegt. Ihre Voreinstellung ist aus. Sie wirkt
  nur bei gebuchtem Modul „Unterricht am Vormittag“. Modulschalter stehen
  standardmäßig auf „gebucht“ (Bestandsschutz, [Modulschalter](../reference/modulschalter.md)).
  Hinge die Funktion nur am Modul, wäre sie nach dem Deploy überall aktiv. Mit
  dem Einschalten werden die Klassenlisteneinträge der Schule zu
  Kind-Datensätzen. Danach legt die Schulverwaltung neue Kinder ohne OGS-Platz
  direkt als Datensatz an. Ohne den Schalter bleibt alles wie bisher.
- **Eltern.** Eltern solcher Kinder werden über die bestehenden Wege
  eingeladen, einzeln oder gesammelt aus der Kinderliste. Die Rechte gelten je
  Kind über die Beziehung (`.claude/rules/guardian-parent-permissions.md`). Die
  App zeigt für dieses Kind keine OGS-Funktionen: keine Abholung, keine
  Betreuungszeiten, kein Essen, keine Kurse und keinen Chat mit dem OGS-Team.
  Krankmeldung, Elternbriefe, Umfragen, Elternsprechtag, Kalender und
  Stammdaten bleiben.
- **Aufnahme in die OGS.** Ein Kind ohne OGS-Platz bekommt einen Platz über
  eine angenommene Anmeldung für das Schuljahr für das bestehende Kind. Erst
  dann zählt es für Stichtag und Kontingent. Eine Ferien- oder eigene Phase
  nimmt die Schule für ein solches Kind nicht an
  (`enrollment.without_care_place_school_year_only`): Sie gäbe ihm den Platz
  und beendete seine Betreuung mit den Ferien, und das Kind fiele danach aus
  den Klassenansichten.

## Folgen

- Neue OGS-Leser müssen das Merkmal beachten. Die Teilnahmeregel von Care Plan
  ist der Standardweg dafür.
- Wer ein Kind in ein OGS-Angebot schreibt, prüft das Merkmal selbst: Eine
  AG-Anmeldung lehnt ein solches Kind ab, und die Antwortübersicht einer
  Anmeldephase fragt seine Familie nicht.
- Die Liste der angemeldeten Kinder, die nur OGS-Leser nutzen (AG-Zielregeln,
  Abholplan, Zählung im Tagesprotokoll, Ablauf der Anmeldephasen), enthält
  ein solches Kind nicht. Für Timetable hat es an keinem Tag Betreuung.
- Ein Kind ohne OGS-Platz gehört zur Klasse ab dem Beginn seiner Anmeldung,
  sonst ab dem Tag seiner Anlage, bis zum Ende seiner Anmeldung; hat es die
  Schule verlassen (ehemalig oder inaktiv), nur mit einem Enddatum. Klassenliste
  und Fehlzeitenliste zeigen und zählen es nur in dieser Zeit. Vormittagsmarken,
  die ein umgewandelter Klassenlisteneintrag mitbringt, zählen auch davor.
  Bekommt das Kind später einen OGS-Platz, beginnt seine Anmeldung frühestens
  mit dem Platz. Den Beginn seiner Zeit in der Klasse behält School Membership
  in `class_member_from`; die Fehlzeitenliste zählt das Kind bis zum Tag vor
  dem Platz als Kind der Klasse, danach über seine OGS-Teilnahme.
- Im Glossar stehen die Begriffe „Kind ohne OGS-Platz“ und „Klassenlisteneintrag“
  getrennt.
- Löschfristen: Für ein Kind ohne OGS-Platz gelten die Fristen eines
  Kind-Datensatzes. Ein Klassenlisteneintrag hatte keine eigene Frist.

## Offen

Rechtsgrundlage und Auftragsverarbeitungsvertrag (AVV) für Daten von Kindern
ohne OGS-Vertrag klären Recht und Datenschutzbeauftragte. Der Schalter ist
standardmäßig aus. Deshalb erreicht keine Schule die Funktion, bevor das
moto-Team sie einschaltet.
