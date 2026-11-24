# ADR 0316: Die Demo-Link-Anfrage bleibt ein Website-Vertrag

Datum: 2026-11-24
Status: Akzeptiert

`POST /demo/access-requests` steht im Routenkatalog, liegt aber mit
`OutsidePublicAPI` außerhalb des Portalvertrags. Die getrennt veröffentlichte
moto-Website ruft ihn direkt auf und liest die 202 oder den Fehlercode aus
der Antwort. Kein Portal fordert Demo-Links an. Ein Portalproxy würde hier
eine ungenutzte zweite Adresse schaffen. Der öffentliche Vertrag steht
unter [Demo access](../agents/contracts.md#demo-access-public-demo-3462).

Status, Sitzung und Neustart gehen dagegen durch die Portal-Route-Dateien.
Sie verwenden erzeugte Decoder; der Katalog prüft alle vier Routen auch
außerhalb von `APP_ENV=demo`.
