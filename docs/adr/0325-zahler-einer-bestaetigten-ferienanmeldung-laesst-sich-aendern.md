# ADR 0325: Der Zahler einer bestätigten Ferienanmeldung lässt sich ändern

Datum: 2026-11-26
Status: Akzeptiert

Entscheidung zu [#8158](https://github.com/moto-ogs/project-phoenix/issues/8158).
Sie ergänzt
[ADR 0115](0115-ferienbeitrag-entsteht-in-der-elternabrechnung-und-wird-bei-bestaetigung-festgehalten.md)
(Nachträge #5627, #5662 und #5664) und führt keinen neuen Owner ein.

## Kontext

Wer den Ferienbeitrag bezahlt, wählte das Träger-Büro bisher nur beim
Bestätigen: die Familie, niemand (Befreiung bei Leistungsbezug) oder ein
Kostenträger. Die Bestätigung hält den Beitrag fest. Bringt eine Familie den
Bescheid erst danach, gab es keinen Weg, den Zahler zu wechseln, außer die
Kinder zu stornieren und neu anzumelden. Eine Betragskorrektur im
Abrechnungslauf ersetzt das nicht: Sie erzeugt keine Forderung an den
Kostenträger und keine Zeile in dessen Erstattungsliste.

## Entscheidung

1. **Ein eigener Befehl der Elternabrechnung.** `HolidayPayerChanges`
   (`modules/parentbilling/holiday_payer.go`) zeigt die Wirkung eines Wechsels
   und speichert ihn. Er gilt nur für bestätigte Anmeldungen, auch für
   eingefrorene: Einfrieren sperrt Stornieren und Umbuchen, nicht den Zahler.
   Das Recht ist „Anmeldung verwalten“, wie beim Bestätigen.
2. **Neue Fassung statt Änderung.** Der Wechsel rechnet die Anmeldung in ihrer
   Geschwistergruppe neu, wie das Bestätigen einer weiteren Anmeldung der
   Gruppe: mit den Grundpreisen und den Einstellungen der Kette, die sie
   festgehalten hat (ADR 0115, Nachtrag #5664 Punkt 5), und den Regeln, die am
   ersten gebuchten Tag gelten. Neu gesetzt wird der Zahler. Das Ergebnis ist
   eine neue Fassung des festgehaltenen Beitrags; die alte bleibt. Der Rang der
   Geschwister hängt nicht vom Zahler ab, darum bewegt der Wechsel selbst keine
   andere Anmeldung der Gruppe. Weicht deren Beitrag aus anderem Grund vom
   neu gerechneten ab, bekommt sie wie beim Bestätigen eine neue Fassung; eine
   Anmeldung mit ausgestellter Rechnung behält ihre.
3. **Sperren und gelesener Stand.** Der Befehl hält den gewählten Kostenträger,
   die Rechnungen des Zeitraums und den Zeitraum in Enrollment, in der
   Reihenfolge der Bestätigung. Er speichert nur die Vorschau, die das Büro
   gelesen hat (ADR 0311): Der Fingerabdruck nennt die alte und die neue
   Fassung.
4. **Verlauf in Enrollment.** Enrollment schreibt den Eintrag `payer` in das
   Protokoll der Anmeldung: Zahler vorher und nachher, bei einem Kostenträger
   mit dem Namen, und die Begründung (Pflicht, höchstens 500 Zeichen). Die
   Elternabrechnung erreicht das Protokoll über ihren Port
   `HolidayRegistrations.RecordHolidayPayer`; die Wurzel bindet ihn an
   `enrollment.HolidayPayerTrail`. Der Eintrag und die neue Fassung entstehen
   in derselben Träger-Transaktion (ADR 0067, Befehl mit teilnehmendem Owner
   wie `RecordHolidaySiblings`). Die ID des Kostenträgers bleibt in der
   Elternabrechnung.
5. **Offene und freigegebene Abrechnung.** Ein berechneter Lauf liest die
   neueste Fassung und rechnet sofort mit dem neuen Zahler. Eine ausgestellte
   Rechnung behält ihre Positionen (ADR 0119). Die Anmeldung bekommt trotzdem
   ihre neue Fassung; die Seite meldet „Rechnung prüfen“ wie nach dem Storno
   eines Geschwisters (#5662). Das Büro storniert die Rechnung, der nächste
   Lauf stellt den neuen Betrag aus. Die Erstattungsliste eines Kostenträgers
   folgt den Rechnungen und ihren Stornos und bleibt so mit ihnen im Einklang.
6. **Keine Nachricht an die Eltern.** Der Wechsel verschickt nichts. Die
   Familie erfährt den neuen Betrag mit dem Schreiben des nächsten Laufs.

## Verworfen

- **Status zurück auf „Eingegangen“.** Die Annahme-Mail ginge ein zweites Mal
  hinaus, und Plätze, Wartelisten und Geschwisterränge hingen an einem Status,
  der nicht stimmt.
- **Betragskorrektur im Lauf als Ersatz.** Sie kennt keinen Kostenträger.
- **Wechsel sperren, sobald eine Rechnung ausgestellt ist.** Der Bescheid kommt
  oft erst mit der Rechnung. Der Korrekturweg über Storno und neuen Lauf
  besteht schon.

## Folgen

- Eine Korrektur, die im offenen Lauf schon für ein Kind der Anmeldung steht,
  ist ein Differenzbetrag und rechnet nach dem Wechsel auf dem neuen Betrag
  weiter. Der Lauf zeigt sie als eigene Position; das Büro prüft sie vor der
  Freigabe.
- Die Einstellung „Was bezahlt ein Kostenträger?“ wirkt beim Wechsel so, wie
  die Gruppe sie festgehalten hat, nicht wie sie heute steht.
