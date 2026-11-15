---
status: accepted
---

# Tagesmeldung Mecklenburg-Vorpommern liest Anwesenheit über die Träger-Projektion

Entscheidung vom 15.11.2026 zu
[#4717](https://github.com/moto-ogs/project-phoenix/issues/4717), Etappe 5 der
Spec [#4611](https://github.com/moto-ogs/project-phoenix/issues/4611), User
Story 117. Sie folgt
[ADR 0151](0151-schulansicht-des-traegers-liest-ihre-zahlen-ueber-die-fach-owner.md)
und [ADR 0241](0241-auslastung-des-traegers-liest-zeitreihen-ueber-die-fach-owner.md)
und führt keinen neuen Owner und keine neue Tabelle ein.

## Kontext

Die 5. Änderung des KiföG M-V (Landtag, Juli 2026; Gesetzentwurf
Drucksache 8/6314) führt § 32 Absatz 1a ein: Ab 2027 erfassen die
Einrichtungsträger die täglichen An- und Abwesenheitszeiten der betreuten Kinder
digital und übermitteln sie dem für die Kindertagesförderung zuständigen
Ministerium. „Näheres regelt die Kindertagesförderungsauskunftsverordnung“
(KiföAVO M-V). Diese Verordnung mit Format, Weg und Frist ist bis heute nicht
veröffentlicht. Die Spec sagt für fehlende Vorlagen: bauen gegen die allgemeine
Zuordnung, das konkrete Format folgt, sobald die Beschreibung vorliegt.

Die Angaben liegen bei zwei Owners: Ein- und Auschecken bei Student Presence,
Krank-, Entschuldigt- und Klassenfahrt-Tage bei Care Plan. Das Bundesland ist
eine Einstellung der Schule (`operations.federal_state`), die sich in der
Admin-Einheit der Projektion nicht lesen lässt (ADR 0175).

## Entscheidung

1. **Nur Schulen in Mecklenburg-Vorpommern.** Die Projektion liest die
   Bundesländer über `traegercalendar.Schools`, wie der Kalender des Trägers
   (#4702), vor ihrer Admin-Einheit. Nur Schulen mit `DE-MV` gehen in die
   Meldung; die übrigen zählt sie (`other_schools`), zeigt sie aber nicht. Der
   Rahmen des Portals (`GET /traeger/organization`) trägt die Bundesländer der
   Schulen, damit die Navigation die Seite nur dort anbietet.
2. **Lesen über die Owner.** In der Admin-Einheit je Owner eine Abfrage für die
   ganze Schulmenge mit `tenant_id = ANY(?)`:
   - Student Presence `DailyAttendanceByTenant`: ein Tag je Kind mit erstem
     Ein-Checken und letztem Auschecken, nach der Regel der Heatmap (#4714). Ein
     offener Tag oder einer, den die Nachtbereinigung um 23:59:59 schloss, hat
     keine Abholung.
   - Care Plan `StatusDaysByTenant`: ein Status je Kind und Tag, der für den Tag
     steht (aktiv oder am Tagesende archiviert), krank vor entschuldigt vor
     Klassenfahrt.
   Das Budget `api.traeger.schools_daily_attendance` liegt bei 7 Statements,
   flach in der Zahl der Schulen.
3. **Definitionen** stehen an `traegerview.DailyAttendance`: Ort vor Status
   (ein anwesendes Kind zählt nur als anwesend), Tage sind Montag bis Freitag
   und Wochenendtage mit Kindern, höchstens 31 Tage, Ende spätestens gestern.
   Die Verweildauer zählt nur Tage mit Abholung.
4. **Allgemeine Zuordnung der Datei.** Bis die KiföAVO M-V ein Format nennt,
   enthält die CSV-Datei eine Zeile je Kind und Tag: Einrichtung, Ort, Datum,
   laufende Nummer des Tages, Status, Ankunft, Abholung, Minuten. Sie trägt
   keinen Namen und keine ID; die Reihenfolge folgt Status und Uhrzeit, nie
   einem Kind. Ein amtliches Format ersetzt nur den Schreiber der Datei in
   `traegerview/http`; Lesen und Definitionen bleiben.
5. **Rechte und Protokoll.** Beide Routen brauchen „Berichte lesen“. Die Zahlen
   nennen kein Kind und gehen nicht ins Zugriffsprotokoll (ADR 0084 Abschnitt
   7). Die Datei nennt ebenfalls kein Kind, ihre Zeilen kommen bei einer kleinen
   Schule aber nahe an einzelne Kinder. Deshalb schreibt die Projektion den
   Export vor der Antwort ins Zugriffsprotokoll jeder Schule mit Zeilen
   (`traeger_daily_attendance_export`, Zeilenzahl und Zeitraum).

## Folgen

- Kein Versand an das Ministerium: Weg und Empfänger stehen noch nicht fest. Die
  Seite erzeugt die Datei, das Träger-Büro reicht sie ein.
- Die Demo-Daten liegen in Nordrhein-Westfalen. Wer die Seite lokal sehen will,
  stellt das Bundesland einer Schule im Betreiber-Portal auf
  Mecklenburg-Vorpommern.
- Sobald die KiföAVO M-V vorliegt, folgt ein Ticket für das Format.
