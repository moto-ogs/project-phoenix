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
5. **Abhängigkeitsrichtung:** `day-changes-view` → Quell-Module, nie
   umgekehrt. Die Projektion importiert kein Quell-Modul. Sie hängt nur von
   Plattformmodulen ab (Tenant Runtime, Transaction Runtime, Security
   Runtime). Die Root übersetzt zwischen den Ports und den öffentlichen
   Fähigkeiten der Quellen. Kein Fachmodul hängt von der Projektion ab; die
   Policy verbietet das seit Epoche 91 (ADR 0071, #4540). Nur Roots binden
   sie. Damit entsteht kein Zyklus.
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
