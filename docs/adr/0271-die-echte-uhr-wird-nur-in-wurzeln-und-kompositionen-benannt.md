---
status: accepted
---

# Die echte Uhr wird nur in Wurzeln und Kompositionen benannt

Entscheidung vom 2026-11-16 für
[#7104](https://github.com/moto-ogs/project-phoenix/issues/7104). Sie ergänzt
[ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md) um ein zweites
Register und führt keinen neuen Owner ein.

## Kontext

`TestModuleLiveClockRatchet` zählte bisher nur Aufrufe der echten Uhr
(`time.Now()`, `calendar.TodayDate()`). Die neun Owner-Schnitte von #7104
senkten diese Zahl, und die Reviews fanden trotzdem wiederholt denselben
Fehler: Ein Konstruktor außerhalb der Komposition band die Uhr als Wert
(`now: time.Now`, `if now == nil { now = time.Now }`), eine Wurzel reichte
keine Uhr, und ein Test mit fester Uhr lief auf zwei Uhren. Der Zähler sah
das nicht, weil dort niemand die Uhr aufruft.

## Entscheidung

1. **Zwei Orte dürfen die echte Uhr benennen:** die Wurzeln (`backend/api`,
   `backend/roots`, `backend/cmd`) und die `compose`- oder
   `composition`-Pakete eines Owners, die eine von der Wurzel nicht gesetzte
   Uhr vorbelegen dürfen. Jedes andere Paket unter `backend/modules` und
   `backend/workflows` erhält die Uhr.
2. **Neues Register `moduleLiveClockValueBudget`** im selben Test: Es zählt je
   Owner die Verweise auf `time.Now`, `calendar.TodayDate` und `calendar.Now`,
   die kein Aufruf sind und außerhalb der Kompositionen stehen. Gleiche Regeln
   wie `moduleLiveClockBudget`: nur schrumpfend, ein Owner ohne Eintrag darf
   keinen Verweis haben, ein zu hoher Eintrag schlägt fehl.
3. **Startwert:** 110 Verweise in 28 Ownern, gemessen auf `development`
   `77542c3af3`. #7104 baut sie ab; was bleibt, steht mit Begründung über dem
   Eintrag.

## Folgen

- Eine neue Bindung der echten Uhr in einem Anwendungs-, Adapter-, HTTP- oder
  Domänenpaket lässt den Test fehlschlagen, auch wenn dort kein Aufruf steht.
- Der Selbsttest `TestModuleLiveClockRatchetCountsCallsNotReferences` belegt
  beide Zählungen an Beispielbäumen, einschließlich der Ausnahme für
  Kompositionspakete.
- Uhren der Datenbank (`now()`, Trigger, Spaltenvorgaben) erfasst das Register
  nicht.
