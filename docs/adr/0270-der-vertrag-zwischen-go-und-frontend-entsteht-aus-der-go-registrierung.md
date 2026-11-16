---
status: accepted
---

# Der Vertrag zwischen Go und Frontend entsteht aus der Go-Registrierung

Entscheidung vom 2026-11-16 für
[#2342](https://github.com/moto-ogs/project-phoenix/issues/2342), Schritt A von
[#2341](https://github.com/moto-ogs/project-phoenix/issues/2341). Sie steht
neben [ADR 0006](0006-fehleridentitaet-ist-der-code.md): Die regelt den
Fehlervertrag, diese den Erfolgsvertrag.

## Kontext

Der Routenkatalog (`backend/api/route_catalog.go`) kennt je Route nur Methode
und Pfad. Go antwortet über `common.Respond(..., data interface{}, ...)`, der
Antworttyp geht an der Grenze verloren. Das Frontend wiederholt die Formen in
rund 590 handgeschriebenen `Backend*`-Interfaces und prüft sie zur Laufzeit
nicht. Weicht Go ab, fällt das erst im Betrieb auf.

Ein Versuch hat zwei Wege an drei Schüler-Leserouten mit den echten Go-Typen
gebaut ([Vergleich](https://github.com/moto-ogs/project-phoenix/issues/2342#issuecomment-6913818489)):

1. einen eigenen Generator, der die Go-Registrierung liest und TypeScript-Typen
   und zod-Decoder schreibt;
2. OpenAPI als Zwischenformat, verarbeitet von `@hey-api/openapi-ts`.

Der schwierige Teil war in beiden derselbe: `omitempty` gegen `null`, Zeiger,
eingebettete Structs und eigene `MarshalJSON`-Typen löst ein Go-Walker über
Reflection. OpenAPI ersetzte nur den Teil, der TypeScript schreibt. Dafür
scheiterte der zweite Weg an zwei Stellen:

- Die Schülerliste antwortet je nach `?view` in drei Formen, ohne
  Unterscheidungsfeld. OpenAPI kann das nur als `anyOf` sagen. Eine
  `slim`-Zeile wurde als `names` dekodiert, die übrigen Felder fielen stumm
  weg. Swift und Kotlin erzeugten dafür einen leeren Typ.
- `format: int64` wurde im Decoder zu `bigint`, im erzeugten Typ zu `number`.

## Entscheidung

1. **Die Go-Registrierung ist die Quelle des Vertrags.** Eine Route meldet
   Methode, Pfad, Portal, Query-Parameter, Request-Typ und Antworttyp an. Die
   Anmeldung liegt in der `http`-Rolle ihres Owners, die Wurzel sammelt sie
   ein (ADR 0068 Punkt 2), und sie muss eine Zeile des bestehenden Katalogs
   sein.
2. **Ein eigener Generator schreibt den Frontend-Code.** Ein `cmd`-Unterbefehl
   übersetzt die Anmeldungen in ein Modell (`contract.json`) und schreibt
   daraus TypeScript-Typen und zod-Decoder. Modell und erzeugter Code sind
   committet; ein veralteter Stand lässt `scripts/check-changed.mjs` und CI
   scheitern. OpenAPI ist nicht das Zwischenformat. Eine OpenAPI-Ausgabe aus
   demselben Modell bleibt für native Clients möglich und ist dann eine eigene
   Entscheidung.
3. **Keine neue Route, deren Antwortform von einem Query-Parameter abhängt.**
   Eine Variante bekommt ein Unterscheidungsfeld oder einen eigenen Pfad.
   `GET /api/students/` ist die eine benannte Altlast; ihre Liste im Generator
   darf nur schrumpfen.
4. **Kennungen angemeldeter Routen tragen einen eigenen Go-Typ** (`common.ID`),
   der sich als JSON-String schreibt und String oder Zahl liest. `int64` ist
   auch ein Zähler, und `,string` wirkt nicht auf Slices; weder Feldname noch
   Tag können die Sperre tragen. Ein nacktes `int64` auf einem angemeldeten
   Typ lehnt der Generator ab, außer das Feld steht in der Liste der
   numerischen Alt-Kennungen. Auch diese Liste darf nur schrumpfen.
   `common.JSONID` behält seine Wire-Form.
5. **Eine Route, die heute Zahlen sendet, wechselt in zwei Releases.** Zuerst
   nimmt der erzeugte Decoder String und Zahl und gibt einen String heraus.
   Einen Release später sendet Go Strings. Eine Zahl jenseits von 2^53 lässt
   den Decoder scheitern, statt eine gerundete Kennung herauszugeben.
6. **Decoder vertragen Versionsunterschiede.** Sie ignorieren unbekannte
   Felder und scheitern an fehlenden oder kaputten Pflichtfeldern. Ein
   angemeldeter Enum ist im Typ eine Vereinigung seiner bekannten Werte, der
   Decoder nimmt aber jeden String: Ein neuer Wert aus Go darf ein älteres
   Frontend nicht brechen.
7. **Was Reflection nicht sieht, wird ausdrücklich angemeldet:** Enums und
   Query-Parameter. Die Prüfung von Eingaben bleibt in Go (`Bind`) und
   erreicht den Client über den Fehlervertrag; die Anmeldung wiederholt sie
   nicht.
8. **Ein Typ mit eigenem `MarshalJSON` braucht einen Eintrag im Generator.**
   Ohne Eintrag bricht die Erzeugung ab.

## Folgen

- Der Generator verlinkt die `http`-Pakete aller angemeldeten Routen. Mit
  jeder Route nähert sich sein Build dem des Servers; gemessen warm unter
  einer Sekunde, kalt so lang wie der Server-Build.
- Ein Vergleich des Modells mit dem Basis-Branch lässt CI scheitern, wenn ein
  angemeldetes Feld oder eine Route ohne Zwischenschritt entfällt oder
  umbenannt wird.
- Daten, die Go als `string` führt (`birthday`, `care_ends_on`), bleiben im
  Vertrag `string`, bis ihr Go-Typ `calendar.Date` ist.
- Ein `nil`-Slice schreibt Go als `null`. Verschachtelte Listen ohne
  `omitempty` sind im Vertrag deshalb `T[] | null`.
- Native Apps bekommen aus dem eigenen Generator je Sprache einen weiteren
  Schreiber. Fertige Generatoren über OpenAPI setzen Punkt 3 voraus.
- Verworfen: ein handgepflegtes OpenAPI-Dokument als Vertrag (#2341) und
  OpenAPI als Zwischenformat (dieser Versuch).
