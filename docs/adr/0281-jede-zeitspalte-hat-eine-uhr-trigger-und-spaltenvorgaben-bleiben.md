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
| `CompletionTimestamp` (`timetable`) | beide, getrennt | `completed_at` ist die Anweisungszeit der Datenbank (`clock_timestamp()`), gelesen nach den eigenen Schreibvorgängen des Abschlusses: Reopen ordnet ihn gegen `updated_at` der Aufsichten (Trigger), der Teilnahmen und der Planzeilen. Teilnahmen und Planzeilen stempeln ihr `updated_at` ebenfalls zur Anweisungszeit, so liegt auch eine Korrektur nach dem Abschluss, deren Transaktion früher begann oder die in derselben Transaktion folgt, danach. Seit dem Nachtrag vom 18.11.2026 stempelt auch der Trigger der laufenden Aufsichten beim Schreiben. Das Reopen-Fenster, das Ende spontaner Blöcke und der Vergleich mit dem Auschecken eines Kindes rechnen mit der Owner-Uhr; der Abschluss legt deren Zeitpunkt als `owner_completed_at` im Snapshot ab. |
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
`users.staff_documents` (`workforce`). Verworfen wird nur, was der Erzeuger
mit seiner eigenen Uhr als „jetzt“ setzt; kein Erzeuger dieser Protokolle
setzt einen früheren Zeitpunkt. Nach Punkt 4 stempelt die Datenbank auch
`audit.guardian_changes` und `audit.attendance_corrections`: Die
Zugriffsliste des Trägers ordnet sie gegen die übrigen Protokolle. Sie endet
an der Datenbankzeit ihrer Leseabfrage, auch für einen Träger ohne Schulen,
dessen Liste nur Ferienanmeldungen zeigt; die Dedup-Abfragen des
Zugriffsprotokolls und das 30-Tage-Fenster der Löschstatistik zählen
ebenfalls auf der Datenbankuhr. Die Änderungen an Einwilligungen
(`audit.student_consent_changes`) behalten den Zeitpunkt des Erzeugers: Eine
Erteilung nennt den Tag, an dem die Einwilligung gegeben wurde, beim Import
den Tag aus der Datei. Nach einem Widerruf ist dieser Eintrag der einzige
Beleg dafür. Ohne Zeitpunkt stempelt die Spaltenvorgabe. Auf der Audit-Uhr
bleiben die Änderungen an Arbeitszeiten (`audit.work_session_edits`), die
mit ihrer Sitzung gelöscht werden.

Grenze: Die Sicht `audit.time_tracking_audit_log` mischt drei Uhren und
ordnet nach `occurred_at`. Die Datenbank stempelt die Löschungen
(`audit.time_tracking_deletions`) und die Personalnummern
(`audit.personnel_number_changes`), die Audit-Uhr die Änderungen an
Arbeitszeiten, die Uhr von `workforce` die übrigen Zweige: Abwesenheiten
(`changed_at`), Saldo-Korrekturen und Urlaubseröffnungen (`decided_at`),
Monatsabschluss und Wiedereröffnung (`closed_at`, `reopened_at`),
Urlaubsanspruch und Kontingente (`created_at`). Diese Zweige ziehen erst mit
einem eigenen Schnitt von `workforce` um. Im Betrieb gehen die Uhren gleich;
nur bei auseinanderlaufenden Uhren kann ein Eintrag vor einem früheren
stehen.

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

## Nachtrag 2026-11-17: Der Änderungsverlauf der Elternanfragen liegt auf der Datenbankuhr

Der Verlauf unter „Änderungsanfragen“ ordnet fünf Quellen nach einem
Zeitpunkt und blättert mit ihm: Betreuungszeiten und Entschuldigungen nach
`updated_at`, das der Trigger stempelt, Stammdaten und Angebote nach
`updated_at` ohne Trigger, direkte Korrekturen der Buchung nach
`audit.enrollment_offering_adjustments.changed_at`. Nach Punkt 4 tragen alle
die Uhr der Trigger, denn diese Seite zieht nur mit einer Migration um. Jeder
Schreiber setzt `updated_at = DEFAULT` oder lässt die Spalte aus;
`changed_at` stempelt die Spaltenvorgabe.

`reviewed_at` bleibt auf der Uhr des Owners. Die Elternansicht „kürzlich
entschieden“ filtert entschiedene Betreuungs- und Entschuldigungsanfragen
danach, mit einer Grenze derselben Uhr; offene Anfragen zeigt sie unabhängig
davon. Jeder Endzustand stempelt `reviewed_at`: Entscheidung mit und ohne
entscheidende Person, Korrektur, „erledigt“ und `care_ended`. Ältere Zeilen
ohne `reviewed_at` (Entscheidungen ohne entscheidende Person vor dieser
Änderung) fallen aus dem höchstens zwei Monate langen Fenster; ein Rückfall
auf `updated_at` würde zwei Uhren vergleichen.

Die Korrektur einer Abholänderung ordnet keine Zeitstempel. Die Entscheidung
liest Abholzeit, Abholart und die Abholnotiz der Tagesperson, die sie
geschrieben hat, in ihrer Transaktion zurück und legt im
Entscheidungsprotokoll neben der ID eine Version ab: `updated_at` auf
Mikrosekunden und alle Felder, die das Team ändern kann (bei Abholzeit und
Abholart samt Datum, bei der Notiz Datum oder Wochentag und Text). Die
Korrektur nimmt eine Zeile nur zurück, solange die Version gleich ist. Der
Start einer Transaktion folgt nicht der Reihenfolge der Commits: Eine
Änderung des Teams, deren Transaktion vor der Genehmigung begann und nach ihr
schrieb, trägt den älteren Stempel und wird trotzdem erkannt; die
Inhaltsfelder fangen auch einen Schreiber, der `updated_at` nicht vorrückt.

Einträge ohne Version, geschrieben vor dieser Änderung, behalten genau die
Prüfung, unter der sie entstanden: Abholzeit und Abholart gelten als
geändert, wenn `updated_at` der Zeile nach `reviewed_at` der Anfrage liegt
(ohne `reviewed_at` keine Prüfung); die Notiz löscht die Korrektur ohne
Prüfung. Ein Vergleich mit `updated_at` der Anfrage wäre für sie falsch: Die
alte Genehmigung stempelte eine aktualisierte Abholzeit mit der Owner-Uhr
nach dem Start ihrer Transaktion, der Trigger der Anfrage mit dem Start
selbst. Eine unberührte Zeile liegt dann zwischen beiden Stempeln. Die
bekannten Grenzen dieser alten Prüfung bleiben für diese Einträge:
überlappende Transaktionen, Uhren auseinander, die ungeprüfte Notiz.

## Nachtrag 2026-11-17: Geänderte Vertragsbedingungen erkennt der Träger am Text, nicht an der Zeit

Die Vertragsvorbereitung unterscheidet „Zustimmung passt nicht zum Vertrag“
(`acceptance_changed`) von „Zustimmung fehlt“
(`acceptance_missing`), wenn der angekreuzte Bedingungsblock nicht den
aktuellen Bedingungen der Vorlage entspricht. Bisher ordnete sie dafür
`updated_at` der Vorlage (`care_contract.contract_templates`, Trigger) gegen
den Zeitpunkt des Ankreuzens, den Enrollment mit seiner Uhr stempelt. Das
sind zwei Uhren (Punkt 4).

Enrollment kann die Fassung der Vorlage beim Ankreuzen nicht festhalten: Der
Block ist ein freier Rechtsblock, den die Schule in ihr Formular kopiert,
ohne Verweis auf eine Vorlage. Die Vorlage liegt in der Träger-Transaktion,
das Ankreuzen in der Schul-Transaktion (ADR 0105), und Care Contract liest
schon von Enrollment; ein Lesen in Gegenrichtung schlösse einen Zyklus
(ADR 0058). Deshalb hält Care Contract die Fassungen selbst fest: Jede
Speicherung einer Vorlage, einzeln oder beim Ausrollen des Katalogs, legt im
Protokolleintrag `template` unter `acceptance_texts` alle Bedingungstexte
dieser Fassung ab (alle Wortlaute aus `acceptanceTexts`). Gleicht der
angekreuzte Text einer gespeicherten Fassung,
die die Vorlage nicht mehr hat, sind die Bedingungen geändert; sonst fehlt
die Zustimmung. Kein Zeitpunkt wird geordnet.

Grenzen:

- Vorlagen, deren Protokoll eine Speicherung ohne `acceptance_texts` hat
  (gespeichert vor dieser Änderung), behalten zusätzlich die alte Prüfung:
  geändert, wenn `updated_at` der Vorlage nach dem Ankreuzen liegt. Für sie
  bleibt der bekannte Fehler bei auseinanderlaufenden Uhren, solange der
  angekreuzte Text nur aus einer Fassung vor dieser Änderung stammt.
  Wir behalten diese Prüfung dauerhaft für die alten Einträge (#7383).
  Die früheren Speichervorgänge protokollieren den Wortlaut nicht. Ein
  Nachtrag aus der heutigen Vorlage würde eine Fassung als damals gültig
  ausgeben, für die der Nachweis fehlt. Sobald der angekreuzte Text einer
  protokollierten Fassung oder der aktuellen Vorlage gleicht, entscheidet
  der Textvergleich in der Verlängerung und beim Erstellen des Vertrags.
- Kreuzen Eltern einen Text an, den die Vorlage schon vor dem Ankreuzen
  ersetzt hatte (die Schule hat ihr Formular nicht nachgezogen), lautet der
  Grund jetzt „Zustimmung passt nicht zum Vertrag“ statt
  „fehlt“. In beiden Fällen entsteht kein Vertrag. Der Text sagt nur, was
  beide Zweige belegen, auch die alte Prüfung über `updated_at`: Der
  angekreuzte Text ist nicht der aktuelle. Ob er eine frühere Fassung war,
  wann sie ersetzt wurde und wer das Formular nicht nachgezogen hat,
  behauptet er nicht.

## Nachtrag 2026-11-18: Laufende Aufsichten stempeln beim Schreiben

Für [#7383](https://github.com/moto-ogs/project-phoenix/issues/7383)
stempelt der Trigger von `active.group_supervisors` Änderungen mit
`clock_timestamp()`. Wartet eine ältere Transaktion bis nach dem
Abschluss, liegt ihr Schreibstempel nach `completed_at`. Reopen erkennt
die Änderung auf derselben Datenbankuhr wie Änderungen an Teilnahmen und
Planzeilen. Die Migration stellt beim Rollback den früheren Trigger wieder
her.

## Nachtrag 2026-11-18: Das Arbeitszeitprotokoll ordnet nach dem Datenbankstempel

Seit #7383 stempelt PostgreSQL beim Schreiben `audit_recorded_at`.
Die bestehende Sicht nimmt diesen Zeitpunkt für Datumsauswahl, Anzeige,
Sortierung und Cursor. Die Wiedereröffnung eines Monats erhält ihren
eigenen Stempel. Gruppen aus mehreren Feldänderungen oder Monatsabschlüssen
behalten ihren bisherigen Gruppenschlüssel und zeigen den ersten
Datenbankstempel der Gruppe. Arbeitsdaten, Entscheidungszeit und die Zeit
des ursprünglichen Monatsabschlusses bleiben in ihren bisherigen Spalten.

Altzeilen haben keinen solchen Stempel. Ihre gespeicherten Zeiten bleiben
sichtbar und dienen weiterhin der Sortierung. Ein Nachtrag könnte den
Zeitpunkt der ursprünglichen Schreibanweisung nicht rekonstruieren.
