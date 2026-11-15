---
status: proposed
---

# Einsatzplanung des Trägers prüft die Schichten aller Einsatzorte über eine Datenbankfunktion

Vorschlag vom 15.11.2026 für
[#4708](https://github.com/moto-ogs/project-phoenix/issues/4708), Etappe der
Spec [#4611](https://github.com/moto-ogs/project-phoenix/issues/4611). Sie
setzt [ADR 0089](0089-personal-wird-beim-traeger-gefuehrt-und-in-der-schule-eingesetzt.md)
§8 um und ändert dort zwei Punkte. Sie baut auf der Personalakte aus
[ADR 0233](0233-personalakte-des-traegers-verknuepft-beschaeftigungen-und-uebernimmt-bankdaten.md),
dem Soll aus [ADR 0237](0237-arbeitsvertrag-des-traegers-spiegelt-das-soll-in-die-zeiterfassung-der-schule.md)
und dem Funktionsmuster aus
[ADR 0236](0236-abwesenheitsarten-des-traegers-gehen-in-die-schulen-und-eine-datenbankfunktion-prueft-das-kontingent.md)
auf.

## Kontext

- Schichten liegen in `schedule.staff_shifts` der Schule. Jede Schule plant
  in ihrer Tenant-Transaktion und sieht per RLS nur ihre eigenen Schichten.
- Eine Personalakte verknüpft Beschäftigungen mehrerer Schulen. Für die
  Prüfung von Tageshöchstzeit, Ruhezeit und Pausen braucht moto die
  Schichten aller Einsatzorte der Person, auch wenn eine Schule plant.
- ADR 0089 §8 sah dafür eine **Einsatzzeit** beim Träger vor: eine Kopie
  jeder Schicht. Diese Kopie müsste bei jedem Anlegen, Verschieben, Absagen,
  jeder Serie, jedem Split und jedem Abwesenheitsabgleich der Schule
  mitgeschrieben werden. Jeder vergessene Pfad macht die Prüfung falsch.
- Eine Träger-Transaktion darf nicht in einer Tenant-Transaktion laufen und
  umgekehrt (ADR 0105).

## Entscheidung

1. **Keine Einsatzzeit-Kopie.** moto liest die echten Schichten. Die
   SECURITY-DEFINER-Funktion `workforce.shift_plan_slots(Akten, von, bis,
   sperren)` gibt die aktiven Schichten der Personalakten an allen
   Einsatzorten zurück: Tag, Beginn, Ende, Pause. Sie antwortet nur einer
   Schule, die Einsatzort der Akte ist, in ihrer Tenant-Transaktion, oder dem
   Träger der Akte in der Träger-Transaktion. Schule und Schicht-ID nennt sie
   nur für die eigene Schule und den Träger. Andere Schulen bleiben anonym.
   Mit `sperren` nimmt sie je Akte `pg_advisory_xact_lock`, damit zwei
   Schulen nicht gleichzeitig dieselben Stunden planen.
2. **Soll aus dem Vertrag.** `workforce.shift_plan_soll` gibt das Soll je
   Akte und Werktag aus den Arbeitsverträgen zurück, getrennt nach dem Anteil
   der Schule der Tenant-Transaktion (`own`) und dem Rest, mit den
   Ferienwochen der Verträge. Feiertage und Schließtage kennt nur die Schule
   selbst: Sie zieht sie von ihrem eigenen Anteil ab. Die Wochenansicht des
   Trägers addiert die Anteile aller Schulen, jeden ohne die freien Tage
   seiner Schule. Plant eine Schule, zählt der Anteil der anderen Schulen
   voll, weil sie deren Kalender nicht lesen darf; moto warnt dann eher zu
   selten als zu oft.
3. **Regeln sind Träger-Werte.** `staff_planning.enabled` (Standard an),
   `staff_planning.max_daily_hours` (10), `staff_planning.min_rest_hours`
   (11 oder 10) und `staff_planning.check_breaks` (an) haben die Ebene
   `traeger` und das Recht „Personal“. Bei 10 h Ruhezeit nennt moto
   § 5 Abs. 2 ArbZG und weist auf den Ausgleich hin. Die Oberfläche
   verspricht keine Rechtssicherheit (E3 vom 13.11.2026).
4. **Ein Verstoß warnt, eine Überschneidung sperrt.** Tageshöchstzeit,
   Ruhezeit, Pausen und Soll ergeben eine Warnung (409
   `workforce.shift_working_time_warning`). Wer bestätigt und begründet,
   plant trotzdem. Die Begründung und die Warnungen stehen im
   Änderungsprotokoll (`working_time_override`). moto meldet nur
   Warnungen, die die Änderung neu erzeugt oder verschlimmert. Eine Schicht,
   die sich mit einer Schicht an einem anderen Einsatzort überschneidet, ist
   dagegen gesperrt (409 `workforce.shift_overlaps_other_site`), so wie die
   Überschneidung in einer Schule. Eine Person kann nicht an zwei Orten
   zugleich arbeiten. Eine Begründung ändert daran nichts.
5. **Der Träger plant über den Dienstplan der Schule.** Jede Schicht, die
   die Personalverwaltung plant, ändert oder löscht, schreibt Workforce in
   der Tenant-Transaktion der Schule über deren Dienstplan. Sie erscheint
   dort sofort und läuft durch dieselben Prüfungen. `planned_by_traeger`
   kennzeichnet sie; `created_by` bleibt dann leer. Die Wochenansicht liest
   jede Schule in ihrer eigenen Tenant-Transaktion und schreibt dort zuerst
   den Zugriff ins Protokoll (ADR 0084 §7). Geplant wird nur an lebenden
   Einsatzorten der Akte; eine befristete Beschäftigung an einer neuen
   Schule kommt mit [#4709](https://github.com/moto-ogs/project-phoenix/issues/4709).
6. **Abschalten sperrt, löscht nichts.** Ist `staff_planning.enabled` aus,
   lehnt moto neue Schichten, Serien und neue Vertretungen in allen Schulen
   ab (409 `workforce.shift_planning_off`). Eine Vertretung mit Person und
   Zeit einer bestehenden gilt beim erneuten Speichern als bestehend. Vor
   dem Ausschalten zeigt das Träger-Portal je Schule die Zahl der künftigen
   Schichten. Bestehende Schichten bleiben und lassen sich weiter ändern,
   verschieben und absagen; „Ab jetzt dauerhaft“ in einer Serie ändert sie.

## Änderungen an ADR 0089 §8

- Statt der Einsatzzeit beim Träger liest die Prüfung die Schichten selbst
  (Punkt 1). Es gibt keine zweite Quelle, die veralten kann.
- „Entfernt sie erst nach Bestätigung“ entfällt. Das Abschalten sperrt nur
  neue Schichten (Punkt 6). Löschen künftiger Schichten wäre nicht
  rückgängig zu machen, und die Schulen verlören ihre Planung ohne eigenes
  Zutun. Wer sie entfernen will, sagt sie in der Schule ab.

## Verworfene Optionen

- **Einsatzzeit-Kopie beim Träger (ADR 0089 §8).** Verworfen wegen der vielen
  Schreibpfade, siehe Kontext.
- **Prüfung nur beim Träger.** Eine Schule könnte dann weiter Doppelschichten
  planen. Die Prüfung muss dort laufen, wo geplant wird.
- **Überschneidung nur warnen.** Eine Begründung macht eine Doppelbelegung
  nicht möglich; sie würde später als offener Punkt im Monatsabschluss
  auftauchen.

## Folgen

- Eine bestätigte Verletzung ohne angebundenes Änderungsprotokoll lehnt
  moto ab, statt sie ohne Eintrag zu speichern.
- Jede Schicht-Schreiboperation sucht die Personalakte der Beschäftigung
  (eine Abfrage). Mit Akte kommen zwei Abfragen hinzu (Schichten und Soll),
  und die Akte bleibt bis zum Ende der Transaktion gesperrt. Beschäftigungen
  ohne Akte prüft moto wie bisher nur auf Überschneidung in der Schule; die
  Arbeitszeitregeln gelten erst mit Personalakte, weil nur sie alle
  Einsatzorte kennt.
- Die Funktionen umgehen RLS gezielt. Ihre Prüfung der Berechtigung ist
  Teil der Migration und durch API-Tests mit zwei Schulen und zwei Trägern
  abgedeckt.
- Wegezeiten zwischen Einsatzorten prüft moto nicht (wie ADR 0089 §8).
- Das LOC-Budget von `modules/workforce/compose` steigt um 11 Zeilen für
  die Arbeitszeitprüfung und die Einsatzorte der Wochenansicht.
- Erfasste, nicht geplante Überschneidungen bleiben ein offener Punkt des
  Monatsabschlusses (#4711).
