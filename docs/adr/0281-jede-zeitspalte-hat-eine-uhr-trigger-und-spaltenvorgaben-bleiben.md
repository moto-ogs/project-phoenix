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
| `CompletionTimestamp` (`timetable`) | beide, getrennt | `completed_at` bleibt der Transaktionszeitpunkt der Datenbank: Reopen ordnet ihn gegen `updated_at` der Aufsichten (Trigger) und Teilnahmen. Das Reopen-Fenster, das Ende spontaner Blöcke und der Vergleich mit dem Auschecken eines Kindes rechnen mit der Owner-Uhr; der Abschluss legt deren Zeitpunkt als `owner_completed_at` im Snapshot ab. |
| Umfrage-Entwürfe (`communication`) | Datenbank | `users.surveys` trägt den Trigger. Die Aufbewahrung der Entwürfe vergleicht `updated_at` mit der Datenbankuhr; veröffentlichte Umfragen bleiben über `closes_at` auf der Owner-Uhr. |
| Nummern-Ereignisse (`parentbilling`) | Datenbank | Die Datenbank stempelt die Protokolle `family_billing_events` und `child_debtor_number_events` per Vorgabe. Ihr Alter rechnet die Abfrage mit der Datenbankuhr; die Nummern selbst gehen weiter am Tag der Owner-Uhr. |

Zustell-Protokolle und Nummern-Ereignisse stempelt beide eine Vorgabe ohne
Trigger, und sie sind verschieden entschieden. Der Store von `delivery` trägt
die Owner-Uhr schon und hat eine Schreibstelle. `parentbilling` schreibt seine
Protokolle an rund dreißig Stellen aus Stores ohne Uhr; dort bleibt die
Datenbank die eine Uhr der Spalte, bis der Owner-Schnitt von #7295 dem Store
seine Uhr gibt. Die Ausnahme gilt dem Alter der Einträge: Dass ein Eintrag
erst mit seiner Nummer geht, entscheidet weiter der Tag der Owner-Uhr.

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
