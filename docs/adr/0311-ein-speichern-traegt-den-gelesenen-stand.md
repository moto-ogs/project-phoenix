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

- Beim ersten Anzeigen einer Seite darf ihr Server-Render den vorhandenen
  Leseschlüssel mit einem Seed füllen (#8077, #8079). Der Seed gehört zur
  frischen Portal-Sitzung mit ihrem Schul- bzw. Trägerkontext. Er ersetzt
  keinen neueren Stand. Ohne brauchbaren Seed lädt derselbe Leser normal
  nach. Beim warmen Seitenwechsel zeigt die neutrale Hülle gültige SWR-Daten
  derselben Sitzung, ohne auf den neuen Seed zu warten (#8083). Protokollierte
  Öffnungen, GETs mit Seiteneffekt und Schreibvorschauen bleiben auch beim
  Wiederanzeigen durch React Activity an die jeweilige Aktion gebunden.
- `useFreshSWR` gilt nur noch als Übergang. Jede Stelle wird nach Punkt 1, 2
  oder 5 eingeordnet und umgestellt; danach bleibt nur das Lesen bei jedem
  Öffnen für protokollierte Zugriffe.
- Nachtrag (#7904): Das Frontend setzt die Regel an einer Stelle um.
  `useFreshSWR` und der zweite Mechanismus `openingReadOptions` sind durch
  `useOpeningRead` ersetzt (ein Lesen je Öffnen, nur noch für protokollierte
  Zugriffe), Bearbeitungen und Vorschauen nutzen `useReadDraft` bzw.
  `useDraftOn`, und `show(error, { reload })` zeigt eine Ablehnung erst mit
  dem neu gelesenen Stand oder mit dessen Ladefehler
  (`frontend/src/lib/swr/README.md`, „Reading and saving“).
- Die eigene Zeiterfassung (#8081) nimmt `version` aus dem gewählten Block
  des `period`-Reads. Bei einer Ablehnung lädt genau dieser Zeitraum mit
  `revalidateOrThrow` neu. Die Stempeluhr kann den Tabellen-Lesestand nicht
  ersetzen und liest unabhängig davon weiter.
- Die Elternanfragen verlieren ihre vier Fehlerwerte und den leeren Token, der
  die Prüfung übersprang. Ihr Token ist `readstate.Of(updated_at)` ohne
  eigene Funktion; ein Stand ohne Zeile (Ankunftszeiten einer Klasse) hat den
  Token der Nullzeit, damit auch das erste Speichern gebunden ist.
- Eine neue Prüfung braucht keinen neuen Fehlercode und keine neue Übersetzung.
  Das gilt an einer Stelle: `common.RenderError` hebt eine fachliche
  Ablehnung aus einem 5xx und aus einem 4xx ohne eigenen Code auf 409, und
  die Laufzeitmetriken (`observability`) zählen eine Ablehnung, die die
  Tabelle eines Owners als `internal_error` führt, mit ihrem Code. Kein
  Owner und kein Handler führt dafür einen eigenen Fall.
- Die Fingerabdrücke entstehen mit `readstate.Fingerprint`, auch die der
  Vorschauen mit eigenem Code (Zeugniswechsel, Kind löschen, Importe,
  Abrechnungsläufe); ihre Codes bleiben. Keiner nimmt einen leeren Token an:
  ein Zeugniswechsel ohne bestätigte Vorschau läuft nicht mehr. Weil sich einige Token-Werte dabei
  geändert haben, bekommt ein vor dem Release geöffneter Tab einmal die
  Ablehnung und liest neu. Die Zeilenversion der Abholberechtigungen (ADR
  0281) bleibt ein eigenes Register.
- Die Laufgemeinschaft eines Kindes und die Ankündigungen im Elternportal
  lehnen einen veralteten Stand mit `general.changed_since_read` ab.
  `students.companions_changed` bleibt registriert; der Client erkennt beide
  Codes, bis kein älteres Backend mehr läuft.
- Der Speiseplan (#7930) liest und schickt ein Token je Tag.
- Die Ankündigungen des Operator-Portals nennen ihren Token `edit_version`
  (`expected_edit_version`), weil `version` dort die Release-Bezeichnung ist.
- Auch die Fehlerrenderer des Operator-Portals führen keinen eigenen Fall:
  `common.OperatorInternal` behält den Fehler, damit `common.RenderError` die
  Ablehnung darin hebt (#7986).
- Die Anhänge einer Elternmitteilung gehören zu dem Stand, den ihre
  Veröffentlichung bestätigt: Hochladen und Entfernen schicken die Version
  des Entwurfs, stempeln ihn und antworten seine neue Version (#7986).
