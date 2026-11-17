---
status: accepted
---

# Jede Zeitspalte hat eine Uhr; Trigger und Spaltenvorgaben bleiben

Entscheidung vom 2026-11-16 für
[#7295](https://github.com/moto-ogs/project-phoenix/issues/7295). Sie führt
[ADR 0280](0280-die-datenbankuhr-in-abfragen-ist-gezaehlt-und-waechst-nicht.md)
fort: Dort ist die Datenbankuhr in Abfragen gezählt, hier steht, was mit
Triggern und Spaltenvorgaben geschieht und wie die sechs offenen Paare
entschieden sind.

## Kontext

ADR 0280 lässt Migrationen außerhalb des Registers. Offen blieb, ob die
Trigger `update_modified_column()` und die Vorgaben `DEFAULT NOW()` der
Owner-Uhr folgen sollen. Der Bestand auf `development` `e93e86fb67`:

- 163 Tabellen tragen den Trigger. Er überschreibt `updated_at` bei jedem
  `UPDATE`, auch wenn Go einen Wert bindet.
- Knapp die Hälfte der 802 Lesezugriffe des Registers sind
  `default:`-Angaben in bun-Tags. bun sendet für ein leeres `nullzero`-Feld auf PostgreSQL
  `DEFAULT`, mit und ohne diese Angabe; sie wirkt nur in `CREATE TABLE`, das
  hier kein Code ausführt.
- Die sechs Paare aus ADR 0280 entscheiden auf zwei Uhren, weil eine Seite
  eine Spalte stempelt und die andere sie mit der anderen Uhr vergleicht.

## Entscheidung

1. **Trigger und Spaltenvorgaben bleiben.** Sie stempeln auch Schreibwege,
   die nicht durch Go laufen: Migrationen, Datenbankfunktionen, Rückfüllungen.
   Ein Abbau träfe 163 Tabellen und jede Schreibstelle, ohne dass eine
   Entscheidung richtiger würde.
2. **Jede Zeitspalte hat genau eine Uhr.**
   - Trägt die Tabelle den Trigger, gehört `updated_at` der Datenbank. Go
     bindet dort keinen Wert, auch nicht beim Anlegen.
   - Liest eine Entscheidung eine Spalte ohne Trigger auf der Owner-Uhr,
     bindet der Owner den Stempel bei jedem `INSERT` und `UPDATE`. Die
     Vorgabe bleibt als Netz für Schreibwege ohne Go.
3. **Eine Entscheidung vergleicht auf der Uhr, die die Spalte stempelt.**
   Gegen eine von der Datenbank gestempelte Spalte rechnet die Abfrage mit
   der Datenbankuhr. Das ist die benannte Ausnahme aus ADR 0280 Punkt 3 und
   steht mit Grund über dem Budget-Eintrag.
4. **Zeilen, die gegeneinander geordnet werden, tragen dieselbe Uhr.** Wer
   einen Stempel mit dem `updated_at` einer Trigger-Tabelle vergleicht,
   nimmt ihn von der Datenbank.
5. **`default:`-Angaben in bun-Tags werden entfernt**, sie sind keine
   Ausnahme. Ein Feld ohne `nullzero` erhält `nullzero` dafür, sonst schriebe
   bun den Nullwert statt `DEFAULT`.

## Die sechs Paare

| Paar | Uhr der Entscheidung | Änderung |
|---|---|---|
| Zustell-Protokolle (`delivery`) | Owner | Der Store stempelt `created_at` und `updated_at` selbst. |
| Zielgruppen der Elternmitteilungen (`parentannouncementaudience`) | Owner | Die Abfragen erhalten den Zeitpunkt als Parameter. |
| Abgeschlossene Abmeldungen (`careplan`) | Owner | Die Grenze kommt als Parameter. Sie bleibt 365 Berliner Kalendertage, wie `TestNightlyRetentionCleanupCutoffsAcrossDST` sie vorschrieb, hängt aber nicht mehr an der Zeitzone der Sitzung. Dasselbe gilt für die Offboarding-Jobs von `workforce` (30 Tage). |
| `CompletionTimestamp` (`timetable`) | beide, getrennt | `completed_at` ist die Anweisungszeit der Datenbank (`clock_timestamp()`), gelesen nach den eigenen Schreibvorgängen des Abschlusses: Reopen ordnet ihn gegen `updated_at` der Aufsichten (Trigger), der Teilnahmen und der Planzeilen. Teilnahmen und Planzeilen stempeln ihr `updated_at` ebenfalls zur Anweisungszeit, so liegt auch eine Korrektur nach dem Abschluss, deren Transaktion früher begann oder die in derselben Transaktion folgt, danach. Aufsichten stempelt der Trigger mit dem Transaktionsbeginn; eine überlappende Änderung an ihnen bleibt unerkannt wie bisher. Das Reopen-Fenster, das Ende spontaner Blöcke und der Vergleich mit dem Auschecken eines Kindes rechnen mit der Owner-Uhr; der Abschluss legt deren Zeitpunkt als `owner_completed_at` im Snapshot ab. |
| Umfrage-Entwürfe (`communication`) | Datenbank | `users.surveys` trägt den Trigger. Die Aufbewahrung der Entwürfe vergleicht `updated_at` mit der Datenbankuhr; veröffentlichte Umfragen bleiben über `closes_at` auf der Owner-Uhr. |
| Nummern-Ereignisse (`parentbilling`) | Owner | Der Store stempelt die Protokolle `family_billing_events` und `child_debtor_number_events` an jeder Schreibstelle selbst. Ihr Alter vergleicht die Löschung mit der Grenze des Löschtags, Mitternacht in Berlin, wie die Nummern selbst. |

Zustell-Protokolle und Nummern-Ereignisse stempelte beide eine Vorgabe ohne
Trigger. Zuerst war nur der Store von `delivery` mit der Owner-Uhr
entschieden; `parentbilling` blieb auf der Datenbankuhr, weil sein Store
keine Uhr trug. Der Owner-Schnitt von #7295 gibt ihm seine Uhr, und damit
gehen die Protokolle wie die Nummern am Tag der Owner-Uhr. Auf der
Datenbankuhr bleiben in `parentbilling` nur Spalten, die eine
Datenbankfunktion stempelt oder vergleicht oder die gegen Stempel von
Spaltenvorgaben oder anderer Owner geordnet werden; sie stehen mit Grund
über dem Budget-Eintrag.

## Folgen

- Die Aufbewahrung der Abmeldungen und Offboarding-Jobs ist mit fester Uhr
  prüfbar; ihre Tests stellen die Uhr auf die Tage der Zeitumstellung.
- Wo die Datenbank stempelt, altern Testzeilen über `UPDATE` mit
  abgeschalteten Triggern (`session_replication_role = replica`), nicht über
  die Go-Uhr.
- Nicht berührt: die Zielgruppen der Team-Mitteilungen
  (`staffannouncementaudience`). Dort stempelt die Datenbank `published_at`,
  und die Abfrage ordnet ihn gegen `created_at` von Schule, Mitgliedschaft und
  Konto. Sie wechselt erst, wenn diese Owner ihre Stempel selbst binden.
- Die bun-Tags und die reinen Schreibstempel folgen je Owner in eigenen PRs
  von #7295.

## Nachtrag 2026-11-17: Von der Datenbank bewachte Aufbewahrungen liegen ganz auf der Datenbankuhr

Für [#7295](https://github.com/moto-ogs/project-phoenix/issues/7295), wie
schon das Exportjournal (#7325) und die Löschung von Mitarbeitenden (#7327).
Prüft eine Sicherheitsfunktion der Datenbank das Fenster einer Aufbewahrung
mit ihrer eigenen Uhr (`latest_allowed_cutoff` aus `clock_timestamp()`), liegt
die ganze Entscheidung auf der Datenbankuhr:

- Die Spaltenvorgabe stempelt die Spalte in jedem Schreiber. Ein Zeitpunkt,
  den ein Erzeuger setzt, wird verworfen.
- Der Adapter liest die Datenbankzeit einmal je Aufbewahrungslauf in dessen
  Transaktion. Die Regel für Tag oder Jahr bleibt in Go und rechnet von
  dieser Zeit.
- Jedes Paket liest die Datenbankuhr über eine gemeinsame Konstante. Der
  Grund steht über seinem Eintrag in `moduleSQLClockBudget`.

Das gilt für `audit.auth_events`, `audit.data_access_log`,
`audit.data_deletions`, `audit.student_field_edits` (Änderungsprotokoll der
Kinder), die zehn Protokolle von `audit.delete_expired_protocol`,
`audit.unregistered_tag_scans` (`devicefleet`) und die Krankmeldungen in
`users.staff_documents` (`workforce`). Nach Punkt 4 stempelt die Datenbank
auch `audit.guardian_changes`, `audit.student_consent_changes` und
`audit.attendance_corrections`: Die Zugriffsliste des Trägers ordnet sie gegen
die übrigen Protokolle. Sie endet an der Datenbankzeit ihrer Leseabfrage, und
die Dedup-Abfragen des Zugriffsprotokolls zählen Tag und Fenster ebenfalls auf
der Datenbankuhr. Auf der Audit-Uhr bleiben nur die Änderungen an
Arbeitszeiten (`audit.work_session_edits`), die mit ihrer Sitzung gelöscht
werden.

Vergleicht eine Aufbewahrung ein `updated_at`, das der Trigger stempelt,
rechnet dieser Zweig vom Tag der Datenbank (Punkt 3): ausgeschaltete Hinweise
fürs Team (`timetable`) und Entwürfe von Notenübergängen (`schoolstructure`).
Gültigkeitstage und die vom Owner gestempelten Zeitpunkte behalten die
Grenze der Owner-Uhr.

Ohne Wache der Datenbank bleibt es bei Punkt 2: Der Owner stempelt und
schneidet mit seiner Uhr ab.

Noch offen: `audit.delete_expired_deviation_events` bewacht den Kalendertag
der Abweichungen mit dem Tag der Datenbank, die Grenze kommt aber aus der
Stundenplan-Aufbewahrung, die mit derselben Grenze die Stundenplanzeilen
löscht. Sie folgt in einem eigenen Schnitt.
