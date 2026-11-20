---
status: accepted
---

# Der Seed schreibt ohne Seed-Routen im Produktionsrouter

Entscheidung vom 2026-11-20 zu
[#2352](https://github.com/moto-ogs/project-phoenix/issues/2352).
Freigegeben von Yannick Wenger am 2026-11-20 (Entscheidung A der
Sammelliste „Zur Entscheidung“ und Option „Demo-only-Routen“).

Sie fügt vier Policy-Regeln, zwei Demo-Routen, eine Transaktionsstelle und
18 Compose-Zeilen hinzu. Sie fügt keinen Owner, kein Datenobjekt und keine
Produktionsroute hinzu.

## Kontext

Zehn Routen rief nur der Demo-Seeder oder der Demo-Simulator auf, keine App,
kein Kiosk und kein Werkzeug. Sie waren im Router jeder Umgebung gemountet,
auch in Produktion. Drei davon schrieben Daten, die kein Client nachträglich
schreiben kann:

- `POST /api/feedback/batch` (mit `GET /api/feedback/date-range` als
  Prüfung) schrieb den Feedbackverlauf der letzten Wochen (#5029).
- `POST /api/timetable/school-vacations/seed` schrieb feste Ferien für jedes
  Bundesland (#5345), damit der Betreuungsplan den Ferienhinweis zeigt.
- `POST /operator/billing/key-date-counts/seed` schrieb eine
  Stichtags-Momentaufnahme für die Operator-Abrechnung.

Die beiden Seed-Routen ließen nur Anfragen mit Seed-Token von `localhost`
unter `APP_ENV` development, test oder demo zu. Sie waren trotzdem
Produktionscode im Produktionsrouter.

Der Sidecar der öffentlichen Demo hat keine Schreibverbindung zur Datenbank
(ADR 0127). `devtools seed` hat sie über `DB_DSN` (ADR 0125, ADR 0190).

## Entscheidung

1. **Die zehn Routen entfallen.** Der Seeder und der Simulator nutzen
   stattdessen Routen, die die Apps selbst aufrufen, wo es eine gibt:
   - Heimgehen im Simulator: `POST /api/students/{id}/school-checkin` mit
     `action: "out"` statt `POST /api/active/visits/student/{id}/checkout`.
   - Ankunfts- und Gehzeiten im Simulator: die Kinderliste
     `GET /api/students?include_arrival_times=true&include_pickup_times=true`
     statt `POST /api/students/arrival-times/bulk` und `…/pickup-times/bulk`.
   - Gelesene Plattform-Ankündigung: `POST …/{id}/dismiss` statt `…/seen`;
     die App kennt nur „schließen“, und die Operator-Statistik zählt beides
     als gesehen.
   - Offene Eltern-Einladungen: der Kontostatus `pending` der Elternliste
     jedes Kindes (`GET /api/guardians/students/{id}/guardians`) statt
     `GET /api/guardians/invitations/pending`.
   - Raumverlauf des manuellen Profils: `GET /api/active/visits` (alle
     Besuche der am selben Tag angelegten Schule) statt
     `GET /api/students/{id}/visit-history`.
   - Vorhandener Feedbackverlauf: der Verlauf des ersten bewerteten Kindes
     (`GET /api/feedback/student/{id}`) statt `GET /api/feedback/date-range`.
2. **Lokal schreibt `devtools seed` über die Owner-Compositions**, wie ADR
   0125 und ADR 0190 es für Anwesenheit und Essen tun, auf der Datenbank von
   `DB_DSN`:
   - Feedback: `compose.NewFeedbackHistory` mit `RecordFeedbackHistory`.
     Der Schreiber ist ein eigener Typ neben dem Service: gleicher Store,
     gleiche Prüfung jeder Bewertung, ein Batch in einer Transaktion der
     Schule im Kontext, nur Tage vor heute, ohne Schalter der Schule und ohne
     Beobachter. Er übernimmt den Batch-Insert von `SubmitBatch`, das
     entfällt; die Budgets `services.feedback.submit_batch.*` messen ihn mit
     unverändertem SQL-Vertrag.
   - Ferien: `SchoolVacationSeed.SeedSchoolVacations` aus
     `schoolcalendar/compose.NewSchoolVacations`.
   - Stichtagszahlen: `BillingReport.SeedBillingKeyDateCounts` aus
     `organizationtenancy/compose.NewBilling`, mit den Zählungen von School
     Membership und Device Fleet wie in der Server-Wurzel.
   Ohne `DB_DSN` lässt der Seed diese Daten aus.
3. **Die öffentliche Demo schreibt Feedbackverlauf und Ferien über
   Operator-Routen, die nur `APP_ENV=demo` mountet** (Muster ADR 0127):
   `POST /operator/schools/{id}/demo-feedback-history` und
   `POST /operator/demo-school-vacations`. Sie stehen hinter der
   Operator-Sitzung; in der Demo hält nur der Sidecar die Zugangsdaten.
   `newDemoOperatorRoutes` baut außerhalb der Demo nichts;
   `TestRouter` (`api/operator_router_test.go`) belegt das für production,
   staging, development und test, und das Router-Golden enthält sie nicht.
4. **Stichtagszahlen entfallen in der öffentlichen Demo.** Nur ein Operator
   sieht sie, Besucher der Demo nie.
5. **Grenzen.** `cmd/devtools` darf genau die Compose-Pakete von Feedback,
   School Calendar, School Membership und Device Fleet einbinden
   (`dev-tools.compose.*`, Policy-Epoche 105). Der Policy-Vergleich lässt
   nur diese vier Formen zu (`reviewedSeedHistoryWritersRule`). Die neue
   Transaktionsstelle `compose/new.go:NewFeedbackHistory` steht exakt im
   Register (`withoutReviewedFeedbackHistoryTransaction`). Die
   Compose-Budgets steigen um 15 Zeilen (Feedback) und 3 Zeilen (School
   Calendar).

## Erwogene Optionen

1. **Die drei schreibenden Routen behalten.** Verworfen: Sie bleiben
   Produktionscode für einen Werkzeugzweck.
2. **Demo ohne Feedbackverlauf und Ferienhinweis.** Verworfen: ADR 0127
   verlangt, dass eingeschaltete Verläufe in der Demo Daten zeigen.
3. **Eine Schreibberechtigung für `phoenix_demo`.** Verworfen wie in ADR 0125
   und ADR 0127.

## Folgen

- Der Produktionsrouter verliert zehn Routen. In der Demo kommen zwei
  Operator-Routen hinzu.
- Ein lokaler Seed ohne `DB_DSN` zeigt keinen Feedbackverlauf, keine
  gesetzten Ferien und keine Stichtagszahlen.
- Der Simulator braucht für Ankunfts- und Gehzeiten eine Anfrage pro 500
  Kinder statt zwei, und für das Heimgehen dieselbe Berechtigung wie die
  Web-Anwesenheit (`users:checkin`).
