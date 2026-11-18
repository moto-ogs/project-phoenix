---
status: accepted
---

# Die Aufbewahrung im Worker verwendet die Uhr der Wurzel

Entscheidung vom 2026-11-18 für
[#7383](https://github.com/moto-ogs/project-phoenix/issues/7383). Sie ergänzt
[ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md) und
[ADR 0285](0285-caterer-einladungen-entscheiden-auf-der-datenbankuhr.md).

Der Worker gibt die Uhr der Wurzel an Student Presence und People Directory
weiter. Student Presence zählt die Fristen für Anwesenheiten und
Morgenanwesenheiten in Berliner Kalendertagen. People Directory stempelt
`childless_since` und berechnet die Frist für Elternkontakte mit derselben
Uhr. Ob eine Einladung einen Kontakt schützt, entscheidet Identity & Access
weiter auf der Datenbankuhr, die den Ablauf stempelt.

Die beiden Schritte laufen im bestehenden Schulauftrag. Die
Löschprotokolle, Mandantengrenzen und Transaktionen bleiben erhalten.
Die Tests für beide Schritte verwenden dieselbe feste Uhr wie der jeweilige
Owner. Die Einladungsabläufe stammen aus `testpkg.DatabaseNow`.

Die Neuberechnung der Befehlsbelege ergibt 38 geänderte Digests. Diese
Entscheidung bestätigt die 14 Mutations- und 14 Transaktionsbelege von Care
Plan sowie die sechs Lese- und vier Sperrbelege von Facilities. Der
Aufrufpfad bindet die Uhr der Wurzel. Einstufung und ausgeführte Wirkung
bleiben gleich. Die 24 Belege mit `approval_adr` nennen diese Entscheidung.
