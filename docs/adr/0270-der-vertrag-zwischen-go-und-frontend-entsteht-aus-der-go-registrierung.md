---
status: accepted
---

# Der Vertrag zwischen Go und Frontend entsteht aus der Go-Registrierung

> Die geltende HTTP-Form der Kennungen steht in Punkt 4 und 5 und in
> [ADR 0300](0300-kennungen-sind-ein-typ-des-shared-kernel.md).

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
4. **Bigint-Kennungen angemeldeter Routen tragen den Go-Typ `ident.ID`.**
   HTTP-Antworten schreiben Kennungen über `wire.Marshal` als
   Dezimalstrings. Der Generator lehnt ein nacktes `int64` auf einem
   angemeldeten Typ ab; ein Betrag oder Zähler nennt `contract:"number"`.
   Text unter einem Kennungsnamen trägt `contract_text:"Begründung"`; im
   Modell steht der Grund als `text_reason`.
5. **HTTP-Anfragen lesen Kennungen als Dezimalstrings.** Der erzeugte
   Request-Typ schreibt Strings, der erzeugte Antwortdecoder nimmt nur
   Strings. Gespeichertes JSON verwendet weiterhin die Standardkodierung
   und bleibt numerisch. Die Geräte-API bleibt außerhalb dieses Vertrags
   (ADR 0300). Die nachträgliche Typisierung von `string` zu `id` ändert
   keine bereits als Dezimalstring übertragenen Kennungen.
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

## Nachtrag vom 2026-11-24: Browser-Adresse und Status

Eine `RouteFile`-Registrierung hält den Go-Aufruf aus den Proxy-Listen.
`BrowserPath` nennt zusätzlich die Adresse einer Routendatei für
`bffPath`. Ohne sie bleibt der Go-Schlüssel serverseitig.
`BrowserOwnContract` lässt die Adresse zu, aber nicht den Go-Request oder
die Go-Antwort in `bffJson`, etwa bei der Cookie-Anmeldung. Weicht die
Methode ab, nennt `BrowserMethod` die Methode der Routendatei.
Alle JSON-Proxy-Wege behalten den Erfolgsstatus des Backends. Browser und
Server behandeln eine unlesbare Antwort nach `NoCommit` wie bei einem GET.

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

- **Punkt 8 gilt auch beim Lesen.** Eigene JSON-Leser für HTTP-Anfragen
  verwenden `wire.Decode` oder `wire.Unmarshal`. Die erzeugten
  Request-Typen verwenden für Kennungen Strings.
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
   `private, no-store`, auch eine Ablehnung. Ein Backend-Fehler bleibt sein
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
  eigene Datei. Siehe dazu den Nachtrag „Prüfungen und Umformungen gehören
  ins Backend“.
- Die Upload-Antwort ist JSON und läuft durch den Decoder der Route; sie hat
  danach die Hülle des Katalogs (`success`, `message`, `data`) statt der des
  Backends. Ein Client, der mehr als `data` liest, zieht beim Umzug mit.
  Berichtigt im Nachtrag vom 2026-11-21: Die Antwort hat seitdem die Hülle
  des Backends.
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

## Nachtrag vom 2026-11-20: Öffentliche Uploads

Für [#2352](https://github.com/moto-ogs/project-phoenix/issues/2352). Drei
Routendateien bauten das Multipart eines Uploads neu und gaben nur gelistete
Felder weiter: die Nachweise der Online-Anmeldung
(`/api/enrollment/{tenantSlug}/uploads`, ohne Sitzung), die Nachweise des
Ferienlinks (ohne Sitzung) und die Nachweise der Anmeldung im Elternportal.
Der erste Punkt der Grenzen des Nachtrags „Öffentliche Datei-Routen“ ließ die
beiden öffentlichen als Dateien stehen. Dieser Nachtrag ersetzt ihn.

### Entscheidung

1. **Ein öffentlicher Upload öffnet nur ein Merkmal seiner Route.**
   `common.RouteContract.PublicUpload` nennt den Grund, warum ein Formular
   oder Link ohne Sitzung eine Datei senden darf. Der Generator lehnt ab:
   einen öffentlichen Upload ohne Merkmal und das Merkmal an einer Route,
   die kein Multipart-Upload oder nicht nur im Portal `public` ist. Grenze
   und Code (`MaxBodyBytes`, `TooLargeCode`) bleiben Pflicht. Im Modell
   `public_upload`, im erzeugten Code `publicUpload`; der Proxy nimmt einen
   öffentlichen Upload ohne diesen Wert nicht an.
2. **Der Weg trägt keine Berechtigung des Geräts.** Kein Sitzungs-Lesen,
   `sendBackend(…, null, …)`: kein Bearer, keine Cookies, kein
   `Idempotency-Key`. `X-Forwarded-For` geht mit.
3. **Größe vor dem Lesen, Zählung vor dem Body.** Der Proxy prüft
   `Content-Length` vor dem Aufruf (fehlt: 411, zu groß: 413 mit dem Code
   der Route) und zählt beim Streamen. Das Backend zählt den Versuch je
   Client-IP und Schule bzw. Träger, bevor es den Body liest
   (`CountUploadAttempt`, `CountHolidayProofUpload`), dazu die Limiter der
   Anmeldung und des Ferienlinks; der BFF hatte kein eigenes Limit.
4. **Die Felder prüft das Backend.** Jeder der drei Handler nimmt genau eine
   Datei `file` und je einmal seine Textfelder an (`onlyFormParts`) und
   lehnt jeden anderen Teil mit 400 ab, bevor er speichert. Größe, Inhalt
   und Endung prüfte das Backend schon.
5. **Antwort.** JSON durch den Decoder der Route in der Hülle des Katalogs,
   `private, no-store`, Status des Backends (201). Seit dem Nachtrag vom
   2026-11-21 ist das die Hülle des Backends.

### Grenzen

- Ein gestreamter Upload hält während des Sendens eine Verbindung zum
  Backend; vorher puffert der BFF ihn vollständig. Die Zählung je IP
  geschieht trotzdem vor dem ersten gelesenen Byte.
- Eine neue öffentliche Upload-Route braucht das Merkmal, eine IP-Zählung
  im Handler vor dem Lesen, die Freigabe ihres Pfads in `HOST_RULES` und
  die Log-Redaction eines Tokens im Pfad.

## Nachtrag vom 2026-11-19: Prüfungen und Umformungen gehören ins Backend

Für [#2352](https://github.com/moto-ogs/project-phoenix/issues/2352). Viele
Datei-Routen hatten nur deshalb eine eigene Datei, weil der BFF etwas prüfte
oder umformte, was der Go-Handler ohnehin tut. Entscheidung: Solche Routen
ziehen auf den Katalog; es gibt keine Ausnahmen und keine befristeten Dateien.

- **Dateityp und -name nennt das Backend.** Jeder Datei-Handler setzt
  `Content-Type` und `Content-Disposition` selbst; der Proxy ergänzt nichts.
  Ein Ersatztyp im BFF (`fallbackType`, `ICS_FILE`) entfällt.
- **Prüfungen liegen im Handler.** Eine Zahl-Prüfung von IDs, eine
  Format-Prüfung oder eine Query-Auswahl im BFF entfällt; der Handler lehnt
  ungültige Werte mit 4xx ab, und der Vertrag nennt nur die Parameter, die er
  liest.
- **Der Client spricht das Backend-Format.** Er ruft den Backend-Pfad mit
  dessen Parametern und sendet den Body so, wie der Handler ihn bindet. Ein
  Pfad-Parameter, der im BFF zur Query wurde, ist im Client wieder Query.
- **Der Proxy puffert nicht.** Eine Datei, die das Backend ohne
  `Content-Length` streamt, geht ohne diesen Header durch.

## Nachtrag vom 2026-11-20: Bilder, die der Browser behalten darf

Für [#2352](https://github.com/moto-ogs/project-phoenix/issues/2352). Drei
Datei-Routen hatten eine eigene Datei nur wegen ihres Cache-Headers: der eigene
Avatar, der Avatar einer Mitarbeiterin und das Logo des Trägers. Ihre Adresse
trägt die Version der Datei; ohne Cache lädt jede Liste jedes Bild neu.

- **Das Backend setzt den Cache-Header.** Der Handler entscheidet, wie lange
  der Browser die Datei behalten darf, auch abhängig von `?v`. Er setzt nur
  `private`-Werte.
- **Der Vertrag erlaubt das Durchreichen je Route.** `PrivateCache: true`
  (nur zusammen mit `File`) lässt den Proxy das `Cache-Control` des Backends
  durchreichen, wenn es `private` enthält und nicht `public`. Jeder andere
  Wert, ein fehlender Header und jede Ablehnung oder fehlende Sitzung bleiben
  `private, no-store`. Ohne das Merkmal bleiben Datei-Antworten
  `private, no-store`.
- Der Grenzfall „eigener Cache-Header für ein Logo“ ist damit keine eigene
  Datei mehr.


## Nachtrag vom 2026-11-20: Cache je Datei-Route und Abo-Adressen

Für [#2352](https://github.com/moto-ogs/project-phoenix/issues/2352). Sechs
Routendateien blieben, weil sie einen eigenen Cache-Header setzten: die
Kalender- und Anfrage-Abos (`/api/calendar-feed/{token}`,
`/api/request-feed/{token}`), Login-Bild und Rechtstexte der Anmeldung
(`/api/public/…`) und das Kinderfoto mit 304. Die Grenzen der beiden
vorigen Nachträge („eigener Cache-Header“, „Prüfung im BFF“) gelten für
diese Fälle nicht mehr.

### Entscheidung

1. **Ein Cache ist ein Merkmal der Route.** `common.RouteContract.FileCache`
   nennt den Cache-Control-Wert, den der Proxy auf einer ausgelieferten
   Datei behält (2xx, auf einer `ConditionalGet`-Route auch 304). Die Werte
   sind eine geschlossene Liste (`contractmodel.FileCacheValues`):
   `public, max-age=86400` (öffentliche Datei ohne Personendaten),
   `private, max-age=3600` (Abo-Feed), `private, max-age=86400, immutable`
   (Foto hinter einer Upload-URL). Der Generator lehnt einen anderen Wert ab,
   das Merkmal an einer Nicht-Datei oder einem Upload und einen
   `public`-Wert ohne `PublicFile`. Der Proxy führt dieselbe Liste und
   behält einen `public`-Wert nur auf einer markierten öffentlichen Datei.
   Ablehnungen, Sitzungsfehler und Backend-Fehler bleiben `private,
   no-store`. Der Handler sendet denselben Wert (`common.FileCache*`).
2. **Ein bedingter GET ist ein Merkmal der Route.** `ConditionalGet` (nur
   GET-Datei mit `FileCache`) reicht `If-None-Match` und
   `If-Modified-Since` durch und gibt ein 304 mit `ETag`, `Last-Modified`
   und dem Cache der Route zurück; auf 200 gehen beide Validatoren mit.
   Das gilt für Dateien mit und ohne Sitzung. Andere Routen erhalten
   keinen bedingten Header.
3. **Prüfungen des BFF liegen im Backend.** Die öffentlichen
   Upload-Ordner liefern über `common.ServePublicAsset` nur ihre Art aus:
   der Typ folgt der Endung, PDF für die Rechtstexte (inline mit Namen),
   JPEG/PNG/WebP/GIF für das Login-Bild (kein SVG), mit `nosniff`; eine
   andere Art ist 404 wie eine fehlende Datei, ein Name mit Pfad ebenso.
4. **Eine Abo-Adresse bleibt, der Pfad ist der des Backends.** Kalender-
   Apps und RSS-Leser behalten die Adresse vom Tag des Abos. Ein
   `beforeFiles`-Rewrite in `next.config.js` führt
   `/api/calendar-feed/:token` auf `/api/public/calendar/:token` und
   `/api/request-feed/:token` auf `/api/public/request-feed/:token`; dort
   antwortet der Katalog wie auf jede öffentliche Datei. `src/proxy.ts`
   prüft den Host vorher an der alten Adresse; die Log-Redaction im BFF und
   im Backend kannte beide Pfade schon.

### Grenzen

- Ein neuer Cache-Wert braucht einen Nachtrag und einen Eintrag in beiden
  Listen.
- Uploads ohne Sitzung folgen dem Nachtrag „Öffentliche Uploads“.

## Nachtrag vom 2026-11-21: Die Antwort hat die Hülle des Backends

Für [#2353](https://github.com/moto-ogs/project-phoenix/issues/2353)
(Kriterium 1). Der BFF schrieb jede Erfolgsantwort in eine eigene Hülle
`{ success, message, data }` (`wrapInApiResponse`), das Backend antwortet in
`{ status, data, message }` (`common.Response`), eine Liste dazu mit
`pagination` (`common.PaginatedResponse`). Zwei Formen für dieselbe Antwort
hießen: jeder Client musste wissen, welche Schicht er vor sich hat, ein
Payload mit eigenem `success`-Schlüssel ging ungewrappt durch, und eine Liste
durch die Datenbank-Dienste verlor die Seite des Backends.

### Entscheidung

1. **Der BFF reicht die Hülle des Backends mit den dekodierten Daten durch.**
   Der Katalog-Proxy antwortet `status`, die vom Decoder der Route geprüften
   `data`, die `pagination` einer Liste und die `message` des Backends, auch
   bei Uploads und öffentlichen JSON-Routen. Eine eigene `route.ts` antwortet
   über `successResponse` in derselben Form (`{ status: "success", data }`).
   Der geteilte Typ ist `ApiResponse` / `PaginatedApiResponse` in
   `frontend/src/lib/api-envelope.ts`; Clients führen keine eigene Hülle.
2. **Ohne Daten.** Eine `NoData`-Route antwortet `{ status: "success",
   data: null }` mit der Nachricht des Backends; ein DELETE ohne Daten
   antwortet 204. Auch ein 204 aus Go wird geprüft. Verspricht der Vertrag
   Daten, ist die leere Antwort ein Vertragsfehler. Eine leere 200 ist
   auch für `NoData` ein Vertragsfehler.
3. **Kein nacktes Payload.** Gegen eine Antwort nur aus `data` spricht, dass
   rund 130 Client-Dateien `.data` lesen und alle mitziehen müssten, ohne
   dass ein Leser etwas gewinnt; für sie spräche nur ein kürzerer Body. Die
   Hülle des Backends behält, was Clients schon lesen, und streicht die
   zweite Form.
4. **Ein Schritt.** Es läuft eine Instanz, der Deploy kommt am Ende; offene
   Tabs laden nach dem Release neu. Kein externer Client liest die Hülle des
   BFF: PyrePortal ruft das Backend direkt, Dateien und Feeds streamen ohne
   Hülle.

### Grenzen

- Eine `route.ts`, die selbst eine Antwort baut (`Response.json`), bleibt
  dafür verantwortlich, keine dritte Hülle zu erfinden; Auth-Schritte mit
  eigener Form (Tokens, `session_renewed`) sind keine Erfolgshülle in diesem
  Sinn.
- Der Statuscode des Backends geht nur bei Uploads durch; JSON-Routen
  antworten 200 wie zuvor.

## Nachtrag vom 2026-11-22: Ausdrückliche Merkmale statt Namen

Nach der Kette #2341 hielt der Generator noch zwei Regeln, die man nur aus
der Geschichte verstand (#7808): Ein `int64`, dessen Go-Name auf `Cents`
endete, galt als Betrag (124 Felder), entgegen Punkt 4. Und welche POST-Route
nichts festschreibt, stand als Liste von 23 Einträgen ohne Grund im Frontend
(`READ_ONLY_POST_ROUTES`), außerhalb des Vertrags.

Entscheidung:

1. **Ein Betrag oder Zähler als `int64` sagt es mit `contract:"number"`.**
   Die Namensregel `Cents` entfällt. Ein nacktes `int64` bleibt ein Fehler.
2. **Eine Zahl unter dem Namen einer Kennung bricht ab.** Ein Feld `id`,
   `*_id` oder `*_ids`, dessen Wert eine Zahl ist (`int`, `int64` mit
   `contract:"number"`), lehnt der Generator ab. Der Name macht keine Kennung,
   wie Punkt 4 sagt; er fängt nur die vergessene: Die Abnahme in #2353 ließ
   ein `RoomID int` unerkannt durch.
3. **`NoCommit` ist ein Merkmal der Route.** Eine POST-Route, die nichts
   festschreibt, worum ihr Aufrufer bitten kann (Vorschau, Suche, Lesen mit
   Body), nennt den Grund in `common.RouteContract.NoCommit`. Der Generator
   schreibt ihn an die Route; Katalog-Proxy und `contractWrite` lesen ihn und
   bieten bei einer unlesbaren Antwort Wiederholen statt Neuladen an. Nur ein
   POST darf ihn tragen. Er ist nicht die Freigabeliste der Lesevorschau
   (`api/common/readonly_preview.go`): Eine Import-Vorschau schreibt nichts
   fest, aber eine Audit-Zeile.
4. **`contract.Legacy` entfällt.** Die Wurzel baut ihre `Options` selbst; die
   eine Route mit Query-Varianten (`GET /api/students/`, Punkt 3) steht dort
   mit Verweis auf diesen ADR. Die Art `legacy_id` verlässt auch die
   Kompatibilitätsprüfung.

## Nachtrag vom 2026-11-23: Query-Typen und Pflichtfelder im Body

Für [#7945](https://github.com/moto-ogs/project-phoenix/issues/7945).

1. **Die Routeneinträge behalten die Art der Query-Parameter.** Der
   Generator schreibt je Schlüssel die Art, gegebenenfalls die erlaubten
   Textwerte und ob der Schlüssel sich wiederholen darf. `bffJson` und
   `bffFile` lesen nur diese Metadaten für ihre Typen, keine Zod-Form.
   Ein Datum ist ein Text im Format `YYYY-MM-DD`; TypeScript prüft den
   Texttyp, Go das Format und den Kalendertag. Der Proxy filtert weiterhin
   nur Namen und reicht jeden Wert unverändert zur Prüfung an Go weiter.
   `contractGet` wählt wie der Katalog-Proxy bei `GET /api/students/`
   den Decoder nach `view`; ohne Angabe gilt die Standardvariante.
2. **Alle Felder im erzeugten JSON-Body bleiben freiwillig.** Das ist
   keine Aussage darüber, ob der Handler eine Anfrage annimmt. Go bindet
   fehlende Felder als Nullwerte; erst die Prüfung im Handler entscheidet,
   ob ein Nullwert erlaubt ist. Pflicht kann vom Schreibvorgang oder
   einem anderen Feld abhängen. Weder `omitempty` noch der Go-Feldtyp
   bildet das ab. Eine zweite Feldliste für den Generator würde die
   Prüfung nur teilweise abbilden und könnte davon abweichen. Go bleibt
   deshalb die einzige Quelle dafür, welche Felder der konkrete Aufruf
   braucht. Der Client erhält eine Ablehnung über den Fehlervertrag.

## Nachtrag: Derselbe Decoder auf dem Server

Für [#8003](https://github.com/moto-ogs/project-phoenix/issues/8003):
Server-Module und Layouts lesen angemeldete JSON-Routen über `contractGet`
und schreiben über `contractWrite`. Der erzeugte Eintrag bestimmt den Pfad
und die Typen von `params` und `query`; es gibt keine freie Zieladresse.
Die Staff-Shell lässt nicht lesbare
optionale Startdaten aus; der Browser lädt sie auf dem normalen Weg.
Der Schul-Lookup prüft den öffentlichen Routeneintrag und speichert
dekodierte Treffer mit geprüften Branding-Feldern sowie 404, aber keine
anderen Fehler. Die Invalidierung gilt für Treffer und 404; der Generator
übernimmt die betroffenen Einstellungsschlüssel aus Go. Schulbezogene
Zusatzschlüssel bleiben offen. Der Wächter in `route-backend-paths.test.ts` prüft
auch Server-Module, nicht nur benannte BFF-Routen.

Katalog-Proxy und Vertragsclient lesen JSON auf demselben Fehlerpfad.
Eine unlesbare Erfolgsantwort, auch abgeschnittenes JSON, ergibt 502.
Kann die Änderung festgeschrieben sein, lautet der Fehlercode
`general.write_answer_unreadable`; bei GET und `NoCommit` bleibt der
Fehler wiederholbar. Ein 204 ersetzt keine zugesagten Daten.

## Nachtrag vom 2026-11-24: Getypte Datei-Adressen und Sitzungsanfragen

1. **Eine Datei-Adresse kommt aus dem Vertrag.** `bffFileHref` baut Links
   aus einem registrierten GET-Dateischlüssel mit getypten Pfad- und
   Query-Parametern. `bffFile` bleibt der Aufruf, der einen `Response`
   liefert. `bffPath` baut andere registrierte Adressen mit einem Routenschlüssel.
   Der Wächter prüft den Produktcode auf handgebaute Adressen, auch wenn
   Templates oder Verkettungen Konstanten und Hilfsfunktionen nutzen.
   Die Lint-Ausnahmen für ungetypte Aufrufe gelten pro Datei, Methode und
   Pfad für genau einen Aufruf.
2. **Ein Sitzungsschritt erbt den Request-Typ, nicht den Antworttyp.**
   `sessionBff` nutzt die erzeugten Request-Typen. Die Antwort der
   Oberfläche bleibt eine Projektion des dekodierten Backend-Ergebnisses:
   Sitzungstokens verlassen den Server nicht. Der Wächter für
   handgeschriebene Wire-Typen prüft auch Objektzweige von Unions.
3. **Auch bedingt gemountete Portalrouten haben einen Vertrag.** Das
   Routengolden ergänzt den Demo-Router ohne Laufzeitabhängigkeiten. Die
   Demo-Route-Dateien lesen Status, Sitzung und Neustart über erzeugte
   Decoder. Die separate Website fordert den Link direkt an
   ([ADR 0316](0316-demo-link-anfrage-bleibt-ein-website-vertrag.md)).
