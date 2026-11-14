---
status: accepted
---

# Arbeitsvertrag des Trägers spiegelt das Soll in die Zeiterfassung der Schule

Entscheidung vom 14.11.2026 für
[#4706](https://github.com/moto-ogs/project-phoenix/issues/4706), Etappe 4 der
Spec [#4611](https://github.com/moto-ogs/project-phoenix/issues/4611), User
Story 102. Sie setzt den Arbeitsvertrag aus
[ADR 0089](0089-personal-wird-beim-traeger-gefuehrt-und-in-der-schule-eingesetzt.md)
Abschnitt 1 und 3 für Soll und Ferien-Soll um und baut auf
[ADR 0233](0233-personalakte-des-traegers-verknuepft-beschaeftigungen-und-uebernimmt-bankdaten.md)
auf.

## Kontext

- Die Schule rechnet das Soll aus ihren Schedule-Versionen
  (`config.staff_work_schedules`), der zugewiesenen Arbeitszeitmodell-Vorlage
  und den Sonderarbeitszeiten (`config.staff_target_overrides`). Die Reihenfolge
  steht in `workforce.DayTargetResolver`. Feiertage und Schließtage (#4702)
  setzen das Soll eines Tages auf 0.
- Diese Rechnung lesen Monatskarte, Wochenwerte (#6847), Stundenkonto,
  Abrechnung, Dienstplan-Soll und die Vollständigkeit (#6890). Abgeschlossene
  Monate sind in `active.staff_month_balance_snapshots` eingefroren.
- ADR 0233 spiegelt die Personalnummer der Akte in jede Beschäftigung, damit
  alle Leser der Schule unverändert bleiben.

## Entscheidung

1. **Vertrag beim Träger.** `workforce.staff_contracts` hält Art (Teilzeit,
   Vollzeit, Minijob), ersten und letzten Tag. Eine Akte kann mehrere Verträge
   haben. Ein Einsatzort gehört an einem Tag zu höchstens einem Vertrag.
   Übungsleiter und Ehrenamt kommen mit #4712.
2. **Soll je Einsatzort in Versionen.** `workforce.staff_contract_targets`
   hält das Soll Montag bis Freitag ab einem Tag. Eine Änderung ist eine neue
   Zeile ab ihrem ersten Tag; spätere geplante Zeilen dieses Einsatzorts
   weichen ihr. So zeigt die Akte den Verlauf des Solls.
3. **Ferien-Soll je Woche.** `workforce.staff_contract_holiday_weeks` hält das
   Soll Montag bis Freitag einer Ferienwoche an einem Einsatzort.
4. **Spiegel in die Schule.** Nach jeder Änderung schreibt Workforce je
   Einsatzort in dessen Tenant-Transaktion den ganzen Plan neu: die
   Schedule-Versionen ab dem ersten offenen Tag, die Ferienwochen als
   Sonderarbeitszeiten mit `traeger_contract_id`. Die Beschäftigung verliert
   ihre Arbeitszeitmodell-Vorlage, damit eine Vorlagen-Änderung das Soll nicht
   überschreibt. Stand sie bisher nur auf einer Vorlage, schreibt der Spiegel
   deren Soll vorher als Version bis zum ersten gespiegelten Tag fest, sonst
   fiele das Soll früherer offener Monate auf 0. Alle Leser der Schule bleiben
   unverändert. Feiertage und Schließtage zählen im regulären Soll wie bisher;
   eine Ferienwoche gilt wie jede Sonderarbeitszeit auch an Schließtagen, nur
   Feiertage bleiben frei. Weil der Spiegel alles ab dem ersten offenen Tag
   neu schreibt, holt jede weitere Änderung eine Schule nach, an der er einmal
   gescheitert ist (wie ADR 0233 Abschnitt 6). Die Änderung beim Träger bleibt
   dann gespeichert, die Akte nennt die Schulen, die sie noch nicht erreicht
   hat.
5. **Erster offener Tag.** Das ist der 1. des laufenden Monats oder der Tag
   nach dem letzten Monat, den die Schule für die Person abgeschlossen hat, je
   nachdem, was später liegt. Davor bleibt das Soll, das die Schule gezählt hat.
   Eine Änderung des Solls, des Vertragsendes oder einer Ferienwoche, die
   davor beginnt, lehnt moto ab und nennt den Tag. Nur das erste Soll eines
   Einsatzorts darf früher beginnen, etwa beim Erfassen eines Vertrags von
   2019; es wirkt in der Schule ab dem ersten offenen Tag.
6. **Schule liest, ändert nicht.** Vom Eintragen eines Vertrags bis zu seinem
   letzten Tag lehnt die Schule
   Änderungen am Arbeitszeitmodell und an Sonderarbeitszeiten dieser Person ab
   (`workforce.staff_soll_kept_by_traeger`) und zeigt „führt der Träger“. Das
   gilt schon vor dem ersten Tag, weil der Spiegel die künftige Version bereits
   geschrieben hat. Endet die Beschäftigung und wird wieder aufgenommen, endet
   eine künftige Version mit ihrem ersten Tag, statt einen letzten Tag vor dem
   ersten zu bekommen. Eine
   eigene Sonderarbeitszeit der Schule in einer Ferienwoche des Trägers lehnt
   der Träger vor dem Schreiben ab. Die Schule liest per RLS nur Soll und
   Verträge ihrer eigenen Beschäftigungen.
7. **Löschen nur, was nie gezählt wurde.** Einen Vertrag, der vor dem ersten
   offenen Tag begann, beendet die Personalverwaltung mit einem letzten Tag;
   löschen geht nur, wenn er noch nicht zählte. Nach dem Löschen bekommt jeder
   Einsatzort, den kein anderer Vertrag nennt, ab dem ersten Tag des Vertrags
   sein eigenes Soll zurück: Die gespiegelten Versionen und Ferienwochen gehen,
   die Version davor läuft weiter. Der erste
   Tag eines Vertrags ändert sich nicht; ein falscher Vertrag wird gelöscht und
   neu angelegt.
8. **Uhr.** Der erste offene Tag hängt am Tag der Änderung. Workforce nimmt
   ihn aus seiner injizierten Uhr; Tests setzen sie fest. Die
   Command-Effects-Einträge über `application.Clock.Time` sind mit dieser ADR
   freigegeben.

## Verworfene Optionen

- **Alle Leser der Schule lesen den Vertrag direkt:** Monatskarte, Wochenwerte,
  Abrechnung, Dienstplan und Vollständigkeit müssten je zwei Wege kennen. Der
  Spiegel hält eine Rechnung (ADR 0081) und folgt dem Muster der Personalnummer.
- **Ein Soll je Vertrag ohne Einsatzort:** ADR 0089 nennt Soll je Wochentag
  und Einsatzort; die Schule braucht ihr eigenes Soll für Saldo und Dienstplan.
- **Rückwirkend bis zum Vertragsbeginn spiegeln:** Eine Schule ohne
  Monatsabschluss bekäme ihr ganzes Stundenkonto neu gerechnet. Der 1. des
  laufenden Monats als frühester Tag hält gezählte Monate stabil.
- **Ferien-Soll als Muster „in allen Ferien“:** Die Kunden planen Ferienwochen
  einzeln, mit wechselnder Besetzung. Eine Woche je Zeile passt zur
  Sonderarbeitszeit der Schule.

## Folgen

- Das Stundenkonto je Arbeitsvertrag und die Eröffnungsbuchung (ADR 0089
  Abschnitt 5 und 10) kommen mit #4711. Bis dahin rechnet jede Schule ihr
  Stundenkonto aus dem gespiegelten Soll.
- Art, Eintritt und Vertragsende im Abschnitt „Arbeitsvertrag“ der Stammdaten
  der Schule spiegelt dieser Schritt nicht; das folgt mit dem Lohnexport des
  Trägers (#4712).
- Die Löschfrist der Verträge folgt der Akte, bis ADR 0089 Abschnitt 12 mit dem
  Vertragsende umgesetzt ist.
- Das Soll des Vertrags kennt Montag bis Freitag in einem Wochenrhythmus.
  A/B-Wochen und Samstage bleiben Schulen ohne Vertrag vorbehalten, bis ein
  Kunde sie für Verträge braucht.
- Ob der Träger das Soll führt, liest `GET /staff/{id}/schedule` in derselben
  Abfrage wie den laufenden Schedule; nur ein leerer Schedule fragt einmal
  nach.
