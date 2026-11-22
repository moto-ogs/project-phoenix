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
   (`FamilyChildCount.InForceOn`). Das gilt nur für eine Familie, in der ein Vertrag des Kindes
   dieser Zeile am Tag der Zeile läuft (ein Geschwistervertrag oder ein
   späterer Vertrag nach einer Lücke zählt nicht): Für eine Familie, die das Kind verlassen hat,
   entscheidet heute, damit die Datei deren Zahl nicht für eine Zeit
   erneuert, in der das Kind nicht mehr dazugehört. Die Zahl hängt am Vertrag
   der Zeile, die den frühesten Tag der Familie nennt.
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

## Nachtrag 22.11.2026: Grenzen der Kinderzahl-Datei (#7863 Punkte 3 bis 5)

- **Tag weiter als neun Monate voraus.** moto liest Verträge bis
  `evidenceLookAhead` (273 Tage) voraus. Liegt der Tag einer Zeile dahinter,
  ob aus ihrer Spalte oder aus dem Tag der Datei, hält moto die Zeile zurück
  (`too_far_ahead` an „Gültig ab“). Sie zeigt damit nie „Schon bestätigt“
  für eine Zeit, für die moto die Familie nicht kennt. Ihre Zahl spricht wie
  bei einem ungültigen Tag weiter gegen die Zeilen der Geschwister.
- **Vergleich mit der Bestätigung des Tages.** Die Zeile vergleicht die
  Bestätigungen, die an ihrem Entscheidungstag gelten. Verschiedene Zahlen
  für einen späteren Tag sind heute kein Widerspruch. Gilt am
  Entscheidungstag keine Zahl, schützt moto weiterhin geplante Bestätigungen:
  Die Datei übernimmt nie eine Zahl vor einer geplanten (Punkt 6, ADR 0288).
  Die Liste der Familien bleibt bei `countOn`.
- **Beendete Verträge.** Eine Familie zählt für die Zeile nur, wenn das Kind
  in ihr am oder nach dem Beginn der Kinderzahl einen Vertrag hat. Maßgeblich
  ist der Tag der Zeile. Bei einer Erneuerung gilt frühestens der Tag nach
  Ablauf der alten Bestätigung. Ein inzwischen beendeter Vertrag zählt also
  für einen früheren Beginn, aber nicht für eine Erneuerung nach Vertragsende.
  Bleibt keine Familie übrig, hält moto die Zeile zurück (`contract_ended`).

## Nachtrag 22.11.2026: Jeder Vertrag im Monat zählt, die Schulen der Regel zählen immer (#7863 Punkte 1 und 2)

Entscheidung von Yannick am 22.11.2026.

- **Jeder Vertrag im Monat zählt (Punkt 1).** Bei Vollmonatsabrechnung
  rechnet nur ein Vertrag des Kindes den Monat ab (ADR 0158, Nachtrag
  Kind-Monat E2). Für die Geschwisterregel zählt das Kind trotzdem an jeder
  Schule, an der ein Vertrag von ihm an einem Tag des Monats Betreuung bucht,
  Tag für Tag gelesen wie bei taggenauer Abrechnung. Der Vertrag ohne
  Positionen bekommt keine Rechnung; er steht wie ein Vertrag ohne Preis als
  Ort des Kindes in der Kette (`unbilled`). Ein Vertrag an einer zählenden
  Schule geht einem Vertrag an einer anderen Schule vor. Folgen: Im
  Größenmodus zählt das Kind zur Familiengröße. Im Rangmodus mit Kinderzahl
  geht es nicht mehr als Kind „an anderer Schule“ von der Zahl ab; es steht
  ohne Beitrag hinter den gereihten Kindern (ADR 0115 Punkt 3), deshalb
  ändert sich dort kein Rang und kein Betrag, nur die Kinderzahl auf der
  Ermäßigung („2. Kind von 3“ statt „von 2“). Die taggenaue Abrechnung
  rechnet wie bisher.
- **Die Schulen der Regel zählen immer (Punkt 2).** Das ersetzt in
  Entscheidung 2 den Satz „Der Rangmodus zählt wie bisher nur die gewählten
  Schulen.“ In beiden Modi zählen die Schulen der Regel und dazu die unter
  „Geschwister zählen auch an“ gewählten. Eine bestehende Rangregel, deren
  Auswahl die eigene Schule nicht nennt, ermäßigt damit ab dem nächsten Lauf
  an ihrer eigenen Schule. Die Maske bietet nur noch die anderen Schulen an;
  beim Speichern fallen die Schulen der Regel aus der Auswahl. Gespeicherte
  Regeln bleiben ohne Migration gültig, weil die Kette die Schulen der Regel
  selbst dazunimmt.
- **Ausgestellte Rechnungen bleiben.** Beides wirkt auf Entwürfe. Eine
  ausgestellte Rechnung behält ihre gespeicherten Ermäßigungen. Ein
  Änderungsbescheid rechnet dagegen alle Monate des Bescheids neu, auch
  frühere (ADR 0182). Dort gilt die neue Zählung also auch rückwirkend. Weil
  beide Punkte nur Kinder zur Zählung hinzunehmen, können Rang und
  Familiengröße nur steigen; was die Familie zusammen zahlt, sinkt oder
  bleibt. Ein einzelner Vertrag kann trotzdem mehr zahlen, wenn ein
  Höchstbetrag der Familie greift: Er verteilt den Überschuss neu auf die
  Kinder (Beispiel: 100 € und 80 € bei 120 € Höchstbetrag waren 100 € und
  20 €; mit 50 % für beide sind es 50 € und 40 €).
- **Ein Kind zählt einmal.** Eine ausgestellte Rechnung eines Vertrags, der
  den Monat nicht mehr berührt, zählt ihr Kind über die Identität, die der
  Betreuungsvertrag hält (ADR 0158 E1: Schülerdatensatz, sonst Name und
  Geburtsdatum), und reiht es nach diesem Geburtsdatum. Vorher zählte so ein
  Kind unter einer eigenen Kennung und konnte doppelt zählen. Für eine solche
  Familie kann ein Änderungsbescheid deshalb auch mehr verlangen als bisher.
