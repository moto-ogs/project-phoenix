---
status: accepted
---

# Identity & Access bezieht seine Uhr aus der Komposition

Entscheidung vom 2026-11-16 für
[#7104](https://github.com/moto-ogs/project-phoenix/issues/7104), Schnitt
Identity & Access. Sie wendet
[ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md) und
[ADR 0240](0240-stoppuhren-sind-keine-uhr-und-care-plan-bezieht-seine-uhr-aus-der-komposition.md)
auf `modules/identityaccess` an und führt keinen neuen Owner ein.

## Kontext

Identity & Access hatte mit 83 direkten Uhr-Aufrufen das zweitgrößte Budget
in `TestModuleLiveClockRatchet`. Dazu kamen 15 Konstruktoren, die
`now: time.Now` selbst banden (Schuleinladung, Passwort-Reset, Träger-Konten,
Betreiber-Tokens, Zweiter Faktor, Passkeys, Demo, Aufbewahrung). Tests
konnten diese Uhr nicht erreichen. Sitzungs- und Token-Lebensdauern,
Einladungsfristen, Sperren und Schreibstempel hingen deshalb am echten Tag.
Neun Testdateien standen mit 33 Funden in
`calendarFixtureShiftedLiveDateDebt`.

Mehrere Entscheidungen verglichen zwei Uhren. Betreiber-Einladungen,
E-Mail-Wechsel, Betreiber-MFA-Codes und Demo-Zugänge bekamen `created_at`
von der Datenbank. Ratenbegrenzung, Abkühlzeit und Aufräumen verglichen
diesen Wert mit einem Zeitpunkt der Go-Uhr. Das Fenster der
Passwort-Reset-Begrenzung begann bei SQL-`NOW()`, sein Ende prüfte die
Go-Uhr. Die Einladungsliste der Schulkonten filterte mit `NOW()` auf
`expires_at`, das die Go-Uhr gesetzt hatte. Ein Lauf mit vorgestellter
Go-Uhr am 02.01.2027 ließ auf der Basis 20 Tests von Identity & Access
scheitern. Die Einladungsmails für Eltern und Caterer zählten ihre
Gültigkeit mit `time.Until`.

## Entscheidung

1. **Eine Uhr pro Komposition.** `compose.Dependencies.Now` ist die Uhr des
   Owners. Die Wurzel reicht `RootEnvironment.Now` durch. `nil` bedeutet
   die echte Uhr, wie bei `RootEnvironment.Now` im Serving-Root.
   `postgres.Store` und `application.Service` verlangen die Uhr im
   Konstruktor. Konto- und Betreiber-Authentifizierung, Lebenszyklus,
   Reset, Caterer, Betreiber-Tokens, Betreiber-MFA und Passkeys lesen die
   Uhr ihres Service. Schuleinladung, Konto-MFA, Demo, Träger-Konten und
   die beiden Aufbewahrungsjobs bekommen sie über ihre Abhängigkeiten. Der
   Session-Codec, `sessiontoken.TokenAuth`, die Demo-Routen, die
   Einladungs-Lesezugriffe und die Invalidierung nehmen die Uhr der Wurzel
   als Parameter.
2. **Eine Uhr pro Entscheidung.** Betreiber-Einladungen, E-Mail-Wechsel,
   Betreiber-MFA-Codes und Demo-Zugänge schreiben `created_at` aus der Uhr
   des Stores. Eine Sitzung ohne Stempel bekommt ihn ebenfalls von dort.
   Das Passwort-Reset-Fenster beginnt und rollt auf der Uhr des Stores, die
   Schulkonten-Liste filtert offene Einladungen mit ihr. Die Mails für
   Eltern- und Caterer-Einladungen zählen ihre Gültigkeit ab der Uhr ihrer
   Zustellung. Reine Schreibstempel wie `updated_at = NOW()` entscheiden
   nichts und bleiben bei der Datenbank. Dasselbe gilt für Entscheidungen,
   die ganz in SQL fallen: die Löschfrist deaktivierter Betreiber und die
   Zeitfenster der Springer.
3. **Zwei Aufrufe bleiben.** `portalauth.PasswordResetRetryAfter` ist die
   `RetryAfter func(error)` von `api/common.PasswordResetRoutes`. Fünf
   Portal-Router bauen sie ohne Uhr. `decode` in `sessiontoken` bedient die
   paketweite Middleware (`ParseVerified`, `Authenticator`,
   `AuthenticateRefreshJWT`, `RateLimitKey`). Diese Middleware nennt keine
   Uhr, und davor prüft der jwtauth-Verifier `exp` mit der jwx-Uhr. Beide
   Stellen ließen sich nur mit einer Änderung öffentlicher Verträge
   injizieren.
4. **Tests.** Tests, die Identity & Access direkt komponieren, laufen auf
   Montag, 16.11.2026, 09:00. Tests hinter dem jwtauth-Verifier oder
   `api/common.SetTrustedDevice` laufen nicht auf einer festen Go-Uhr, denn
   jwx und `time.Until` lesen die echte Zeit. Ihre Fixtures laufen deshalb zu
   einem festen Zeitpunkt im Jahr 2100 ab.
5. **Budgets und Bindungen.** Das Compose-LOC-Budget von
   `modules/identityaccess/compose` steigt um die Zeilen der Uhr: Feld,
   nil-Default und Importe (+17, 1.372 auf 1.389). Die 225 Effekt-Bindungen,
   deren Körper oder Spur sich nur durch die Uhr geändert hat, sind mit
   dieser ADR neu bestätigt. Das sind 161 in Identity & Access, 36 in Care
   Plan, 18 in People Directory und 10 in Communication. Die 14
   E4-Ausnahmen in Care Plan tragen diese ADR als `approval_adr`. Effekt und
   Einstufung bleiben gleich.

## Folgen

- Das Uhr-Budget fällt von 665 auf 584 Aufrufe, Identity & Access von 83
  auf 2.
- `calendarFixtureShiftedLiveDateDebt` verliert 9 Dateien mit 33 Funden.
  Alle Einträge unter `modules/identityaccess/` und
  `api/operator_mfa_verify_success_internal_test.go` entfallen.
- Die Pass-through-Evidenz von Identity & Access verliert 4 Einträge. Die
  MFA-Record-Methoden lesen die Uhr des Stores und leiten nicht mehr nur
  weiter. 4 Texte haben sich geändert.
- Ratenbegrenzungen (Betreiber-Links, Betreiber-Codes, Passwort-Reset), die
  Abkühlzeit der Demo und die Einladungsliste messen gegen die Uhr des
  App-Servers statt gegen die Uhr der Datenbank. In Produktion liegen beide
  wenige Millisekunden auseinander.
- Mit vorgestellter Go-Uhr scheitern am 02.01.2027 noch 6 Tests von Identity
  & Access, am 03.07.2028 noch 7. Ihre Fixtures oder Entscheidungen lesen
  SQL-`NOW()` oder die Uhr von Delivery. Das ist erwartet, solange
  PostgreSQL nicht mitläuft.
