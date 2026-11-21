---
status: accepted
---

# Kennungen sind ein Typ des Shared Kernel

Entscheidung vom 2026-11-21 für Phase 2 von
[#2342](https://github.com/moto-ogs/project-phoenix/issues/2342) (Welle 3 aus
[#2353](https://github.com/moto-ogs/project-phoenix/issues/2353#issuecomment-7060613165)).
Sie ergänzt [ADR 0270](0270-der-vertrag-zwischen-go-und-frontend-entsteht-aus-der-go-registrierung.md)
Punkte 4 und 5 und [ADR 0040](0040-every-role-may-import-the-shared-kernel.md).
Sie fügt das Paket `sharedkernel/ident` zum Owner `shared-kernel` (Rolle
`contract`) hinzu, keine Regel, keine Tabelle und keine Route.

## Kontext

Phase 2 lässt Go auf allen angemeldeten Routen Kennungen als JSON-String
senden. Am 2026-11-21 stehen 1.025 Felder in der Liste der numerischen
Alt-Kennungen (`backend/api/contract/numeric_ids_*.go`). Rund 700 davon liegen
nicht auf HTTP-Typen, sondern auf Fachtypen öffentlicher Modulpakete, die Go
direkt serialisiert (zum Beispiel `parentbilling`, `workforce`, `enrollment`).
Darunter sind etwa 30 Listen (`[]int64`) und einige Request-Typen.

Der Typ aus ADR 0270, `common.ID`, liegt in `api/common`. Das dürfen nur
`http`-Rollen importieren. Für die Fachtypen gab es drei Wege:

- `json:",string"` auf Skalaren. Das liest keine Zahl mehr, alte Clients
  würden scheitern, und auf Listen wirkt es nicht.
- Eigene Antworttypen in jeder `http`-Rolle für rund 700 Felder. Viel Code,
  und ein vergessenes Feld geht still als Zahl hinaus.
- Ein Kennungstyp, den jede Rolle importieren darf. Das ist der Shared
  Kernel. ADR 0040 hält dessen Typen als geschlossene Liste.

## Entscheidung

1. **`sharedkernel/ident.ID` ist der Kennungstyp für jede Rolle.** Er ist ein
   `int64`, schreibt sich als JSON-String und liest String oder Zahl.
   `common.ID` ist ein Alias darauf (`type ID = ident.ID`). Fachtypen nutzen
   `ident.ID`, HTTP-Typen weiter `common.ID`. Es bleibt ein Typ, und der
   Generator kennt ihn über denselben Eintrag.
2. **Der Typ schreibt sich über `MarshalText`, nicht über `MarshalJSON`.**
   bun schreibt einen Wert, dessen Zeiger `json.Marshaler` ist, als JSON-Text
   in die SQL-Anweisung: Ein `*ID` landete als `'"42"'` in einer
   `bigint`-Spalte. Eine `Value`-Methode würde das verhindern, braucht aber
   `database/sql/driver`, und der Kernel darf die Klasse `orm-sql` nicht
   importieren. `encoding/json` schreibt einen `TextMarshaler` als String,
   bun sieht ihn nicht. In der Datenbank bleibt die Kennung ein `bigint`.
   `TestIdentIDBindsAsBigint` (`backend/test`) hält das fest.
3. **ADR 0040 wird ergänzt.** Der Kernel trägt neben `Date`, `WallClock`,
   `TenantID` und `CorrelationID` die Kennung `ID`. Die Liste
   `shared_kernel_types` in `policy.json` bleibt in diesem Schritt
   unverändert: Der Architektur-Check liest die Basis-Policy mit dem neuen
   Prüfcode, eine geänderte Pflichtliste würde die Basis ablehnen. Die
   Liste folgt in einem eigenen Schritt, wenn sie gebraucht wird.
4. **Phase 2 geht in einem Deploy hinaus, nicht in zwei Releases.**
   Abweichend von ADR 0270 Punkt 5 und dem ersten Nachtrag wechselt jedes
   Feld direkt auf `ID` und den strengen Decoder `int64String`, ohne die
   Zwischenmarke `contract:"legacy-id"`. Bewusst gegen
   „expand, then contract“ in einem Release liegen:
   - **Strenger Decoder und String-Ausgabe gleichzeitig.** Läuft ein neues
     Frontend kurz gegen ein altes Backend, scheitert der Decoder an Zahlen.
     Ein offener Tab mit altem Bundle verträgt die Strings, weil sein Decoder
     aus Phase 1 beides nimmt.
   - **Request-Felder.** Die 189 Request-Felder liest Go heute nur als Zahl.
     Mit `ID` liest Go beides, der erzeugte Client sendet sofort Strings. Ein
     neues Frontend gegen ein altes Backend scheitert an diesen Feldern.
   - **Seeder und Simulation** lesen nach dem Wechsel nur das neue Format.
   Der Deploy-Hinweis (abends, Backend vor Frontend, Tabs neu laden) bekommt
   diese Liste. PyrePortal ist nicht betroffen: Seine Aufrufe auf
   `/api/iot/*` und `/api/students/{id}/rfid` stehen nicht im Vertrag.

## Folgen

- Fachtypen tragen mit `ident.ID` eine Entscheidung über ihre JSON-Form.
  Das ist dieselbe Art Entscheidung wie `calendar.Date` als `YYYY-MM-DD`.
- Rechnen mit Kennungen braucht `Int64()` oder eine Umwandlung.
  Listenhelfer kommen mit ihrem ersten produktiven Aufrufer hinzu.
- `common.JSONID` behält seine Wire-Form und liest wie `ident.ID`.
