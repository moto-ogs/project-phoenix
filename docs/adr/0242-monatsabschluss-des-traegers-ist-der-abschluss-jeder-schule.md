---
status: accepted
---

# Der Monatsabschluss des Trägers ist der Abschluss jeder Schule

Entscheidung vom 15.11.2026 für
[#4711](https://github.com/moto-ogs/project-phoenix/issues/4711), Etappe 4 der
Spec [#4611](https://github.com/moto-ogs/project-phoenix/issues/4611) (Story 108).
Sie setzt [ADR 0089](0089-personal-wird-beim-traeger-gefuehrt-und-in-der-schule-eingesetzt.md)
Abschnitt 10 um und nimmt die Entscheidung E6 vom 13.11.2026 aus #4711 auf.
Sie präzisiert die Tabelle in ADR 0089 Abschnitt 3 („Stundenkonto-Buchungen und
Monatsabschluss je Arbeitsvertrag beim Träger“) und die Folgen von
[ADR 0237](0237-arbeitsvertrag-des-traegers-spiegelt-das-soll-in-die-zeiterfassung-der-schule.md).

## Kontext

- E6: Personen mit Arbeitsvertrag beim Träger schließt nur der Träger ab. Die
  Schule nimmt sie aus ihrem Monatsabschluss und aus dem Versand an das
  Lohnbüro (#4805). Schulen ohne Träger-App schließen weiter selbst ab.
- Jede Schule rechnet ihr Stundenkonto je Beschäftigung: Soll aus dem
  gespiegelten Soll des Vertrags (ADR 0237), Ist aus den erfassten Zeiten,
  Abwesenheiten und Buchungen, Übertrag aus der Kette ihrer Monate. Den
  Abschluss hält `active.staff_month_balance_snapshots` (#1417). Dieser
  Abschluss sperrt Buchungen, Eröffnungssalden, Umbuchungen, Sonderarbeitszeiten
  und Soll-Änderungen im Monat und friert den Übertrag ein.
- Workforce darf Träger und Schule nicht in einer Transaktion schreiben
  (ADR 0105).

## Entscheidung

1. **Das Konto ist die Summe der Schulen.** Das Stundenkonto der Personalakte
   in einem Monat ist die Summe der Monatskarten aller lebenden Schulen der
   Akte: Soll, Ist, Gutschriften, Buchungen, Saldo des Monats, Übertrag und
   Kontostand. Jede Schule rechnet ihre Zeile in ihrer Tenant-Transaktion mit
   derselben Rechnung wie ihre Monatskarte und schreibt vorher den Eintrag ins
   Zugriffsprotokoll (ADR 0084 Abschnitt 7). Der Saldo, den eine Schule vor der
   Verknüpfung führte, ist so die Eröffnungsbuchung mit Verweis auf die Schule
   aus ADR 0089 Abschnitt 5; eine eigene Buchungstabelle beim Träger gibt es
   nicht.
2. **Wen der Träger abschließt.** Der Träger schließt eine Beschäftigung in
   einem Monat ab, wenn ein Vertrag des Trägers mit Soll an dieser Schule an
   einem Tag des Monats läuft (`staff_contract_targets.valid_from` bis
   Monatsende, Vertrag überschneidet den Monat). Dieselbe Abfrage
   (`TraegerKeptStaffByMonth`, eine Abfrage für alle Monate eines Zeitraums)
   entscheidet in der Schule, wen ihr Abschluss und ihr Lohnexport auslassen.
   Die Schule liest diese Personen über
   `GET /api/staff/time-tracking/month-close/traeger-staff`. Ohne Vertrag
   bleibt der Monat bei der Schule.
3. **Der Abschluss ist der Snapshot der Schule.** Der Abschluss des Trägers ist
   je Schule eine Zeile in `active.staff_month_balance_snapshots` mit
   `source = 'traeger'`, `closed_by_account_id` (Konto der
   Personalverwaltung) und ohne `closed_by`. Damit gelten alle Sperren und der
   eingefrorene Übertrag der Schule ohne zweite Regel. Workforce schreibt die
   Schulen nacheinander in je eigener Tenant-Transaktion.
4. **Erst prüfen, dann schreiben.** Vor dem ersten Schreiben liest der Träger
   jede Schule: Der Monat muss vorbei sein, ein Grund muss da sein, und keine
   Schule darf einen späteren Monat abgeschlossen haben. Ein schon
   abgeschlossener Monat einer Schule bleibt, wie er ist; ein zweiter Klick
   ändert nichts. Scheitert eine Schule trotzdem (Wettlauf), bleiben die
   vorigen geschlossen und ein neuer Klick schließt den Rest.
5. **Wer wieder öffnet.** Einen Abschluss des Trägers öffnet nur die
   Personalverwaltung (`reopened_by_account_id`), einen Abschluss der Schule
   nur die Schule (`workforce.month_closed_by_traeger`,
   `workforce.traeger_month_closed_by_school`). Es bleibt bei „neuester Monat
   zuerst“.
6. **Lohnbüro.** Die Monatszeilen des Lohnexports der Schule, auch der
   automatische Versand (#4805), lassen eine Person in jedem Monat aus, den
   der Träger abschließt. Der Tagesexport bleibt vollständig.
7. **Protokoll der Schule.** Die Sicht `audit.time_tracking_audit_log` markiert
   Abschluss und Wiederöffnen des Trägers mit `by_traeger`, damit die Schule
   die Personalverwaltung statt eines leeren Namens sieht.

## Verworfene Optionen

- **Eigene Abschluss-Tabelle beim Träger, die Schulen lesen sie:** Jede Sperre
  der Schule (Buchung, Umbuchung, Sonderarbeitszeit, Soll, Kette) müsste eine
  zweite Quelle lesen, die Kette ihren Übertrag von dort holen. Zwei Quellen
  für „abgeschlossen“ laufen auseinander.
- **Ein Abbild der Monatskarten beim Träger:** wäre erst nach einem Abgleich
  aktuell und rechnet dieselbe Kette ein zweites Mal.
- **Abschluss in einer Transaktion über alle Schulen:** verboten durch
  ADR 0105.
- **Automatischer Abschluss je Vertrag:** Die Schule hat keinen automatischen
  Abschluss; der Träger bekommt ihn erst, wenn eine Schule ihn braucht.

## Folgen

- Neue Codes: `workforce.month_closed_by_traeger`,
  `workforce.traeger_month_closed_by_school`,
  `workforce.traeger_month_later_closed`, `workforce.traeger_month_not_kept`.
- Die Bindungen `StaffMonthCloseService.CloseMonthForTraeger`,
  `StaffMonthCloseService.ReopenMonthForTraeger` und
  `TraegerMonthClosing.*` laufen über dieselbe beobachtete Einheit
  (`application.observe`) und denselben Plattform-Scope
  (`tenant.WithinCurrentTenant`) wie der Abschluss der Schule. Die
  Command-Effects-Reviews nennen diese ADR als Freigabe.
- Drei Durchreicher kommen in modules/workforce hinzu (Budget 135 auf 138):
  `monthClosingCapability.TraegerMonthStaff`,
  `traegerMonthCapability.CloseMonthForTraeger` und
  `traegerMonthCapability.ReopenMonthForTraeger`. Sie übersetzen die internen
  Fehler auf die öffentlichen (Grenzübersetzung nach ADR 0075) wie die
  übrigen Methoden des Monatsabschlusses.
- Damit der Lohnexport in seinem festen Abfragebudget bleibt, liest
  `ReadPayrollRuleState` Lohnarten, Zuschlagsregeln und Abwesenheitsarten in
  einer Abfrage statt in zwei. Der Status des Monatsabschlusses der Schule
  behält seine Form; die Personen des Trägers kommen über die eigene Route.
- Offene Punkte vor dem Abschluss je Schule (laufende Sitzungen, offene
  Anträge), die ADR 0089 Abschnitt 10 nennt, zeigt der Abschluss der Schule
  heute auch nicht. Sie kommen für beide Wege zusammen.
- Der Lohnexport des Trägers (#4712) liest die Abschlüsse dieser ADR.
