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

> Geltender Stand: Alle Rollen verwenden `ident.ID`. Die HTTP-Naht
> schreibt und liest Dezimalstrings; gespeichertes JSON bleibt numerisch.
> Die Nachträge dokumentieren die Zwischenschritte und Geräte-Ausnahmen.

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
   Abweichend vom zuerst geplanten Wechsel in zwei Releases wechselt jedes
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

## Nachtrag vom 2026-11-21: Gespeichertes JSON behält Zahlen

Punkt 2 galt nicht lange. Fachtypen mit `ident.ID` gehen nicht nur in
Antworten, sondern auch in gespeichertes JSON: Audit- und Ereignis-Details,
Outbox-Payloads, Schnappschüsse und Fingerabdrücke. Datenbankfunktionen
vergleichen dort Kennungen als Zahl, etwa der Trigger
`enrollment.holiday_time_model_keeps_booked_history`
(`details->'before' @> jsonb_build_array(jsonb_build_object('time_model_id', OLD.id))`)
oder die Löschfunktionen der Demo-Daten (`details->'contract_ids' @> to_jsonb(contract.id)`).
Ein Test der Gruppe Anmeldung zeigte, dass der Trigger mit String-Kennungen
nicht mehr greift. Rund 270 `json.Marshal`-Aufrufe außerhalb der HTTP-Schicht,
viele mit `any`, lassen sich nicht verlässlich einzeln absichern; Antworten
laufen dagegen zentral über `render.Respond`.

Entscheidung:

1. **`ident.ID` schreibt mit `encoding/json` eine Zahl**, wie `int64`.
   Gespeichertes JSON, Fingerabdrücke und Datenbankfunktionen bleiben, wie sie
   sind. `ident.ID` hat kein `MarshalJSON` und kein `MarshalText`; bun bindet
   ihn deshalb weiter als `bigint`.
2. **Nur Antworten schreiben Strings.** `wire.Marshal` (`sharedkernel/ident/wire`, neues Paket des Kernels) kodiert mit
   `encoding/json/v2`, `DefaultOptionsV1()` und einem Marshaler für
   `ident.ID`: byte-gleich zu `encoding/json`, nur Kennungen als String, auch in
   `any`, Listen und Zeigern. `api/common` setzt `render.Respond` darauf und
   bietet `common.RenderJSON` statt `render.JSON`. Der Vertragsabgleich im
   Testbuild kodiert ebenso und meldet jede angemeldete Antwort, die eine
   Kennung als Zahl schreibt.
3. Lesen bleibt unverändert: String oder Zahl.

Folgen: PyrePortal ist nicht betroffen, weil die IoT-Typen kein `ident.ID`
tragen. Tests, die Fachtypen direkt mit `encoding/json` kodieren, sehen
wieder Zahlen; Tests über den Router sehen Strings.

## Nachtrag vom 2026-11-21: Der Vertrag kennt keine Zahl-Kennung mehr

Mit dem letzten Schritt von Phase 2 ist die Liste der numerischen
Alt-Kennungen leer (1.025 Einträge am Anfang). Der Generator verliert alles,
was eine Antwort-Kennung als Zahl zuließ:

1. **Kein Register, kein Übergangs-Tag.** `NumericIDs`, die Dateien
   `numeric_ids_*.go`, die Art `legacy_id` und das Tag `contract:"legacy-id"`
   entfallen; `numeric_ids` steht nicht mehr in `contract.json`. Ein nacktes
   `int64` ohne Aussage bleibt ein Fehler des Generators.
2. **Lockeres Lesen nur in Requests.** Die Art `lax_id` (`ReadsLaxIDs`, ein
   von der Wurzel benannter Lesetyp) steht nur noch in einem Request; in einer
   Antwort lehnt der Generator sie ab. `common.JSONID` und die gleichartigen
   Typen in `schoolmembership/http` und `workforce/http/substitutions` gehen
   in `common.ID` bzw. `ident.ID` auf, die String und Zahl lesen.
3. **Strenger Decoder.** Jede Antwort-Kennung decodiert mit `int64String`;
   `int64StringOrNumber` gibt es im Frontend nicht mehr.
   `TestAnAnswerIdentifierIsOnlyAString` (`backend/api/contract`) hält das
   fest.
4. **`/auth/tenant/resolve` steht im Vertrag** als öffentliche Route.
   `tenant_id` und `organization_id` reisen als String; das Frontend ruft
   sie im Browser über `/api/auth/tenant/resolve` und den Katalog-Proxy
   auf, im Server über denselben Routeneintrag mit `contractGet`.
   Der Server-Cache speichert nur dekodierte Treffer und prüft bekannte
   Branding-Felder. `contractGet` nimmt den Slug im getypten `query` entgegen. Die
   Schulkennung der Oberfläche (`TenantInfo.tenantId`) ist ein String. Die
   Schulkennung im Sitzungstoken bleibt eine Zahl; die Vergleiche wandeln sie
   in Text.

Die HTTP-Hüllen `OptionalJSON` und `DeferredJSON` nutzen auch beim
   Lesen ihrer inneren Werte den strengen Wire-Decoder.

Der Wächter gegen neue Zahl-Kennungen ist damit der Generator selbst;
`scripts/check-contract-shrink.mjs` vergleicht nur noch die Routen ohne
Vertrag. Bewusst gegen „expand, then contract“ in einem Release liegt
zusätzlich: Ein offener Tab mit altem Bundle ruft `/api/tenant/resolve`, das
es nicht mehr gibt, bis er neu lädt.

## Nachtrag vom 2026-11-22: Eine Schreibweise für Kennungen

Nach Phase 2 standen im Backend drei Schreibweisen für dieselbe Kennung:
`common.ID` (in `http`-Rollen 428-mal), `ident.ID` (dort 311-mal, 75 Dateien
mischten beide) und `int64` mit der JSON-Option `,string` (130 Felder). Wer
eine Nachbardatei kopierte, erwischte oft den falschen Stil. Die Regel aus
Punkt 1 („HTTP-Typen nutzen `common.ID`“) ließ sich zudem nicht überall
halten: Mehrere `http`-Pakete dürfen `api/common` nicht importieren und
schrieben deshalb `ident.ID` (#7808).

Entscheidung:

1. **`ident.ID` ist der einzige Name einer Kennung, in jeder Rolle.** Der
   Alias `common.ID` entfällt; ohne ihn kompiliert der alte Name nicht mehr.
   Punkt 1 gilt ohne den Halbsatz über HTTP-Typen.
2. **Die JSON-Option `,string` macht keine Kennung.** Sie liest nur einen
   String und wirkt nicht auf Listen. Der Generator lehnt sie auf einem
   angemeldeten Typ ab, und `TestNoJSONStringOptionRatchet` (`backend/test`)
   lehnt sie in jeder Go-Datei des Backends ab, ohne Ausnahmeliste.
3. **Die Wire-Form bleibt.** Antworten schreiben `ident.ID` über
   `wire.Marshal` als String, wie vorher `,string`; Anfragen lesen jetzt
   zusätzlich eine Zahl. Zwei Typen gingen mit `,string` auch in
   gespeichertes oder gehashtes JSON: der Anhang-Schnappschuss einer
   Nachricht (`communication.ReservedMessageAttachments`), den die Antwort
   unverändert weitergibt, und die Revision der Personen-Zusammenführung
   (`staffpersonmerge`). Beide kodieren mit `wire.Marshal` und schreiben
   dieselben Bytes wie vorher.

## Nachtrag vom 2026-11-22: Keine Zahl-Kennung an der Client-Naht

Nach dem Generator blieben Kennungen als Zahl dort, wo er nicht hinsieht:
vier Request-Typen mit eigenem Leser für Zahl oder String (Art `lax_id`),
Körper, die ein Handler selbst decodiert, Demo-Routen des Seeders und
Antworten außerhalb des Vertrags (#7808).

Entscheidung:

1. **Die Art `lax_id` und `ReadsLaxIDs` entfallen.** Diese Felder sind
   `ident.ID`, das String und Zahl liest; ein eigener Leser macht aus einem
   `int64` keine Kennung mehr. `scripts/check-contract-compat.mjs` lässt in
   einem Request `string` oder `lax_id` der Basis zu `id` werden.
2. **`TestNoNumericIdentifierRatchet` (`backend/test`)** lehnt in jeder
   Struktur von `api/` und jeder `http`- und `inbound`-Rolle ein Feld `id`,
   `*_id` oder `*_ids` mit Ganzzahltyp ab. Nur die Kiosk-Geräte-API
   (`/api/iot/*`, `POST`/`DELETE /api/students/{id}/rfid`) behält Zahlen und
   markiert sie mit `contract:"number"`, weil PyrePortal v1.11.5 sie als Zahl
   liest; anderswo lehnt der Test die Marke ab. Eine weitere Ausnahmeliste
   gibt es nicht.
3. **`ident.ID` liest eine Zahl noch einen Release lang.** Offene Tabs des
   vorigen Frontends senden in vielen Körpern Zahlen; ein strenger Leser
   bräche sie beim Deploy (ADR 0270, „expand, then contract“). Nach dem
   nächsten Release liest `ident.ID.UnmarshalJSON` nur noch einen String.

## Nachtrag vom 2026-11-24: `ident.ID` liest weiter Zahlen

Punkt 3 vom 2026-11-22 entfällt. Der strenge Leser wurde nach dem Release
1.16.0 erprobt (#7723) und brach das Zurücklesen von gespeichertem JSON, das
nach dem Nachtrag vom 2026-11-21 Zahlen trägt (Betreuungsverträge,
Ferienanmeldungen), und den Seeder, der Zahlen sendet.

1. `ident.ID.UnmarshalJSON` liest weiter String oder Zahl.
2. Ob und wo eine Zahl vom Client abgelehnt wird, entscheidet #7987.
3. `scripts/check-contract-compat.mjs` lässt `lax_id` der Basis nicht mehr zu
   `id` werden; die Art trägt kein Release mehr.

## Nachtrag vom 2026-11-24: Strenge beim Lesen der HTTP-Anfrage

Dieser Nachtrag beantwortet die offene Frage aus Punkt 2 des vorigen Nachtrags (#7987).

1. HTTP-Anfragen lesen `ident.ID` nur als Dezimalstring. `api/common`
   setzt den Decoder für `render.Bind`. Handler und eigene Request-Leser,
   die JSON selbst lesen, verwenden `wire.Decode` oder `wire.Unmarshal`.
   Die Kiosk-Geräte-API behält ihre numerischen Felder.
2. `encoding/json` schreibt `ident.ID` weiterhin als Zahl und liest
   Zahlen wie Strings. Das betrifft unter anderem die gespeicherten
   Betreuungsverträge und den Verlauf von Ferienanmeldungen.
3. Seeder und Simulation schreiben ihre HTTP-Körper mit `wire.Marshal`.
   Ihre Portal-Kennungen sind `ident.ID`; numerische Kiosk-Felder bleiben
   `int64`.

## Text unter einem Kennungsnamen

`id`, `*_id` und `*_ids` sind Hinweise, keine Typen. Eine Bigint-Kennung
trägt `ident.ID`, keine von Hand formatierte Go-Zeichenkette. Ein Feld
mit echtem Text unter einem Kennungsnamen nennt in
`contract_text:"Begründung"` sein Format oder seine Herkunft, zum
Beispiel ein RFID-Tag, eine SEPA-Gläubigerkennung oder ein
Kalenderschlüssel aus mehreren Teilen. Der Vertrag führt die Begründung
als `text_reason`. Der Ratchet lehnt neue unmarkierte String-Felder an der
Client-Naht ab.
