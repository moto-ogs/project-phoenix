---
status: accepted
---

# Care Plan, Communication, Delivery und Scheduler erhalten ihre Uhr von der Wurzel

Entscheidung vom 2026-11-16 für
[#7104](https://github.com/moto-ogs/project-phoenix/issues/7104), Schnitt der
Owner Care Plan, Communication, Delivery und Scheduler Runtime. Sie wendet
[ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md) und
[ADR 0272](0272-die-echte-uhr-wird-nur-in-wurzeln-und-kompositionen-benannt.md)
auf diese vier Owner an und führt keinen neuen Owner ein.

## Kontext

`moduleLiveClockValueBudget` zählte in den vier Ownern 28 Bindungen der
echten Uhr außerhalb ihrer Kompositionen: Care Plan 16, Communication 6,
Delivery 5 und Scheduler Runtime 1. Fast alle hatten dieselbe Form: Ein
Konstruktor in einem Anwendungs-, Adapter- oder HTTP-Paket setzte
`time.Now` oder `calendar.TodayDate`, wenn keine Uhr kam. Mehrere Wurzeln
reichten tatsächlich keine Uhr:

- Die Schülerroute von Care Plan (`careplan/http.ResourceConfig.Now`) und die
  Kinderdokumente samt Unfallanzeigen liefen in Produktion auf der echten Uhr.
- Das Benachrichtigungsteam für Abholänderungen bekam `nil` statt des Tages
  der Wurzel.
- Die Vorschau zum Buchungsmodus entschied auf dem echten Tag.
- Die Elternnachrichten-Repositories bekamen in allen drei Wurzeln `nil`.
- Die Aufbewahrung der Team- und Elternnachrichten rechnete ihre Grenze mit
  der Go-Uhr, obwohl PostgreSQL die Nachrichten und Unterhaltungen stempelt.
  Das Aufräumen der Nachrichtenanhänge stempelte `cleaned_at` mit der
  Go-Uhr und löschte nach `clock_timestamp()`.
- Die PWA-Nutzung stempelte `last_seen_at` mit `NOW()`, ihre Aufbewahrung
  und das Nutzungsfenster des Betreiber-Dashboards rechneten mit der Go-Uhr.
- Elternmitteilungen werden mit der Uhr des Stores veröffentlicht; ob sie
  live sind, ob eine Erklärung offen ist und ob eine Umfrage noch Antworten
  nimmt, entschied aber `NOW()` bzw. `clock_timestamp()`.

`moduleLiveClockBudget` führte für Care Plan einen benannten direkten Aufruf
(`PickupBaselineQueries.HasBookedOfferingPickupForWeekday`), weil die
öffentliche Methode keinen Tag nennt.

## Entscheidung

1. **Jeder dieser Konstruktoren verlangt seine Uhr**, außer den Diensten
   der Nachrichtenaufbewahrung (Punkt 7). Fehlt sie, scheitert
   der Bau (Fehler oder Panik, je nach bisherigem Stil des Konstruktors).
   Die Wurzeln reichen `env.Now`/`env.Today`; wo keine Umgebung erreichbar
   ist (Worker-Läufe), bindet die Wurzel die echte Uhr ausdrücklich
   (`clockOrReal`).
2. **Care Plans Abholbasislinien lesen den Tag ihrer Komposition.**
   `NewPickupBaselines` nimmt die Tagesuhr; die öffentliche Methode
   `HasBookedOfferingPickupForWeekday` bleibt unverändert. Der letzte direkte
   Aufruf in Care Plan entfällt.
3. **Lese-Stores stempeln nicht.** Care Plans Postgres-Store stempelt nur,
   wenn die Komposition ihm per `WithClock` eine Uhr gibt (Pflicht). Ein
   Store ohne Uhr dient nur Lesepfaden; stempelt er doch, ist das ein
   Verdrahtungsfehler und bricht ab. Nur `compose.New` baut den schreibenden
   Store.
4. **Delivery und Scheduler.** Der Notification-Router, die PWA-Nutzung, die
   Webhooks und der Abgleich mit dem Mail-Provider verlangen ihre Uhr; der
   Worker verlangt `WorkerDependencies.Now`. Die benannten Ausnahmen im
   Aufruf-Register (Stream-Recheck, Drop-Log-Intervall, Alter des
   Nutzungs-Snapshots, Lease und Minutentakt des Schedulers,
   Idempotenz-Nanosekunden) bleiben unverändert.
5. **Budgets.** Die Compose-LOC-Budgets bleiben gleich: Die Uhrfelder passen
   in zusammengelegte Importgruppen und einen gekürzten Kommentar.
6. **Wer stempelt, entscheidet.** Jede Entscheidung liest die Uhr, die ihren
   Wert gestempelt hat:
   - Die PWA-Nutzung stempelt `last_seen_at` mit der Uhr des Dienstes.
     `iot.record_pwa_standalone_usage` nimmt dafür den Zeitpunkt des Berichts
     als vierten Parameter (wiederholbare Definition, die alte Fassung mit
     drei Parametern entfällt). Aufbewahrung und Nutzungsfenster rechnen mit
     derselben Uhr.
   - Die Live- und Antwortprüfungen der Elternmitteilungen
     (`liveVersionGuardCTE`, `responseGuardCTE`) und `ReadOpenDeclarations`
     binden einen Zeitpunkt der Store-Uhr statt `NOW()`/`clock_timestamp()`.
7. **Die Aufbewahrung der Nachrichten ist eine benannte Entscheidung der
   Datenbankuhr.** Team- und Elternnachrichten bekommen ihr `created_at` von
   PostgreSQL (`clock_timestamp()` bzw. Spaltenvorgabe), und diese
   Reihenfolge ist die, die Chat und Posteingang zeigen; ein Go-Stempel
   könnte zwei Nachrichten derselben Unterhaltung vertauschen. Deshalb
   stempelt weiter die Datenbank, und die Aufbewahrung zählt ihr Fenster
   auch dort: Die Stores bekommen die Tage und vergleichen mit
   `now() - make_interval(days => ?)`. Die Dienste der Aufbewahrung haben
   keine Uhr mehr (`staffmessaging.Config.Now`, `Retention.Now` und der
   Uhr-Parameter von `NewParentMessageRetention` entfallen). Das Aufräumen
   der Nachrichtenanhänge stempelt `cleaned_at` ebenfalls mit
   `clock_timestamp()`; seine Uhr entfällt.
8. Die 59 Effekt-Bindungen in Care Plan (28), Facilities (10) und
   Timetable (21), deren Körper oder Aufrufspur sich nur durch ihre Uhr
   geändert haben, sind mit dieser ADR neu bestätigt, die 42 Ausnahmen
   darunter per `approval_adr`. Effekt und Einstufung bleiben gleich.

## Folgen

- `moduleLiveClockValueBudget` fällt um 28 Bindungen; die vier Einträge
  entfallen. `moduleLiveClockBudget` verliert den Care-Plan-Eintrag (1 auf 0).
- Die Tests der berührten Owner bauen mit fester Uhr: Care Plans
  Vertragstests auf dem Entscheidungstag 2026-08-24, Delivery und Scheduler
  auf festen Instants weit vom echten Tag.
- Die Tests der Nachrichtenaufbewahrung altern ihre Zeilen per SQL relativ
  zur Datenbankuhr und brauchen keine Go-Uhr. Mit einer Uhr der Wurzel weit
  vom Tag der Datenbank entscheiden PWA-Nutzung, Live-Prüfungen und
  Aufbewahrung jetzt gleich; Tests mit einer Uhr im Jahr 2031 belegen es.
- Offen bleibt außerhalb dieser Owner: `parentannouncementaudience`
  vergleicht `published_at` und `expires_at` der Elternmitteilungen weiter
  mit `NOW()`.
