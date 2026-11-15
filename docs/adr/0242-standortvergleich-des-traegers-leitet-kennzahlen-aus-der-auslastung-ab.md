---
status: accepted
---

# Standortvergleich des Trägers leitet Kennzahlen aus der Auslastung ab

Entscheidung vom 15.11.2026 zu
[#4715](https://github.com/moto-ogs/project-phoenix/issues/4715), Etappe 5 der
Spec [#4611](https://github.com/moto-ogs/project-phoenix/issues/4611), User
Story 114. Sie folgt
[ADR 0241](0241-auslastung-des-traegers-liest-zeitreihen-ueber-die-fach-owner.md)
und führt keinen neuen Owner, keine neue Tabelle und kein neues Recht ein.

## Kontext

Das Träger-Büro will ausgewählte Kennzahlen seiner Standorte nebeneinander
sehen und exportieren. Die Zahlen gibt es schon: die Reihen der Auslastung
(Plätze, gebuchte und anwesende Kinder je Wochentag, ADR 0241) und die
festgehaltenen Stichtagszahlen (#4673). Es fehlt eine verbindliche Rechnung, die
daraus je Schule eine Zahl macht, dazu ein Schnitt und eine Summe, die Seite und
Export gleich rechnen.

Die öffentliche Fassade `traegerview.Overview` trägt zwölf Methoden, die Grenze
des Ratchets `TestModuleFacadeWidthRatchet`. Eine weitere Methode, auch über
eine eingebettete Schnittstelle, ginge darüber.

## Entscheidung

1. **Eine Lesung, abgeleitete Kennzahlen.** `SchoolComparison` liest in der
   Admin-Einheit der Projektion dieselben Owner wie die Auslastung, ohne Räume,
   und dazu die Stichtagszahlen über den bestehenden Port von Organisation &
   Tenancy. Das Budget `api.traeger.schools_comparison` liegt bei 8 Statements,
   flach in der Zahl der Schulen. Die Definitionen der acht Kennzahlen stehen
   verbindlich an `traegerview.SchoolComparison`: Plätze, Plätze belegt,
   freie Plätze, gebuchte Kinder (Ø), Veränderung der gebuchten Kinder,
   anwesende Kinder (Ø), höchstens anwesend und aktive Kinder am neuesten
   Stichtag im Zeitraum.
2. **Keine Zahl statt 0.** Eine Schule ohne Platzgrenze, ohne Check-in oder
   ohne Stichtag im Zeitraum hat für diese Kennzahl keinen Wert. Der Schnitt
   rechnet nur über Schulen mit Wert. „Alle zusammen“ summiert; die Belegung
   der Plätze ist dort der Anteil aller Plätze, und für „höchstens anwesend“
   gibt es keine Summe, weil die Spitzen der Schulen auf verschiedene Tage
   fallen.
3. **Auswahl im Backend.** `schools=` wählt die verglichenen Schulen; Schnitt und
   Summe gelten für diese Auswahl. Der Export nimmt dieselbe Auswahl und mit
   `metrics=` die gewählten Kennzahlen in ihrer Reihenfolge. Eine Schule eines
   anderen Trägers antwortet 404 `traeger.school_not_found`, wie bei der
   Auslastung.
4. **Eigene Schnittstelle neben der Fassade.** `traegerview.SchoolComparisons`
   hat eine Methode. Die Komposition gibt dasselbe Anwendungsobjekt als
   `Overview` und als `SchoolComparisons` zurück; die HTTP-Ressource bekommt
   beide. So wächst keine Fassade über zwölf Methoden, und das Compose-Budget
   bleibt bei 20 Zeilen.
5. **Recht und Protokoll.** Beide Routen brauchen „Berichte lesen“
   (`traeger_reports:read`) wie die Auslastung. Die Antwort trägt nur Zahlen und
   Schulnamen und steht nach ADR 0084 Abschnitt 7 nicht im Zugriffsprotokoll.

## Verworfene Optionen

- **Die Seite rechnet aus `/traeger/schools/utilization`:** Seite und Export
  hätten zwei Rechnungen, und die Stichtagszahl käme über eine zweite Anfrage.
- **Die Fassade auf 13 Methoden erweitern:** bräuchte eine Ausnahme im Ratchet
  für eine Methode, die keine andere Lesung braucht.
- **Weitere Kennzahlen wie Personal je Kind oder Krankmeldungen:** Personal und
  Krankmeldungen gibt es in der Projektion nur für heute. Über einen Zeitraum
  bräuchten sie neue Lesungen bei Workforce und Care Plan. Der Vergleich nimmt
  sie auf, sobald es diese Reihen gibt.

## Folgen

- Anwesend reicht so weit zurück wie `gdpr.attendance_retention_days`. Die
  Antwort nennt mit `attendance_from` den spätesten ersten Tag mit Check-ins nach
  Beginn des Zeitraums; die Seite weist darauf hin.
- Neue Kennzahlen kommen als Schlüssel in `traegerview.ComparisonKeys` dazu;
  der Export und die Seite lesen die Liste.
