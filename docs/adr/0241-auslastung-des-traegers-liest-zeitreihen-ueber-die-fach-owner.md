---
status: accepted
---

# Auslastung des Trägers liest Zeitreihen über die Fach-Owner

Entscheidung vom 15.11.2026 zu
[#4713](https://github.com/moto-ogs/project-phoenix/issues/4713), Etappe 5 der
Spec [#4611](https://github.com/moto-ogs/project-phoenix/issues/4611), User
Stories 113 und 118. Sie folgt
[ADR 0151](0151-schulansicht-des-traegers-liest-ihre-zahlen-ueber-die-fach-owner.md)
und [ADR 0154](0154-belegung-des-traegers-liest-gruppen-und-buchungen-ueber-die-fach-owner.md)
und führt keinen neuen Owner und keine neue Tabelle ein.

## Kontext

Das Träger-Büro will die Auslastung je Standort, Betreuungsangebot und Raum über
einen wählbaren Zeitraum sehen und exportieren, standardmäßig zusammengefasst und
personenscharf nur mit Recht. Die Belegung (ADR 0154) zeigt nur heute. Die
Angaben liegen bei vier Owners: Buchungen und Angebote bei Care Plan, die
Verbindung einer Buchung zum Kind bei Enrollment, Ein-Checken und Raumbesuche bei
Student Presence, Räume und ihre Plätze bei Facilities. Schul-Settings lassen sich
in der Admin-Einheit der Projektion nicht lesen (ADR 0175).

## Entscheidung

1. **Lesen über die Owner wie in ADR 0154.** Die Projektion liest in ihrer
   Admin-Einheit je Owner eine Abfrage für die ganze Schulmenge:
   - Care Plan `TraegerCareBookingIntervals`: Angebote, die als Betreuung zählen,
     mit ihren Buchungen, die das Fenster berühren, dazu die aktiven Angebote der
     laufenden Phasen.
   - Enrollment `BookedChildren` (bestehend): Kind je angenommenem Anmeldekind
     und die laufenden Phasen.
   - Student Presence `PresenceSeries`: Kinder mit Ein-Checken je Schule und Tag
     und je Raum und Tag die Kinder mit Besuch und die Höchstbelegung.
   - Facilities `TraegerRooms`: Räume mit Name und Plätzen, auch archivierte.
   Jede Abfrage filtert mit `tenant_id = ANY(?)` auf die übergebenen Schulen und
   verweigert ohne die Admin-Einheit. Die Antworten tragen Zahlen und die Namen
   von Angeboten und Räumen, keine Kinder. Das Budget
   `api.traeger.schools_utilization` liegt bei 8 Statements, flach in der Zahl
   der Schulen.
2. **Definitionen.** Sie stehen an `traegerview.Utilization`:
   - Tage sind Montag bis Freitag des Fensters, höchstens 366 Tage, Ende
     spätestens heute. Das gilt auch für eine Schule, deren Wochenende dem Plan
     vom Freitag folgt (#3921): Die Reihen aller Schulen haben dieselben Tage
     und bleiben vergleichbar, und die Projektion liest keine Einstellung einer
     Schule (ADR 0175).
   - Gebucht folgt der Regel der Belegung: eine Buchung gilt ab `valid_from`
     und bis vor `valid_until`, ein Kind zählt je Angebot einmal und je Schule
     einmal über alle Angebote. Plätze sind die Summe der Grenzen der Angebote
     mit Grenze; belegte Plätze die gebuchten Kinder dieser Angebote. Ein
     aktives Angebot der laufenden Phase ohne Buchung zählt nur in einem
     Fenster, das bis heute reicht. In einem vergangenen Fenster gab es dieses
     Angebot noch nicht; mit seinen Plätzen sähe jedes Vorjahr leerer aus.
   - Anwesend und Raumzahlen gelten nur für abgeschlossene Tage. Ein Tag ohne
     ein einziges Ein-Checken (oder ohne Raumbesuch) an der Schule hat keine
     Zahl statt einer 0; ebenso jeder Tag vor dem ersten gespeicherten Tag.
   - Raumbesuche zählen wie in der Raumauslastung der Statistik nur für Kinder
     mit angenommener Datenschutzeinwilligung und innerhalb ihrer Frist. Eine
     Schule mit ausgeschaltetem Anwesenheitsprotokoll behält nur die Besuche von
     heute und zeigt deshalb keine Räume, wie ihre eigene Statistik.
3. **Rechte.** Die Zahlen brauchen „Berichte lesen“ (`traeger_reports:read`).
   Die Kinder einer Schule mit Namen
   (`GET /traeger/schools/{id}/utilization/children`) brauchen „Verträge
   verwalten“ (`traeger_contracts:manage`), dasselbe Recht wie die Namen von Soll
   und Ist (ADR 0156); ein neues Recht ist nicht nötig. Eine Schule eines anderen
   Trägers antwortet wie in der Schulansicht mit 404 `traeger.school_not_found`.
4. **Protokoll.** Die zusammengefassten Zahlen und ihr CSV-Export stehen nach ADR
   0084 Abschnitt 7 nicht im Zugriffsprotokoll. Die Kinder mit Namen liest die
   Wurzel aus dem Statistikbericht der Schule (Bereich Anwesenheit) in deren
   Tenant-Transaktion; der Bericht schreibt die Lesung mit dem Konto des
   Träger-Büros und der Rolle `traeger` ins Zugriffsprotokoll der Schule. So gibt
   es keine zweite Definition von Betreuungstag und Anwesenheitsquote. Die
   Seite fragt die Namen erst ab dem ersten Check-in der Schule im Fenster an:
   Davor fehlt jede Anwesenheit, und der Bericht zählte jeden Betreuungstag als
   Fehltag ohne Grund. Ohne Check-in im Fenster bietet sie keine Namen an.
5. **Wurzel und Register.** `api/traeger_utilization_ports.go` übersetzt die
   Antworten der Owner in die Werte der Projektion.
   `traegerPresenceSeries.AttendanceCountsByTenant` und
   `traegerRoomNames.RoomsByTenant` stehen deshalb im Pass-through-Register,
   wie `traegerGroupNames.GroupsByTenant` nach ADR 0154. Die Konstruktoren
   heben die Compose-Budgets von `modules/careplan/compose` und
   `modules/studentpresence/compose` um je 7 Zeilen und von
   `modules/facilities/compose` um 13 Zeilen, zusammen um 27 Zeilen.

## Verworfene Optionen

- **Tägliche Verdichtung in einer eigenen Tabelle:** hielte Raum- und
  Anwesenheitszahlen über die Löschfristen der Schule hinaus. Das ist eine
  Entscheidung über Aufbewahrung nach ADR 0073, die keine Quelle trifft, und
  bräuchte Löschregeln, einen Nachtlauf und Seed-Daten. Die Projektion liest
  stattdessen, was die Schule noch hat, und nennt den ersten Tag.
- **Je Schule den Statistikbericht aufrufen, wie Soll und Ist (ADR 0156):**
  kostet je Schule eine Tenant-Transaktion mit rund zehn Statements und kennt
  keine Betreuungsangebote. Für die Namen ist es richtig, für die Zahlen nicht.
- **Ein neues Recht für personenscharfe Auswertungen:** hätte jede Träger-Rolle
  neu zu verteilen. Die Rolle, die Verträge führt und mit Familien über Buchungen
  spricht, hat „Verträge verwalten“ schon.

## Folgen

- Raumzahlen reichen höchstens so weit zurück wie die Frist der Einwilligung
  (1 bis 31 Tage), Anwesenheit so weit wie `gdpr.attendance_retention_days`. Die
  Seite nennt den ersten Tag mit Daten.
- Den Filter der neuen Abfragen sichert
  `api/traeger_schools_utilization_test.go` mit einer Schule eines anderen
  Trägers, nicht der Ratchet von ADR 0084.
- Eine Schule mit wochenplangeführter Betreuung kann Kinder anwesend zeigen,
  die nicht gebucht sind; Anwesend kann deshalb über Gebucht liegen.
