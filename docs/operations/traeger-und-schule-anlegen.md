# Träger und Schule im Operator-Portal anlegen

Stand: 18.11.2026. Für das moto-Team. Beschreibt, wie ein neuer Kunde
eingerichtet wird: Träger, Schule, Module, Kinderkontingent, erste Zugänge.
Alle Schritte laufen im Operator-Portal. Die Anmeldung dort verlangt immer
einen zweiten Faktor. Jede Anlage, Einladung und Zuordnung schreibt einen
Eintrag ins Operator-Audit; scheitert er, wird nichts angelegt.

Reihenfolge: Träger → Schule → Module und Kinderkontingent → erste
Schul-Admin → Träger-Büro (falls gebucht). Die Schule richtet danach
Geräte-PIN und „Erste Schritte“ selbst ein.

## 1. Träger anlegen

Jede Schule gehört zu genau einem Träger. Eine Schule ohne Träger gibt es
nicht. Bei einer einzelnen Schule ohne eigenen Träger trotzdem einen Träger
anlegen, meist mit dem Namen des Vereins oder der Kommune.

1. Seite „Träger“ (`/operator/organizations`) → **„Neuer Träger“**.
   Die alte Seite `/operator/provisioning` leitet hierher um.
2. „Name“ eintragen, höchstens 200 Zeichen. Das Formular lässt 255 zu,
   der Server lehnt alles über 200 ab.
3. „Slug“ prüfen. Er wird aus dem Namen vorgeschlagen (ä → ae, ß → ss).
   Erlaubt: Kleinbuchstaben, Ziffern, Bindestrich innen; höchstens 100
   Zeichen; weltweit eindeutig. Reservierte Namen wie `www`, `api`,
   `operator`, `eltern`, `schule`, `traeger`, `admin`, `demo` lehnt der
   Server ab (Liste: `backend/modules/organizationtenancy/organizationtenancy.go`).
4. **„Erstellen“**. Es entstehen nur der Träger-Datensatz und der
   Audit-Eintrag. Es geht keine Mail raus, und niemand hat Zugang.

### Test-Träger statt echtem Träger

Für Probeläufe, Schulungen und Vorführungen: **„Test-Träger anlegen“** auf
der Seite „Träger“.

- Felder: „Name“, „Slug“ (höchstens 56 Zeichen), „Bundesland der
  Test-Schulen“, „Anzahl der Test-Schulen“ (1 bis 5), „Kontaktadresse der
  Test-Schulen“.
- Legt in einem Schritt den Träger und verborgene Schulen „Test-Schule N“
  mit den Subdomains `<slug>-test-1` usw. an, danach erfundene Kinder.
  Scheitern die Kinder, auf der Träger-Seite „Beispielkinder anlegen“
  wiederholen.
- Die Test-Markierung bleibt für immer. Ein Test-Träger wird nie ein echter
  Kunde. Für einen echten Kunden immer einen neuen Träger anlegen.

## 2. Schule anlegen

1. Träger-Seite → Reiter „Schulen“ → **„Neue Schule“**, oder Seite
   „Schulen“ → **„Neue Schule“**.
2. „Träger“ **ausdrücklich auswählen**. Auch von der Träger-Seite aus ist
   der aktuelle Träger nur vorausgewählt, wenn es genau einen gibt.
3. „Bundesland“ wählen. Danach richten sich Feiertage und Schulferien. Fehlt
   es, scheitert jede Kalenderanzeige der Schule.
4. „Name“, höchstens 200 Zeichen (Formular erlaubt 255).
5. „Slug“ und „Subdomain“ prüfen. Beide werden aus dem Namen vorgeschlagen,
   bis man sie von Hand ändert.
   - Slug: eindeutig innerhalb des Trägers.
   - Subdomain: weltweit eindeutig, höchstens 63 Zeichen. Sie ist die
     Adresse der Schule. Später ändern bricht Lesezeichen und Links.
6. „Kontaktdaten“ (optional). Die „E-Mail“ ist die Antwortadresse für
   Mails an Eltern; nur eine einfache Adresse ohne Namen.
7. „Sichtbarkeit“: „Sichtbar“ für echte Schulen. „Verborgen“ nimmt die
   Schule aus der Schulauswahl; per direktem Link bleibt sie erreichbar.
8. **„Erstellen“**. Der Server legt in einem Schritt an:
   - die Schule, aktiv,
   - zehn Standard-Kategorien für Angebote (Sport bis Mensa),
   - das virtuelle Gerät „Web-Portal (Manuell)“,
   - die Einstellung Bundesland.

   Es geht keine Mail raus, und niemand hat Zugang.

## 3. Module und Kinderkontingent

Auf der Schul-Seite (`/operator/organizations/<träger>/schools/<schule>`).

**Module:** „Einstellungen“ → Reiter „Module“. Jede neue Schule hat **alle
Module gebucht**. Abschalten, was der Vertrag nicht enthält. Abhängigkeiten
und Bedeutung je Schalter: [Modulschalter](../reference/modulschalter.md).

**Kinderkontingent:** Button „Kinderkontingent“, Felder „Anzahl Bundles“ und
„Kinder pro Bundle“ (je 1 bis 1000). Ohne Eintrag gilt „Keine Grenze“. Ist
das Kontingent erreicht, kann die Schule keine weiteren Kinder anlegen.

## 4. Erste Schul-Admin einladen

1. Schul-Seite → Reiter „Konten“ → **„Admin einladen“**.
2. „E-Mail“ (Pflicht), „Vorname“ und „Nachname“ (optional).
3. „Auch in der Betreuung einsetzen“ ankreuzen, wenn die Person auch selbst
   betreut. Dann zusätzlich „Position“ wählen.
4. **„Einladung senden“**. Der Dialog zeigt danach den Zustellstatus. Bei
   einem Mailfehler die Adresse prüfen und neu einladen.

Wichtig:

- Die Schule muss aktiv sein, sonst scheitert die Einladung. Der Status lässt
  sich auf der Schul-Seite ohne Rückfrage umschalten; nicht versehentlich
  deaktivieren.
- Die Einladung gilt 48 Stunden (Einstellung
  `INVITATION_TOKEN_EXPIRY_HOURS`, höchstens 168). Den Link gibt es nur in
  der Mail.
- Die Person bekommt die Rolle `admin`. Neue Adresse: Passwort setzen.
  Vorhandenes moto-Konto: in einem anderen Tab anmelden und bestätigen.
  Operator-Konten können keine Einladung annehmen.
- Beim ersten Login fragt moto den zweiten Faktor ab („Code an meine E-Mail
  senden“). Darauf vorbereiten.

„Konto erstellen“ (Passwort setzt das moto-Team) ist die Ausnahme, etwa für
Test-Schulen. Für echte Kunden die Einladung nutzen, damit das Passwort nur
die Person kennt.

## 5. Träger-Büro einladen (falls Träger-Portal gebucht)

Träger-Seite → Reiter „Träger-Büro“.

- **„Person einladen“** für Personen ohne moto-Konto: „E-Mail-Adresse“ und
  mindestens eine Rolle, dann „Einladung senden“. Eine offene Einladung an
  dieselbe Adresse wird ersetzt. Gültigkeit wie in Abschnitt 4.
- **„Person zuordnen“** für Personen mit moto-Konto: „E-Mail des Kontos“ und
  Rollen, dann „Zuordnen“. Es geht keine Mail raus; der Person Bescheid geben.

| Rolle | Darf |
|---|---|
| Leitung | Personen einladen, Rollen ändern, entfernen |
| Verwaltung | Anmeldungen, Verträge, Einstellungen, Protokoll |
| Dokumente | Dokumente hochladen, freigeben, löschen |
| Schulzugang | jede Schule des Trägers öffnen und dort alles verwalten |
| Abrechnung | Beiträge, Finanzexport |
| Personal | Personal aller Schulen |
| Nur lesen | Übersicht und Berichte |

Die erste Person bekommt in der Regel „Leitung“, damit der Träger weitere
Personen selbst einlädt.

## 6. Was die Schule danach selbst einrichtet

Das moto-Team kann diese Punkte nicht übernehmen und sollte die Schul-Admin
darauf hinweisen:

1. **Geräte-PIN**, nur mit gebuchter NFC-Anwesenheit: Einstellungen ›
   Geräte › Geräte-PIN, vier Ziffern, keine leichten Folgen wie 1234. Es gibt
   keinen Standardwert; ohne PIN melden sich keine Tablets an. Die
   Startseite zeigt bis dahin „Geräte-PIN fehlt“. Das Operator-Portal kann
   die PIN weder sehen noch setzen.
2. **„Erste Schritte“** auf der Startseite: Team einladen, Raum, Gruppe,
   erstes Kind, Eltern einladen, Arbeitszeitmodelle.

## 7. Geräte (optional)

Schul- oder Träger-Seite → Reiter „Geräte“ → **„Neues Gerät“**: „Schule“,
„Geräte-ID“, „Typ“, „Name“. Der API-Key erscheint **nur einmal**; sofort
sicher übergeben. „API-Key ändern“ sperrt den alten Key sofort für alle
Geräte, die ihn nutzen.

## Fehler korrigieren

- **Bearbeiten:** Name, Slug, Subdomain, Kontaktdaten, Sichtbarkeit und
  Träger lassen sich auf der Schul-Seite ändern. Der Dialog warnt bei Slug,
  Subdomain und Trägerwechsel. Das Bundesland steht in den Einstellungen der
  Schule.
- **Falsch angelegt:** „Löschen“, dann „Endgültig löschen“. Das ist eine
  weiche Löschung: Die Schule wird deaktiviert, alle Logins gesperrt, sie
  lässt sich wiederherstellen. Ein Träger lässt sich erst löschen, wenn alle
  seine Schulen gelöscht sind; beim Wiederherstellen kommen die Schulen nicht
  mit. Gelöschte Slugs und Subdomains sind vermutlich weiter belegt (nicht
  geprüft); dann einen anderen wählen.
- **Endgültig entfernen** (Daten löschen): [Mandantenlöschung](tenant-erasure.md).
- **„Deaktivieren“ am Träger** meldet sofort alle Personen aus dem
  Träger-Portal ab. Die Schulen arbeiten weiter.
