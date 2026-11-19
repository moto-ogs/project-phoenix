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
7. **Was Reflection nicht sieht, wird ausdrücklich angemeldet:** Enums,
   Query-Parameter und die Form eines Strings, der einen Tag oder eine Uhrzeit
   trägt (Feld-Tag `contract:"date"` oder `contract:"clock"`). Die Prüfung von Eingaben bleibt in Go (`Bind`) und
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

## Nachtrag vom 2026-11-16: Request-Bodys und ein zweites Portal

Zwei Schreibrouten (`POST /api/students/`, `PUT /api/students/{id}`) und eine
Leseroute des Elternportals (`GET /parent/me/enrollable-schools`) sind
angemeldet. Daraus folgen drei Ergänzungen:

- **Punkt 8 gilt auch beim Lesen.** Ein Request-Typ mit eigenem
  `UnmarshalJSON` braucht einen Eintrag, der sagt, was er liest: die Felder
  wie `encoding/json` oder zusätzlich jede Kennung als Zahl oder String. Ohne
  Eintrag bricht die Erzeugung ab.
- **Eine Kennung im Request ist im Client ein String**, außer Go liest das
  Feld noch nur als Zahl. Diese Felder stehen in derselben Liste der
  numerischen Alt-Kennungen und sind im erzeugten Typ `number`. Ihr Wechsel
  zu `common.ID` braucht zwei Releases in umgekehrter Reihenfolge zu Punkt 5:
  zuerst liest Go beide Formen, einen Release später sendet der Client
  Strings.
- **Eine Route, deren Antwort ein anderer Owner rendert**, meldet der Owner
  des Handlers an; die Wurzel nennt den Antworttyp, so wie sie auch die
  Antwortfunktion bindet.

## Nachtrag vom 2026-11-19: Dateien und Uploads

Für [#2352](https://github.com/moto-ogs/project-phoenix/issues/2352). Rund
170 Routendateien des Frontends reichen nur eine Datei-Antwort oder einen
Upload durch (`proxyFile`, `proxyUpload` und Verwandte). Der Katalog-Proxy
konnte das nicht: Er liest jede Antwort als JSON durch einen Decoder und jeden
Body als JSON. Jede dieser Routen brauchte deshalb eine eigene Datei.

### Entscheidung

1. **Datei und Multipart sind eigene Arten im Vertrag, kein JSON mit
   Decoder.** `common.RouteContract` meldet sie mit `File` (statt
   `Response`) und `Multipart` (statt `Request`) an. Im Modell stehen sie als
   `file` und `multipart`, im erzeugten Code als `response: fileAnswer` und
   `request: multipart`. Der Generator lehnt eine Datei-Route mit
   JSON-Antwort, einen Upload mit JSON-Body und einen Upload ohne Grenze ab.
2. **Der Proxy streamt beides ungelesen.** Die Datei geht mit den Headern
   durch, die `fileResponse` schon heute durchlässt (`Content-Type`,
   `Content-Disposition`, `Content-Length`, `X-Content-Type-Options`);
   `Range`, `ETag`, `Last-Modified` und `Accept-Ranges` gingen nie durch und
   gehen auch jetzt nicht durch. Jede Antwort einer Datei-Route ist
   `private, no-store`, auch eine Ablehnung, wie bei
   `withPrivateDownloadNoStore`. Ein Backend-Fehler bleibt sein
   Problem-JSON. Die Sandbox-CSP eines hochgeladenen Dokuments setzt
   `src/proxy.ts` weiter nach dem Pfad (`SANDBOXED_FILE_ROUTES`), gleich ob
   eine Routendatei oder der Katalog antwortet.
3. **Ein Upload nennt seine Grenze und seinen Code im Vertrag.**
   `MaxBodyBytes` ist die Grenze des ganzen Bodys mit Platz für den
   Multipart-Rahmen, `TooLargeCode` der Code, mit dem das Backend eine zu
   große Datei ablehnt. Der Proxy prüft `Content-Length` vor jedem
   Backend-Aufruf (fehlt sie: 411, ist sie zu groß: 413 mit diesem Code und
   `max_bytes`/`max_mb`) und zählt beim Streamen mit; ein längerer Body als
   angegeben bricht den Aufruf ab und wird ebenfalls 413.
4. **Ein Upload geht einmal.** Sein Body ist beim Senden schon unterwegs und
   lässt sich nach einer Sitzungserneuerung nicht wiederholen. Auth.js
   erneuert den Token fünf Minuten vor Ablauf
   (`ACCESS_TOKEN_REFRESH_BUFFER_MS`); ein 401 des Backends ist deshalb eine
   echte Ablehnung und wird so beantwortet. Ein JSON-Body einer Datei-Route
   (Brief-Vorschau per POST) wird begrenzt gelesen und darf wiederholt
   werden.
5. **Portal und Sitzung prüft der Proxy wie bei JSON.** Eine Route, die der
   Vertrag dem Portal nicht zuordnet, ist 404 vor Sitzung und Backend; ohne
   Sitzung 401; nur registrierte Query-Parameter gehen durch.

### Grenzen

- Öffentliche Datei-Routen (`public/*`, Feed- und Link-Routen mit Token)
  bleiben eigene Dateien. Der sitzungsfreie Weg des Proxys beantwortet nur
  JSON; der Generator lehnt eine öffentliche Datei oder einen öffentlichen
  Upload ab.
- Eine Datei, die mehr tut als durchzureichen (eigener Cache-Header für ein
  Logo, Umformung, Prüfung im BFF, mehrere Backend-Aufrufe), bleibt eine
  eigene Datei.
- Die Upload-Antwort ist JSON und läuft durch den Decoder der Route; sie hat
  danach die Hülle des Katalogs (`success`, `message`, `data`) statt der des
  Backends. Ein Client, der mehr als `data` liest, zieht beim Umzug mit.
- Ein gestreamter Upload läuft unter dem Header-Timeout des Backend-Clients
  (90 s ab Beginn des Sendens). Bisher lief er erst nach dem vollständigen
  Lesen an.

## Nachtrag vom 2026-11-19: Öffentliche Datei-Routen

Für [#2352](https://github.com/moto-ogs/project-phoenix/issues/2352). Vier
Routendateien reichten nur die Datei hinter einem Link durch: das PDF des
Vertragslinks (`/public/care-contract-signing/{link}/document`), die Datei
des Lohnbüros (`POST /public/payroll-download/{link}`), den
Unterschriftsnachweis des Anmelde-Statuslinks und die Formulardokumente des
Ferienlinks. Der erste Punkt der Grenzen des vorigen Nachtrags schloss sie
aus. Dieser Nachtrag ersetzt ihn für markierte Einzelrouten.

### Entscheidung

1. **Eine öffentliche Datei öffnet nur ein Merkmal ihrer Route.**
   `common.RouteContract.PublicFile` nennt den Grund, warum der Link im Pfad
   allein die Datei herausgeben darf. Es gibt keinen Schalter für ein Portal
   oder einen Mount. Der Generator lehnt ab: eine öffentliche Datei ohne
   Merkmal, das Merkmal an einer Route, die keine Datei oder nicht nur im
   Portal `public` ist, eine öffentliche Datei mit Request-Body und jeden
   öffentlichen Upload. Im Modell steht es als `public_file`, im erzeugten
   Code als `publicFile`; der Proxy dient eine öffentliche Datei ohne diesen
   Wert nicht, auch wenn ein Eintrag ihn verlöre.
2. **Der Weg trägt keine Berechtigung des Geräts.** Der Proxy liest keine
   Sitzung und ruft das Backend mit `sendBackend(…, null, …)`: kein Bearer,
   keine Cookies, kein Body, kein `Idempotency-Key`. Ein angemeldetes
   Schulgerät öffnet den Link also wie jeder andere Browser.
3. **Die Grenze bleibt die des Backends.** Der BFF hatte für diese Links nie
   ein eigenes Limit. Begrenzt wird je Client-IP im Backend:
   `careContractSigningRateLimit`, `holidayRegistrationRateLimit`, das Limit
   `enrollment-link` über `isPublicEnrollmentRequest` (es liest die
   Routentabelle der Anmeldung, also auch die neue Route) und für das
   Lohnbüro der allgemeine Limiter, der ohne Bearer nach IP zählt.
   `sendBackend` gibt die IP weiter (`X-Forwarded-For`, siehe
   `docs/agents/contracts.md`, Client IP and rate limits); ein 429 geht mit
   `Retry-After` durch. Ein verstümmelter Link erreicht jetzt das Backend
   statt einer BFF-Prüfung und verbraucht damit ein Token des Limits.
4. **Status und Fehler sind die des Backends.** Das Backend antwortet einem
   ungültigen, verbrauchten oder fehlerhaften Link schon mit dem Code, den
   der BFF vorher selbst setzte: 410 `care_contract.signing_link_invalid`
   (`parseLink` in Care Contract) und 404
   `workforce.payroll_download_unavailable` (`parsePayrollLink`). Die
   Vorprüfungen im BFF entfallen.
5. **Jede Antwort ist privat und ungespeichert.** Datei, Ablehnung und
   Fehler tragen `private, no-store`, gleich was das Backend sendet. Die
   Datei geht mit `Content-Type`, `Content-Disposition`, `Content-Length` und
   `X-Content-Type-Options` durch, ungepuffert.
6. **Der Pfad ist der Backend-Pfad.** Der Nachweis bekommt die Route
   `GET /api/enrollment/requests/{statusToken}/signature-proof`, denn
   `?format=pdf` an der Statusroute kann der Katalog nicht als zweite
   Antwortart führen; `?format=pdf` bleibt im Backend für Bestandsaufrufe.
   Das Ferienformular ruft `/api/traeger/holiday-registrations/…` über den
   Proxy des Trägers statt `/api/holiday-registrations/…`.

### Grenzen

- Ein Upload ohne Sitzung (Nachweise der Anmeldung und des Ferienlinks)
  bleibt eine eigene Routendatei.
- Ein Link, dessen Datei der BFF prüft oder umformt, bleibt eine eigene
  Datei. Eine neue öffentliche Datei braucht das Merkmal, einen Kopf in
  `CATALOG_PUBLIC_OUTSIDE_MOUNTS`, wenn sie neben dem Mount liegt, eine
  Freigabe in `HOST_RULES` von `src/proxy.ts` für jeden Portal-Host, der sie
  öffnet, und die Log-Redaction ihres Pfads im BFF und im Backend.
- Befristete oder signierte Datei-URLs sind nicht Teil dieser Entscheidung.
