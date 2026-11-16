---
status: accepted
---

# Der Lohnexport des Trägers bucht jede Art des Arbeitsvertrags mit eigenen Lohnarten

Entscheidung vom 15.11.2026 für
[#4712](https://github.com/moto-ogs/project-phoenix/issues/4712), Etappe 4 der
Spec [#4611](https://github.com/moto-ogs/project-phoenix/issues/4611)
(Stories 109, 110 und 111). Sie setzt
[ADR 0089](0089-personal-wird-beim-traeger-gefuehrt-und-in-der-schule-eingesetzt.md)
Abschnitt 1 (Übungsleiter und Ehrenamt) und Abschnitt 11 (Exporte) um und
nimmt die Entscheidungen E7 und E8 vom 13.11.2026 aus #4712 auf. Sie baut auf
[ADR 0243](0243-monatsabschluss-des-traegers-ist-der-abschluss-jeder-schule.md)
auf.

## Kontext

- Die Schule hat einen DATEV-Lohnexport (LODAS und Lohn und Gehalt, #1417 2b)
  mit Lohnarten, Berater- und Mandantennummer als Schul-Einstellungen. Seit
  ADR 0243 lässt er die Personen aus, deren Monat der Träger abschließt (E6).
  Für sie gab es bisher keine Lohndatei.
- Ein Arbeitsvertrag hatte die Arten Teilzeit, Vollzeit und Minijob.
  Übungsleiter und Ehrenamt fehlten (ADR 0089, Folgen).
- E7: Lohnexport nur als Download (ADR 0089 Abschnitt 11). E8: eigene Berater-
  und Mandantennummer für den Lohn, getrennt von der Buchhaltung (#4694).
- Workforce schreibt und liest Träger und Schule nie in einer Transaktion
  (ADR 0105).

## Entscheidung

1. **Zwei neue Arten.** Ein Arbeitsvertrag kann `uebungsleiter`
   (Übungsleiterpauschale, § 3 Nr. 26 EStG) und `ehrenamt`
   (Ehrenamtspauschale, § 3 Nr. 26a EStG) sein. Die Arten gibt es nur beim
   Träger; die Art einer Beschäftigung in der Schule bleibt unverändert.
2. **Getrennt abrechnen heißt eigene Lohnarten je Art.** Die Lohndatei bucht
   dieselben sieben Kategorien wie die Datei der Schule (Regelarbeit,
   Plus-Stunden, Auszahlung, Freizeitausgleich, Krank, Urlaub, Fortbildung).
   Jede Kategorie hat je Art eine eigene Lohnart. Zwei Verträge einer Person
   mit verschiedener Art ergeben so getrennte Zeilen, zwei Verträge derselben
   Art eine Zeile.
3. **Träger-Werte, keine Schul-Werte.** Berater- und Mandantennummer des
   Lohns, die 35 Lohnarten und die Einheit der drei Tageskategorien sind
   Einstellungen mit Ebene `traeger` und dem Recht „Personal“
   (`traeger_payroll.*`, ADR 0086). Sie sind getrennt von
   `parent_billing.datev_*` (E8) und von den Lohnwerten der Schule
   (`payroll.*`). Alle sind leer voreingestellt, wie in der Schule. Eigene
   Lohnarten und Zuschläge einer Schule (#4807) gelten in der Datei des
   Trägers nicht.
4. **Wer in der Datei steht.** Jeder Arbeitsvertrag, der an einem Tag des
   Monats läuft, mit jedem Einsatzort, dessen Soll bis zum Monatsende beginnt.
   Das sind dieselben Bedingungen wie `TraegerKeptStaffByMonth`: Die Datei
   des Trägers enthält genau die Beschäftigungen, die die Datei der Schule
   auslässt. Endet an einer Beschäftigung ein Vertrag im Monat und beginnt
   dort ein neuer, bucht der neuere Vertrag den ganzen Monat dieser
   Beschäftigung. Die Schule rechnet ihren Monat als eine Summe; eine
   Aufteilung nach Tagen gäbe es nur mit einer zweiten Monatsrechnung. Die
   Prüfung nennt die Person, damit das Lohnbüro den Wechsel sieht. Eine
   Beschäftigung, die die Schule nach dem Monat beendet hat, bleibt in der
   Datei: Der letzte Monat einer Person wird nach ihrem Austritt abgerechnet.
5. **Rechnen in der Schule, summieren beim Träger.** Workforce liest Verträge
   und Akten in der Träger-Transaktion, dann je Schule in ihrer
   Tenant-Transaktion den Monat ihrer Beschäftigungen mit dem Prefetch und
   der Monatsrechnung der Schul-Datei. Vorher steht der Eintrag im
   Zugriffsprotokoll der Schule; scheitert er, entsteht weder Prüfung noch
   Datei. Der Träger summiert einen Vertrag über seine Einsatzorte. Die
   Abfragezahl wächst mit den Schulen, nicht mit den Personen.
6. **Eine Datei, ein Format.** LODAS und Lohn und Gehalt schreibt dieselbe
   Funktion für Schule und Träger (`domain.WriteDatevLodas`,
   `domain.WriteDatevLug`). Die Golden-Dateien prüfen die Datei des Trägers.
7. **Erst prüfen, dann laden.** Die Seite zeigt vor dem Download dieselbe
   Rechnung als Prüfung: Verträge je Art, Zeilen, Werte ohne Lohnart, Schulen
   mit offenem Monat. Personen ohne Personalnummer, LODAS ohne Berater- oder
   Mandantennummer und keine einzige Lohnart verhindern die Datei
   (`workforce.traeger_payroll_not_ready`, ADR 0089 Abschnitt 4). Ein offener
   Monat warnt nur, wie in der Schule.
8. **Zeitexport als festes CSV.** Eine Zeile je Personalnummer, Tag und
   Einsatzort mit `Personalnummer;Nachname;Vorname;Datum;Einsatzort;Beginn;
   Ende;Pause_Minuten;Ist_Minuten;Abwesenheit;Abwesenheitsart`. Datum ISO,
   Uhrzeit HH:MM in Berliner Zeit, Dauern in ganzen Minuten, UTF-8 mit BOM.
   Beginn ist der erste Block, Ende der letzte, Pause die erfassten Pausen
   und die Lücken zwischen Blöcken, Ist die angerechnete Zeit. Ein laufender
   Block lässt das Ende leer. Eine Abwesenheit steht an jedem Tag ihres
   Zeitraums, wie im Nachweis-Export der Schule. `Abwesenheit` ist die Grundart (`vacation`,
   `sick`, …), `Abwesenheitsart` der Name der Schule. Personen ohne
   Personalnummer fehlen in der Datei; die Prüfung nennt sie, und ihr Zugriff
   steht wie der der anderen im Protokoll ihrer Schule. Externe
   Betreuungskräfte erfassen keine Zeit und fehlen wie in der Lohndatei. Die
   Spalten
   stehen in der Hilfe und ändern sich nur mit einer neuen Fassung dieser
   Beschreibung.
9. **Lesen ohne Durchreicher.** Die Schulseite ist
   `workforce.TraegerStaffExportSchool`, gebunden aus Übersicht und
   Arbeitszeiten der Zeiterfassung ohne eigene Weiterleitungsmethoden. Die
   Träger-Werte liest der Root über `TraegerTexts` wie die DATEV-Werte der
   Elternabrechnung.

## Verworfene Optionen

- **Eine Lohnart je Art nur für die Regelarbeit:** Urlaub und Krank eines
  Minijobs laufen in DATEV über eigene Lohnarten. Eine gemeinsame Lohnart
  vermischte die Arten wieder.
- **Die Lohnwerte der Schule weiterverwenden:** Zwei Schulen mit
  verschiedenen Werten gäben keine eindeutige Datei. ADR 0089 Abschnitt 11
  schließt das aus.
- **Eine eigene Tabelle für die Lohnarten:** Das Einstellungssystem hat
  Ebene, Recht, Protokoll und Prüfung schon. Eine Tabelle müsste das
  wiederholen.
- **Der Zeitexport je Block:** ADR 0089 nennt eine Zeile je Tag und
  Einsatzort. Ein Fremdsystem bucht Tage.
- **Den Zeitexport ohne Personalnummer anhalten:** Die Zeiten der anderen
  Personen braucht der Träger trotzdem. Die Prüfung nennt die fehlenden
  Personen sichtbar.

## Folgen

- Migration `20261116120000_traeger_contract_kinds_volunteer` erweitert die
  Prüfung der Art. Ein Rückbau scheitert, solange ein Vertrag eine neue Art
  hat.
- Neue Routen unter `/traeger/staff-exports` (Recht „Personal“), alle lesend.
- Abfragebudget `api.traeger.staff_payroll_export` = 41 bei zwei Schulen.
- Offen: SFTP oder Versand über Export Transfer (#6861, E7), mehrere
  Arbeitgeber je Träger, eine Zuordnung der CSV-Spalten je Kunde.
