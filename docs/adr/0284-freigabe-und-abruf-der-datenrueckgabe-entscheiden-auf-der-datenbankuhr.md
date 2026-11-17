---
status: accepted
---

# Freigabe und Abruf der Datenrückgabe entscheiden auf der Datenbankuhr

Entscheidung vom 2026-11-17 für
[#7295](https://github.com/moto-ogs/project-phoenix/issues/7295). Sie führt
[ADR 0274](0274-wurzeltests-lesen-feste-tage-und-die-datenrueckgabe-bleibt-auf-der-datenbankuhr.md)
Punkt 3 fort und wendet
[ADR 0281](0281-jede-zeitspalte-hat-eine-uhr-trigger-und-spaltenvorgaben-bleiben.md)
Punkt 3 an: Eine Entscheidung vergleicht auf der Uhr, die die Spalte
stempelt oder begrenzt.

## Kontext

ADR 0274 hielt die Funktionen der Migrationen 1.15.917 und 1.15.919 auf der
Datenbankuhr: `platform.data_return_issue` begrenzt `keep_until` und
`expires_at` gegen `now()`. Go entschied daneben mit der Uhr des Prozesses.
`Release` und `Grant` leiteten `expires_at` aus `time.Now` ab und prüften
`keep_until` dagegen, der Abruf prüfte den Ablauf eines Tokens ebenso und
stempelte `started_at` und `finished_at` der Abrufe. Lief die Uhr des Rechners
einen Monat zurück, lehnte die Funktion jedes neue Token als abgelaufen ab;
bei Abweichung schloss der Abruf früher oder später, als die Funktion es
begrenzt hatte. Die Tests verdeckten das, weil sie der Freigabe eine Uhr aus
der Datenbank gaben, die die Produktion nicht verwendet.

## Entscheidung

1. Freigabe, weitere Freigabe und Abruf entscheiden auf der Datenbankuhr.
   Der Adapter liest `now()` einmal je Entscheidung (`databaseNow`); aus
   diesem Zeitpunkt entstehen `expires_at` und die Prüfung von `keep_until`.
2. `countDownload` zählt einen Abruf nur bei `expires_at > now()`;
   `started_at` stempelt die Spaltenvorgabe, `finished_at` stempelt `now()`.
   Der Abruf und `compose.NewDataReturn` erhalten keine Uhr mehr.
3. Nur das Aufräumen verwaister Dateien im Ablageverzeichnis bleibt auf der
   Uhr des Rechners: Es vergleicht die Änderungszeit der Dateien, die das
   Dateisystem mit dieser Uhr stempelt.

## Folgen

- `moduleSQLClockBudget["modules/organizationtenancy"]` steigt von 11 auf 14
  (`databaseNow`, die Ablaufprüfung in `countDownload`, `finished_at`).
- Tests verdrahten die Freigabe wie die Produktion mit `time.Now`; nur den
  Abrufzeitraum, den die Datenbank begrenzt, legen sie mit
  `testpkg.DatabaseNow` fest.
- `TestReleaseAndRetrievalDecideOnTheDatabaseClock` hält die Entscheidung mit
  einer Rechneruhr einen Monat vor und zurück.
