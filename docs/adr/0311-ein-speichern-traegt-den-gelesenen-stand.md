---
status: accepted
---

# Ein Speichern trägt den gelesenen Stand

Entscheidung vom 2026-11-23 für
[#7904](https://github.com/moto-ogs/project-phoenix/issues/7904), Folge aus
[#7898](https://github.com/moto-ogs/project-phoenix/pull/7898). Sie ändert
keinen Owner und keine Policy-Regel außer dem neuen Paket des Shared Kernel.

## Kontext

Seit #2828 lesen Seiten über einen gemeinsamen Cache (`useSWRAuth`): ein
erneuter Besuch zeigt sofort den bestätigten Stand und liest im Hintergrund
nach. Für Bearbeitungen, Löschvorschauen und Formularvorlagen schrieb
`frontend/src/lib/swr/README.md` dagegen `useFreshSWR` vor: bei jedem Öffnen
neu lesen und bis dahin nichts zeigen.

Das schützt nicht. Öffnen zwei Personen dieselbe Stelle, lesen beide frisch,
und wer zuletzt speichert, überschreibt den anderen still. Eine Vorschau, die
frisch gelesen wurde, kann bis zum Klick auf „Löschen“ veraltet sein. Nur der
Server kennt beim Schreiben den gespeicherten Stand. Die Bestandsaufnahme zu
#7904 fand etwa fünfzehn Speicherwege, die sich allein auf das frische Lesen
verließen, und daneben drei Formen einer echten Prüfung: eine
Versionsnummer aus `updated_at` (`expected_version`, Elternanfragen, 14
handgeschriebene Vergleiche, vier Fehlerwerte für denselben Fall), einen
Inhaltsvergleich (Speiseplan, #7898) und Fingerabdrücke von Vorschauen
(ADRs 0016, 0017, 0204, 0309).

Erwogen wurden:

1. **Frisch lesen beibehalten.** Verkleinert nur das Zeitfenster und kostet bei
   jedem Öffnen ein Skelett.
2. **HTTP `If-Match`/`ETag`.** Bräuchte Header im Routenvertrag, im Proxy und
   neben den SWR-Daten und widerspräche ADR 0270 („andere Routen erhalten
   keinen bedingten Header“). Listen, deren Zeilen je einen Stand tragen,
   passen nicht in einen Header.
3. **Ein Token im JSON-Körper, das der Server vergibt und prüft.** So arbeiten
   die meisten bestehenden Prüfungen schon; der Token reist mit den Daten im
   Cache.

## Entscheidung

Variante 3.

1. **Lesen geht über den gemeinsamen Cache.** Eine Seite darf einen älteren
   bestätigten Stand zeigen. Ausgenommen sind Lesezugriffe, die der Server bei
   jedem Öffnen protokolliert oder erst nach einer erneuten Berechtigung zeigen
   darf; sie lesen bei jedem Öffnen neu.
2. **Ein Speichern, das auf Gelesenem beruht, schickt dessen Token mit.** Eine
   Bearbeitung liest `version` und schickt `expected_version`. Ein Befehl, den
   eine Vorschau bestätigt, liest `fingerprint` und schickt
   `expected_fingerprint`. Der Token ist für den Client undurchsichtig.
3. **Der Owner prüft unter der Sperre, unter der er schreibt.** Er bildet den
   Token des gespeicherten Stands mit `sharedkernel/readstate`: `Of(updated_at)`
   für eine Zeile, `Fingerprint(v)` für alles andere (ein Tag, eine Menge, eine
   berechnete Vorschau, in kanonischer Form). `readstate.Check` lehnt einen
   anderen und einen leeren Token ab.
4. **Eine Ablehnung, ein Code.** `readstate.ErrChanged` ist eine fachliche
   Ablehnung (ADR 0006) mit dem Code `general.changed_since_read` und
   antwortet ohne Eintrag in einer Fehlertabelle mit 409. Der Client erkennt
   sie mit `isChangedSinceRead` (`frontend/src/lib/api-error.ts`), zeigt den
   gespeicherten Stand wieder und bietet nicht an, dieselbe Anfrage erneut zu
   senden.
5. **Vorlagen und Auswahllisten brauchen keinen Token.** Der Server prüft die
   Eingabe beim Speichern ohnehin; was die Person gesehen und abgeschickt hat,
   wird gespeichert.
6. **Bestehende Vorschau-Fingerabdrücke** (ADRs 0016, 0017, 0204, 0309,
   Zeugniswechsel, Kind löschen, Schließtag) sind dieselbe Regel und behalten
   ihre Codes; Codes werden nicht entfernt.

## Folgen

- `useFreshSWR` gilt nur noch als Übergang. Jede Stelle wird nach Punkt 1, 2
  oder 5 eingeordnet und umgestellt; danach bleibt nur das Lesen bei jedem
  Öffnen für protokollierte Zugriffe.
- Die Elternanfragen verlieren ihre vier Fehlerwerte und den leeren Token, der
  die Prüfung übersprang.
- Eine neue Prüfung braucht keinen neuen Fehlercode und keine neue Übersetzung.
- Der Speiseplan lehnt schon mit `general.changed_since_read` ab, schickt aber
  noch den gelesenen Tag statt eines Tokens (#7898); er zieht nach.
