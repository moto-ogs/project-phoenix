---
status: proposed
---

# Kinderliste des Trägers liest Namen über die Fach-Owner

Vorschlag vom 26.11.2026 zu [#8137](https://github.com/moto-ogs/project-phoenix/issues/8137).
Er folgt [ADR 0151](0151-schulansicht-des-traegers-liest-ihre-zahlen-ueber-die-fach-owner.md),
[ADR 0154](0154-belegung-des-traegers-liest-gruppen-und-buchungen-ueber-die-fach-owner.md)
und [ADR 0214](0214-traeger-buero-sieht-ein-an-einer-schule-bekanntes-ferienkind.md)
und wendet [ADR 0084](0084-traeger-portal-liest-ueber-eine-projektion-und-schreibt-in-der-schule.md)
Abschnitt 4 und 7 an. Er führt keinen neuen Owner, keine neue Tabelle und
keine neue Transaktionsstelle ein. Mit dem Merge des PRs nimmt der Product
Owner den Vorschlag an.

## Kontext

Das Träger-Büro will alle Kinder seiner Schulen in einer Liste sehen, mit einem
Reiter je Schule, ohne in jede Schule zu wechseln. Bisher sieht es Kinder nur
als Zahlen (Schulansicht, Belegung) oder in Listen einer einzelnen Aufgabe
(Verträge, Familien, Ferien). Das Issue lässt offen, welche Angaben das Büro je
Kind sehen darf. [#4815](https://github.com/moto-ogs/project-phoenix/issues/4815)
beschreibt eine breitere Liste mit Vertrags- und Abrechnungsdaten und eine
Kinderakte des Trägers; beides gibt es noch nicht.

Die Angaben liegen bei drei Owners: Name bei People Directory, Zugehörigkeit,
Klasse und Gruppe bei School Membership, der Name der Gruppe bei School
Structure. Ein Träger hat 2 bis über 100 Schulen mit je 50 bis 400 Kindern.

## Entscheidung

1. **Angaben: nur, wer das Kind ist und wo es betreut wird.** Eine Zeile nennt
   Vorname, Nachname, Schule, Klasse und OGS-Gruppe. Das reicht für den Zweck,
   ein Kind zu finden und seine Schule zu kennen. Geburtsdatum, Adresse,
   Eltern, Gesundheits- und Förderangaben, Anwesenheit und Vertrags- oder
   Abrechnungsdaten stehen nicht in der Liste und nicht im Export. Dieselben
   Angaben bekommt das Büro heute schon je Schule in der Auslastung
   ([ADR 0241](0241-auslastung-des-traegers-liest-zeitreihen-ueber-die-fach-owner.md)).
2. **Recht.** Liste und Export brauchen „Verträge verwalten“
   (`traeger_contracts:manage`), das Recht, das schon die Namen der Auslastung
   und von Soll und Ist öffnet (ADR 0156, ADR 0241). ADR 0084 Abschnitt 4:
   personenbezogene Angaben gibt es nur zusammen mit dem Fachrecht. Ein neues
   Recht ist nicht nötig. Ohne das Recht antworten die Routen 403, und die
   Seitenleiste zeigt den Eintrag nicht.
3. **Welche Kinder.** Die Liste zeigt die Kinder der Stichtagszahl-Regel von
   heute (#2791), dieselben wie „Kinder gesamt“ der Schulansicht und die
   Belegung. Die Zahl am Reiter einer Schule ist damit dieselbe Zahl wie in
   der Schulansicht. Führt die ausrichtende OGS einen Feriengast nach dieser
   Regel, steht er bei ihr, mit der Klasse, die School Membership ihm gibt.
   Die Definitionen stehen an `traegerview.TraegerChildren`.
4. **Lesen über die Owner in der Admin-Einheit der Projektion.**
   `GET /traeger/schools/children` liest je Seite:
   - die Schulen des Trägers und ihre Zeilen (bestehend),
   - bei School Membership die geführten Kinder der Schulmenge
     (`SchoolRosters.ActiveStudentMembershipsByTenant`, bestehend),
   - bei People Directory eine Seite Namen aus genau diesen Kindern
     (`SchoolStudentNames`, neu): Suche, Reihenfolge, Grenze und Trefferzahl
     in einer Abfrage,
   - bei School Membership Klasse und Gruppe der Zugehörigkeiten dieser Seite
     (`SchoolRosters.MembershipPlacementsByTenant`, neu),
   - bei School Structure die Gruppennamen der Schulen dieser Seite
     (`TraegerGroupNames`, bestehend).

   Jede Abfrage liegt im Postgres-Paket ihres Owners, filtert mit
   `tenant_id = ANY(?)` auf die übergebenen Schulen und verweigert ohne die
   Admin-Einheit. Es gibt keinen Join über Owner. Das Budget
   `api.traeger.schools_children` liegt bei 7 Statements, flach in der Zahl
   der Schulen und Kinder.
5. **Seiten und Suche.** Eine Seite hat 50 Kinder, geordnet nach Nachname,
   Vorname und ID in der deutschen Sortierung der Namensspalten. Die nächste
   Seite setzt hinter diesen drei Werten der letzten Zeile an. Ein Kind,
   das davor hinzukommt oder wegfällt, verschiebt die Grenze nicht. Ein
   Seitenzeiger gilt nur für seinen Berliner Kalendertag. Beim Tageswechsel
   beginnt die Liste mit einem neuen protokollierten Abruf. Auch ein
   Download braucht den Tag der angezeigten Liste und verweigert nach dem
   Tageswechsel, bis die Liste neu gelesen wurde. Die Suche
   trifft einen Teil von „Vorname Nachname“, „Nachname Vorname“ oder
   „Nachname, Vorname“, wie die Liste den Namen zeigt, ohne Groß- und
   Kleinschreibung und Akzente. Der Suchtext steht nicht im
   Query-Log (ADR 0234). `school_id` grenzt auf eine Schule ein; eine Schule
   eines anderen Trägers und eine unbekannte ID antworten gleich mit 404
   `traeger.school_not_found`.
6. **Protokoll.** Namen sind personenbezogen. Jede Seite und jeder Export
   schreibt nach ADR 0084 Abschnitt 7 einen Eintrag in das Zugriffsprotokoll
   jeder Schule, von der eine Zeile gezeigt wurde, mit Konto, Kanal
   „Träger-Portal“ und der Zahl der Zeilen (`traeger_children`,
   `traeger_children_export`). Die Zahlen je Schule an den Reitern sind
   zusammengefasst und stehen nicht im Protokoll. Die Seite zeigt deshalb
   beim Öffnen, Wiederanzeigen und nach jedem Wechsel von Reiter oder Suche
   erst die Antwort ihres eigenen Abrufs, nie Namen aus dem Speicher des
   Browsers (ADR 0311, Regel für protokollierte Lesezugriffe). Verweigert das
   Nachladen oder der Download den Zugriff, verschwinden die Namen der
   Liste, aus der die Anfrage kam, sofern sie noch offen ist.
7. **Modul.** Die Liste gehört wie die Schulliste zu moto Basis.
8. **Wurzel und Register.** `api/traeger_children_ports.go` übersetzt die
   Namensabfrage und ihre Antwort zwischen Projektion und People Directory;
   `traegerStudentNames.StudentNamesByTenant` steht deshalb im
   Pass-through-Register. `MembershipPlacementsByTenant` nutzt nur eingebaute
   Typen und erfüllt den Port direkt. Der Konstruktor hebt das Compose-Budget
   von `modules/peopledirectory/compose` um 13 Zeilen. `traegerview.Overview`
   trägt schon zwölf Methoden; die zwei neuen stehen als `ChildDirectory` in
   `traegerview.Reports`.

## Verworfene Optionen

- **Lesen in der Tenant-Transaktion jeder Schule** über die Kinderliste der
  Schule: je Seite eine Transaktion und eine volle Liste je Schule, bei 100
  Schulen nicht tragbar; Suche und Reihenfolge über Schulen wären nur im
  Speicher möglich.
- **Ein Statement über Personen, Profile, Zugehörigkeiten und Gruppen:** ein
  Join über drei Owner, wie in ADR 0154 und ADR 0214 verworfen, und ein neuer
  `read_projections`-Eintrag, den die Architekturprüfung einem bestehenden
  Paket verweigert (ADR 0151).
- **Alle Kinder in einer Antwort, Suche im Browser:** bei 40.000 Kindern
  mehrere Megabyte Namen je Aufruf und ein Protokolleintrag für Kinder, die
  niemand angesehen hat.
- **Geburtsdatum als Spalte** (Vorschlag aus #4815): Namensgleiche trennt
  schon Schule und Klasse. Ohne Aufgabe, die das Datum braucht, bleibt es
  draußen (Datenminimierung).
- **Recht „Übersicht lesen“:** Das hat jede Rolle im Träger-Büro, auch
  Personal und „nur lesen“. Namen aller Kinder brauchen ein Fachrecht.

## Folgen

- Die Namensabfrage bekommt die IDs aller geführten Kinder der Schulmenge als
  Array. Bei 40.000 Kindern sind das eine Roster-Abfrage und ein Array dieser
  Größe je Seite. Wird das messbar langsam, ist der nächste Schritt eine
  Projektion bei School Membership, kein Join in der Träger-Projektion.
- Den Filter auf die Schulen des Trägers sichert `api/traeger_children_test.go`
  mit einem Kind an der Schule eines anderen Trägers, nicht der Ratchet von
  ADR 0084.
- Je Seite entsteht höchstens ein Protokolleintrag je gezeigter Schule, also
  höchstens 50 Tenant-Transaktionen bei einer Seite mit 50 Schulen.
- Maßgeblich ist der von der API gelieferte Stichtag. Eine offen gelassene
  Liste kann nach Mitternacht noch den Vortag zeigen, bis die gemeinsame
  Datumsprüfung den Wechsel bemerkt (sie prüft einmal pro Minute). Lehnt der
  Server vorher eine Folgeseite oder einen Download wegen des Stichtags ab,
  blendet die Seite die alte Liste aus und lädt neu.
- #4815 kann Vertrags- und Abrechnungsspalten ergänzen, jede von ihrem Owner
  und mit dessen Recht, und den Klick auf ein Kind, sobald es die Kinderakte
  des Trägers gibt. Bis dahin sind die Zeilen nicht anklickbar.
