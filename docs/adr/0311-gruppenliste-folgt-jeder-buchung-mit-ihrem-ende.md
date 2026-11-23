---
status: accepted
---

# Gruppenliste folgt jeder Buchung mit ihrem Ende

Entscheidung vom 2026-11-23 für
[#7908](https://github.com/moto-ogs/project-phoenix/issues/7908). Sie hebt die
bekannte Grenze 1 aus
[ADR 0309](0309-bestandskinder-bekommen-ihre-anmeldung-still-aus-dem-importierten-vertrag.md)
auf und damit den Ablehnungsgrund `roster_bound` der stillen Anmeldung.

## Kontext

Care Plan schreibt die Gruppenliste (Roster) eines Kindes aus seinen
genehmigten Buchungen über zwei Wege: die direkte Verknüpfung eines Angebots
(`CareOffering.ActivityGroupID`, #1651) und die Quellregel einer Vorlage
(#2137). Der Entwurf eines Kindes war eine Zeile je Vorlage. Die direkte
Verknüpfung schrieb sie über die ganze Phase, verwarf also das Ende der
Buchung, und ersetzte den Entwurf der Quellregel derselben Vorlage.

Die naheliegende Korrektur (die Zeile endet mit der Buchung) wurde in #7896
zurückgenommen: Endet Angebot A (direkt) im Januar und ist Angebot B die
einzige Quelle derselben Liste bis Juli, fiele das Kind im Februar von der
Liste, obwohl B es weiter bucht. Eine Zeile kann verschiedene Enden je
Wochentag oder je Weg nicht ausdrücken.

Der Resync der Quellregel (`ResyncTemplateOfferingRoster`) rechnete schon
richtig: Die direkte Verknüpfung deckt je Buchung ihr Fenster bis zum Ende der
Buchung ab, die Quelle trägt bei, was diese Abdeckung nicht schon plant
(`subtractTargetCoverage`). Genehmigung und Resync waren sich also nicht einig.

## Entscheidung

Ein Kind steht so lange auf einer Gruppenliste, wie mindestens eine seiner
Buchungen es dorthin bringt. Die Genehmigung schreibt dafür dieselben Zeilen,
die der Resync für richtig hält:

1. **Mehrere Zeilen je Kind und Vorlage.** Ein Entwurf ist eine Zeile mit
   einem Satz Wochentage und einem Zeitraum; eine Vorlage kann mehrere tragen.
2. **Direkte Verknüpfung endet mit der Buchung.** Die Zeilen werden dort
   geschnitten, wo eine Buchung endet; jeder Abschnitt trägt die Wochentage
   der Buchungen, die dort noch laufen. Laufen alle bis zum Ende der Phase,
   bleibt es bei der einen Zeile über die ganze Phase wie bisher. Der Beginn
   bleibt der Beginn der Phase oder der Stichtag einer datierten Änderung.
3. **Quellregel neben direkter Verknüpfung.** Die Quelle einer Vorlage mit
   einer Quelle wird nicht mehr verworfen. Sie trägt bei, was die direkten
   Zeilen nicht schon planen (andere Wochentage, die Zeit nach dem Ende einer
   direkten Buchung), geschnitten wie im Resync. Ein späterer Resync findet
   die direkten Zeilen geschützt und die Quellzeilen passend und lässt beide
   stehen.
4. **Vorlagen mit mehreren Quellen** schreibt weiter nur der Resync.
5. **Datierte Änderung.** Eine Zeile bleibt, wenn ein Entwurf ihrer Vorlage mit
   denselben Wochentagen den Stichtag abdeckt; ihr Ende wird auf das Ende
   dieses Entwurfs gesetzt, verlängert oder gekürzt. Vorher wurde nur
   verlängert.
6. **Schutz im Resync ab dem Stichtag.** Der Resync schützt eine Zeile der
   direkten Verknüpfung, wenn deren Buchungen sie ab seinem Stichtag
   abdecken; was davor liegt, schreibt er ohnehin nicht um. Sonst kappte er
   nach einer datierten Änderung eine behaltene direkte Zeile, die vor dem
   Stichtag begann, weil die alte Buchung am Stichtag endet.
7. **Klassenfilter bei der Genehmigung.** Die Genehmigung prüft den
   Klassenfilter einer Quelle wie der Resync, nicht nur den Jahrgangsfilter.
   Dafür liefert die Bindung `bookingStudents.Student` zusätzlich die
   Schulklasse der Zeile, die sie schon liest; Wirkung, Sperre und Ziel
   bleiben gleich. Dieses ADR gibt die geänderte E4-Bindung frei
   (`command-effects/reviews/care-plan.json`).
8. **Ein Kind zählt einmal.** AG-Liste und Teilnehmerzahl nennen und zählen
   jedes Kind einer Gruppe einmal, auch wenn es mehrere Zeilen hat.
9. **Eine Anweisung je Kind.** Die Genehmigung schreibt die Zeilen eines
   Kindes über den vorhandenen Batch des Roster-Ports.
10. **Stille Anmeldung.** `roster_bound` entfällt: Ein Kind mit einer Buchung,
   die vor dem Ende der Phase endet, wird auch auf einem direkt verknüpften
   Angebot angemeldet.

## Folgen

- Bestehende Listen ändern sich nur, wo sie falsch sind: befristete direkte
  Buchungen, zwei direkte Buchungen mit verschiedenem Ende, und Quellregeln
  neben einer direkten Verknüpfung mit Tagen, die die direkte nicht plant.
  Offene direkte Buchungen ergeben dieselbe Zeile wie bisher.
- Keine Migration. Zu lange direkte Zeilen aus der Zeit davor werden bei
  einer Korrektur ohne Datum richtig (sie schreibt alle Zeilen des Kindes
  neu). Eine datierte Änderung kürzt eine behaltene Zeile nur, wenn ihr
  Entwurf früher endet; weil Korrekturen das Ende einer Buchung heute
  verwerfen (#7909), ist das selten. Ein Resync einer Vorlage mit Quellregel
  kappt eine solche Zeile am Stichtag und schreibt die noch gebuchten Tage
  der direkten Verknüpfung nicht neu; das bestand schon vorher. Befristete
  direkte Buchungen waren bisher selten: Die stille Anmeldung lehnte sie ab,
  und eine datierte Änderung kappt ihre Zeile selbst.
- Korrekturen verwerfen weiterhin das Ende einer Buchung (#7909). Seit
  `roster_bound` entfällt, betrifft das auch still angemeldete Kinder mit
  befristeter direkter Buchung: Nach einer Korrektur des Büros laufen
  Buchung und Liste bis zum Ende der Phase.
- Keine neuen Datenbankabfragen in der Genehmigung; der Schnitt rechnet nur
  mit den schon geladenen Buchungen, die Zeilen gehen in einer Anweisung.
- Offen wie vorher: Der Beginn einer direkten Zeile folgt nicht dem Beginn der
  Buchung (`link.ValidFrom`), der Resync rechnet die direkte Abdeckung aber ab
  diesem Tag.
