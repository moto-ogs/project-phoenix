# Backend-Antwort passt nicht zum Vertrag

Alarm `contract-decode-failed` (#7809) aus
[`alerting/contract-decode.yml`](../grafana/provisioning/alerting/contract-decode.yml).
Er meldet je Route jede Antwort, die der Katalog-Proxy des Frontends abgelehnt
hat. Nutzer sehen dann einen Ladefehler oder bei Schreibrouten den Hinweis
`general.write_answer_unreadable` (die Änderung kann schon gespeichert sein).

## Woher die Zeile kommt

Der Katalog-Proxy prüft jede Backend-Antwort mit dem Decoder, den
`gencontract` aus der Go-Registrierung erzeugt (ADR 0270). Passt sie nicht,
antwortet er 502 und schreibt `contract_decode_failed` mit:

- `route`: Methode und Muster, etwa `GET /api/groups/{id}`;
- `write`: ob es eine Schreibroute ist;
- `issues`: Pfad und zod-Code jeder Abweichung, ohne Werte.

## Schritte

1. In Loki die Zeilen lesen:
   `{env="prod",service="frontend"} |= "contract_decode_failed" | json`.
   `route` und `issues` nennen Feld und Art der Abweichung.
2. Prüfen, ob Backend und Frontend aus demselben Stand stammen. Nach einem
   Deploy erst das Backend, dann das Frontend; ein Fenster zwischen beiden
   erzeugt diese Zeilen. Endet es mit dem Frontend-Deploy, ist nichts weiter zu
   tun.
3. Halten die Zeilen an, hat Go ein Feld anders gesendet, als der Vertrag
   sagt. Häufige Ursachen: ein Antworttyp, der an `wire.Marshal` vorbei kodiert
   (Kennung als Zahl), ein Feld, das Go als `null` schreibt, obwohl der Vertrag
   es nicht zulässt, ein entfernter Enum-Wert. Fehler im Repo nachstellen: den
   Router-Test der Route laufen lassen; der Vertragsabgleich im Testbuild
   meldet dieselbe Abweichung.
4. Fix im Backend (Antwort passend machen) oder im Vertrag (Go-Typ ändern und
   `go run . gencontract`), dann normal deployen. Kein Rollback nur des
   Backends: das neue Frontend scheitert an einem alten Backend.
