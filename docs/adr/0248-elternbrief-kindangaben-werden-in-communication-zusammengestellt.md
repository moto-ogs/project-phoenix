---
status: accepted
---

# Elternbrief-Kindangaben werden in Communication zusammengestellt

Entscheidung vom 15.11.2026 zu
[#4813](https://github.com/moto-ogs/project-phoenix/issues/4813).
Der bisherige Brief-Reader hielt mehrere Fach-Owner im Composition Root und
berechnete dort Betreuungstage und Abholtexte. Das widerspricht ADR 0068 §4–5.

Communication übernimmt den Reader in seine Anwendungsschicht. Consumer-eigene
Ports liefern nur die benötigten Kinder-, Namens-, Gruppen- und Wochenplanwerte.
Der Root bindet jede Quelle einzeln an ihre bestehende öffentliche Capability
und übersetzt deren Werte, ohne die Quellen selbst zusammenzuführen. Alle
Abfragen behalten den Kontext der aufrufenden Tenant-Transaktion und lesen die
gesamte Kindermenge gebündelt. Eine zusätzliche Projektions-Capability ist nicht
nötig: Die tenant-sicheren Lesezugriffe existieren bereits.

Der Owner baut den Reader über `NewParentLetterChildren` bei seinen bestehenden
Brief-Konstruktoren. Dieser Konstruktor und sein Port-Import benötigen genau
sechs zusätzliche Zeilen in `modules/communication/composition`: Das
Compose-Budget steigt von 376 auf 382. Zusammen mit den sechs Zeilen aus
ADR 0246 für Träger-Berichte steigt die Summe von 13530 auf 13542
(ADR 0057 §5). Die Ausnahme gilt nur dieser Konstruktion; Importregeln,
Root-Servicegraph-Grenze und übrige Budgets bleiben unverändert. Fachregeln und
Briefinhalt ändern sich nicht.
