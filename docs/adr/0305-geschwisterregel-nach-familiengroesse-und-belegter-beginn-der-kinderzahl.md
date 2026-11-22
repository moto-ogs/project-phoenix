---
status: proposed
---

# Geschwisterregel nach Familiengröße, Kinderzahl aus der Datei mit belegtem Beginn

Vorschlag vom 22.11.2026 zu [#7765](https://github.com/moto-ogs/project-phoenix/issues/7765).
Er ergänzt [ADR 0088](0088-betreuungsvertrag-und-elternabrechnung-sind-eigene-owner-beim-traeger.md)
§4 (Geschwisterregel, Kinderzahl der Familie) und ersetzt in
[ADR 0288](0288-kinderzahl-gilt-fuer-familien-ohne-mail-adresse-und-kommt-aus-einer-datei.md)
Punkt 5 den Satz zum Beginn der Zahl.

## Kontext

- Birkenfeld ermäßigt nach der Zahl der Familienkinder unter 18 Jahren: Hat
  die Familie mindestens zwei, zahlt jedes betreute Kind den ermäßigten
  Beitrag, auch das erste. Das ist eine bestätigte Anforderung. Offen sind
  drei Fragen an den Träger, von denen dieser Vorschlag nicht abhängt: ob die
  Regel an allen drei Birkenfelder Schulen gilt, wie die Quellangabe „5 oder
  mehr“ Kinder zu erfassen ist und ab welchem Tag eine erst im November
  belegte Kinderzahl gilt.
- Die Geschwisterregel wählt bisher nur nach dem Rang (`sibling_from_child`):
  Kinder ab dem n-ten zahlen weniger. Geschwister ohne Vertrag stehen in der
  Reihe vorn. Damit rechnet sie alle Birkenfelder Fälle richtig, bis auf
  einen: Zwei Familienkinder, beide betreut, nur das zweite wird ermäßigt.
- Andere Träger (Otto-Riehm, Ispringen) rechnen nach dem Rang und müssen so
  bleiben.
- Die Kinderzahl-Datei (ADR 0288 Punkt 5) setzte jede Zahl auf den ersten
  Vertragstag. Diesen Tag belegt die Datei nicht: Sie sagt, wie viele Kinder
  die Familie heute hat, nicht seit wann.

## Entscheidung

1. **Zwei Arten, wen eine Geschwisterregel ermäßigt.** Neues Kennzeichen
   `sibling_all_children` an der Betreuungs-Geschwisterregel, Standard aus.
   Aus: wie bisher die Kinder ab dem Rang `sibling_from_child`. An:
   `sibling_from_child` ist die Familiengröße, ab der jedes Kind mit Vertrag
   ermäßigt wird, auch das erste. Keine bestehende Regel ändert sich.
2. **Die Familiengröße ist die Zahl, nach der auch der Rang zählt.** Zählt die
   Regel die Kinderzahl (`counts_family_children`), ist es die bestätigte, im
   Monat gültige Zahl, mindestens die Kinder mit Vertrag an den zählenden
   Schulen; sonst nur diese Kinder. Ohne gültige Bestätigung zählen die
   Vertragskinder, und der Monatslauf nennt die Familie wie bisher unter
   „Kinderzahl der Familie fehlt“. Beide Schalter bleiben unabhängig:
   Birkenfeld setzt beide. Zur Familiengröße zählt jedes Kind mit Vertrag an
   einer zählenden Schule, auch wenn der Teil der Regel bei ihm nichts kostet
   (0 €, anderes Modul, noch kein Beleg). Im Rangmodus steht so ein Kind
   hinter den gereihten Kindern und ändert nichts; bei der Größe würde sein
   Fehlen die Familie unter die Schwelle drücken. Im Größenmodus zählen die
   Schulen der Regel immer mit, auch wenn „Geschwister zählen an“ nur andere
   nennt: Sonst bekäme ein Kind an einer Schule der Regel die Ermäßigung
   seiner eigenen Familie nicht. Der Rangmodus zählt wie bisher nur die
   gewählten Schulen.
3. **Wirkung, Reihenfolge und Höchstbetrag bleiben.** Anteil, Betrag, fester
   Preis und Preis laut Preisliste wirken je ermäßigtem Kind wie im
   Rangmodus. Die Ferienkette hat ihre eigene Regel und bleibt unberührt.
4. **Die Ermäßigung der Rechnung hält die Art fest.**
   `care_invoice_reductions.sibling_all_children` ist eine Kopie wie
   `tariff_sibling_price`. Rang und Kinderzahl bleiben gespeichert. Brief und
   Prüfansicht schreiben dann „2 Kinder in der Familie“ statt „2. Kind von 2“,
   weil der Rang nichts entschieden hat.
5. **Die Datei nennt, ab wann ihre Zahlen gelten.** Die Zuordnung der
   Kinderzahl-Datei hat einen Tag für alle Zeilen (`valid_from`) und eine
   optionale Spalte „Gültig ab“ je Zeile. Die Spalte geht vor; eine leere
   Zelle nimmt den Tag der Datei. Nennt das Büro keinen Tag, gilt der Tag des
   Imports: der einzige Tag, den der Import selbst belegt. moto setzt eine
   Zahl nie mehr von selbst auf den ersten Vertragstag. Eine Zelle, die kein
   Datum ist, hält die Zeile zurück. Ein Jahr vor 2000 oder ab 2100 ist kein
   Tag.
6. **Unverändert aus ADR 0288:** Eine geltende bestätigte Zahl wird nie
   überschrieben, eine abgelaufene erneuert die Datei frühestens ab dem Tag
   nach ihrem Ende, die Vorschau wird per Fingerabdruck bestätigt. Der Tag
   steht im Fingerabdruck. Gehören die Verträge eines Kindes zu mehreren
   Familien und gilt die Zahl für sie ab verschiedenen Tagen, nennt die Zeile
   der Vorschau jeden dieser Tage (`valid_from`, `later_valid_from`). Liegt
   der Tag der Zeile nach dem Ende einer Bestätigung, die heute noch gilt,
   übernimmt moto die Zahl als Nachfolger ab diesem Tag: Maßgeblich ist der
   spätere von heute und dem Tag der Zeile. Die Monate davor behalten die
   alte Bestätigung, weil die Historie der Bestätigungen je Tag entscheidet
   (`FamilyChildCount.InForceOn`). Die Zahl hängt am Vertrag der Zeile, die
   den frühesten Tag der Familie nennt.
7. **Der Vertragsimport bleibt.** Dort nennt die Datei den Vertragsbeginn
   selbst, je Zeile oder für alle Zeilen, und die Kinderzahl steht in
   derselben Zeile (ADR 0288 Punkt 4).

## Verworfene Optionen

- **Rangregel „ab dem 1. Kind“ mit Mindestgröße.** `sibling_from_child = 1`
  hieße im Rangmodus „jedes Kind, auch Einzelkinder“. Eine zweite Zahl für
  die Mindestgröße wäre ein Feld mehr für denselben Schalter.
- **Familiengröße erzwingt die Kinderzahl.** Ein Träger kann „ab zwei
  betreuten Kindern alle“ wollen. Die Maske sagt, was gerade zählt.
- **Pflichtfeld ohne Vorschlag für den Tag.** Der Tag des Imports ist nie
  rückwirkend und damit kein unbelegter Beginn; ein leeres Pflichtfeld hielte
  jede Datei auf, ohne etwas zu schützen.
- **Rang auf der Rechnung weglassen** (`child_rank` leer). Die Spalte ist für
  Geschwister Pflicht (`chk_care_invoice_reductions_rank`); die Kopie der Art
  sagt dasselbe ohne Änderung an bestehenden Zeilen.

## Folgen

- Die produktive Regel für Birkenfeld ist Konfiguration: Die Abrechnung legt
  sie mit ihren Schulen an. Dieser Vorschlag aktiviert nichts.
- „5 oder mehr“ ist keine ganze Zahl; die Datei hält eine solche Zeile als
  fehlerhaft zurück. moto erfindet keine Zahl.
- Eine Zahl aus einer Datei zählt für den Monat, in dem ihr Tag liegt, und
  danach (ADR 0164 Punkt 6). Frühere Monate rechnet moto erst zum
  Geschwisterpreis, wenn das Büro einen früheren Tag nennt.
- Migration `20261122070000`: zwei Spalten mit Standard `false`, zwei Checks.
