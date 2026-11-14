---
status: proposed
---

# Abwesenheitsarten des Trägers gehen in die Schulen, und eine Datenbankfunktion prüft das Kontingent

Vorschlag vom 14.11.2026 für
[#4710](https://github.com/moto-ogs/project-phoenix/issues/4710), Etappe 4 der
Spec [#4611](https://github.com/moto-ogs/project-phoenix/issues/4611). Sie
setzt [ADR 0089](0089-personal-wird-beim-traeger-gefuehrt-und-in-der-schule-eingesetzt.md)
§10 mit dem Nachtrag vom 14.11.2026 (Entscheidung E5) technisch um und baut
auf der Personalakte aus
[ADR 0233](0233-personalakte-des-traegers-verknuepft-beschaeftigungen-und-uebernimmt-bankdaten.md)
auf.

## Kontext

- Jede Schule hat eigene Abwesenheitsarten (`active.staff_absence_types`)
  mit Kontingent je Person und Jahr, Verfall und harter Sperre. Jede Buchung,
  jeder Antrag und jede Entscheidung läuft in der Tenant-Transaktion der
  Schule, und `shiftplansync` überträgt sie dort fail-closed auf die Pläne.
- Eine Personalakte verknüpft Beschäftigungen mehrerer Schulen. Die Schule
  liest per RLS nur ihre eigenen Verknüpfungen, nie Buchungen anderer Schulen
  oder Werte des Trägers.
- Der Arbeitsvertrag kommt mit
  [#4706](https://github.com/moto-ogs/project-phoenix/issues/4706). Bis dahin
  hängt die Beschäftigung direkt an der Personalakte.
- Eine Träger-Transaktion darf nicht in einer Tenant-Transaktion laufen und
  umgekehrt (ADR 0105).

## Entscheidung

1. **Tabellen beim Träger.** `workforce.absence_types` hält die Arten des
   Trägers: Name, Kontingent an oder aus, Standard in Tagen je Jahr, Verfall,
   „beantragbar“ und aktiv. `workforce.absence_allowances` hält die Tage, die
   die Personalverwaltung für eine Person, Art und ein Jahr abweichend vom
   Standard festlegt, `workforce.absence_allowance_changes` deren Verlauf mit
   Begründung. Alle drei haben RLS über die Träger-Transaktion und gehören
   Workforce.
2. **Die Art geht in jede Schule.** Nach jedem Anlegen und Ändern schreibt
   Workforce die Art in jede Schule des Trägers, je in deren
   Tenant-Transaktion, als Zeile von `active.staff_absence_types` mit
   `traeger_absence_type_id`. Hat die Schule schon eine eigene Art desselben
   Namens, übernimmt Workforce diese Zeile, mit ihren Buchungen und ihrer
   Lohnart. Scheitert eine Schule, bleibt sie beim alten Stand, und die
   Übersicht des Trägers zeigt sie als „noch nicht übernommen“. Die nächste
   Änderung der Art holt sie nach. Einen neuen Namen bekommt eine Art nur,
   solange keine Schule sie gebucht hat.
3. **Die Abweichung liegt in der Schule.** `offered` und `school_limit_days`
   an der Zeile der Schule sind die Abweichung nach dem Nachtrag zu ADR 0089.
   Ein CHECK erlaubt sie nur an Arten des Trägers. Name, Kontingent, Verfall,
   „beantragbar“ und „aktiv“ einer solchen Zeile ändert die Schule nicht
   (`workforce.absence_type_kept_by_traeger`).
4. **Eine Datenbankfunktion prüft das Kontingent.** Die Buchung bleibt in der
   Tenant-Transaktion der Schule. Für eine Art des Trägers und eine Person mit
   Personalakte liest Workforce den Anspruch mit
   `workforce.absence_pool_claims` und die Buchungen aller Einsatzorte mit
   `workforce.absence_pool_uses`. Beide laufen als ihr Eigentümer
   (`SECURITY DEFINER`), weil die Rolle der Anfrage weder Buchungen anderer
   Schulen noch Werte des Trägers sieht. Sie antworten nur einer Schule, die
   Einsatzort der Akte ist, oder dem Träger der Akte. In der
   Tenant-Transaktion nennen sie andere Schulen nicht. Sie schreiben nichts.
   Die Claims-Funktion hält vor dem Lesen eine Transaktionssperre je Akte und
   Art (`pg_advisory_xact_lock`). Buchungen zweier Schulen und eine Änderung
   des Anspruchs beim Träger warten so aufeinander, und kein Rest wird doppelt
   gebucht. Die Rechnung selbst bleibt die bestehende in Go
   (`BuildAllowanceLedger`): Verfall und Vorjahresrest gelten unverändert.
5. **Antrag und Freigabe.** Eine Art mit „beantragbar“ legt der Antrag einer
   Betreuungskraft mit Status „beantragt“ an. Das Kontingent zählt die Tage
   sofort als reserviert. Freigabe, Rückfrage, Ablehnung und Rücknahme laufen
   über die bestehenden Wege des Urlaubsantrags. Das gilt auch für eigene Arten
   einer Schule mit „beantragbar“.
6. **Zugriffsprotokoll.** Die Kontingente einer Akte im Träger-Portal
   schreiben vorher an jedem Einsatzort einen Eintrag
   (`staff_absence_accounts`), mit der Beschäftigung dort und der Akte. Die
   Liste der Arten zeigt keine Person und schreibt keinen Eintrag.
7. **Bis zum Arbeitsvertrag hängt das Kontingent an der Personalakte.** Mit
   #4706 wandert es an den Arbeitsvertrag. Die Funktionen nehmen dann den
   Vertrag statt der Akte; Tabellen und Prüfung bleiben.
8. **Löschung und Demo.** Arten werden stillgelegt, nicht gelöscht, weil
   Buchungen ihren Namen behalten. Kontingente und Verlauf gehen mit der Akte,
   alles geht mit dem Träger. Kein Besucher eines Demo-Trägers erreicht das
   Träger-Büro (ADR 0233 Punkt 9), deshalb nimmt die Löschung von
   Demo-Besuchern die drei Tabellen nicht mit.

## Verworfene Optionen

- **Prüfung in einer Träger-Transaktion vor der Buchung:** verschachtelt in
  der Tenant-Transaktion der Schulroute (ADR 0105) oder mit Ausgleich, wenn
  die Schule danach scheitert.
- **Ein Abbild der Buchungen beim Träger:** wäre erst nach einem Abgleich
  aktuell; zwei Schulen könnten denselben Rest buchen.
- **Die Rechnung des Kontingents in SQL:** Verfall und Vorjahresrest gäbe es
  dann zweimal, in Go und in plpgsql.
- **Eine eigene Liste der Arten des Trägers in jeder Buchungsmaske:** jede
  Maske, Umbuchung, Lohnart und Auswertung der Schule müsste zwei Quellen
  lesen. Die Zeile in der Schule hält alle Wege unverändert.

## Folgen

- Stundenkonto und Monatsabschluss (#4711) lesen gebuchte Tage weiter je
  Schule. Die Grundart einer Art des Trägers ist „Sonstiges“, wie bei eigenen
  Arten der Schule.
- Eine Schule, die nicht im Träger ist, sieht nichts davon.
- Der Urlaubsanspruch über alle Schulen kommt mit dem Arbeitsvertrag (#4706).
