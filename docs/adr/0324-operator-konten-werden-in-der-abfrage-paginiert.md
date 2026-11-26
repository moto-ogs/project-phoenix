---
status: accepted
---

# Operator-Konten werden in der Abfrage paginiert

[#8089](https://github.com/moto-ogs/project-phoenix/issues/8089) ersetzt die
unbegrenzten Kontoabrufe der Operator-Oberfläche. Die Reihenfolge hängt
je nach Spalte von Schule, Konto, Person, Einladungsrolle oder pädagogischer
Rolle ab. Keine dieser Domänen besitzt die vollständige Lesesicht.

Die Leseprojektion `operator-account-directory` besitzt keine Tabellen und
schreibt nicht. Ihr Grant nennt nur die dafür erforderlichen Tabellen.
Organization & Tenancy prüft die ausgewählte Schule oder den Träger in
derselben administrativen Transaktion. Die Routen bleiben hinter den
Operator- und Audit-Middlewares. Die Projektion ist kein Teil des
Operator-Dashboards (ADR 0033): Sie zeigt konkrete Personen und Einladungen
statt Kennzahlen und braucht dafür andere Leserechte.

Die Abfrage zählt Treffer getrennt von den Anzeige-Details. Sie wählt
höchstens 50 Zeilen für die Ausgabe und einen weiteren Schlüssel für den
Folgezustand. Rollen und Betreuungsmerkmale fließen erst auf der gewählten
Seite ein, außer wenn gerade nach einem dieser Merkmale sortiert wird.
Ein Konto mit Zugang zu zwei Schulen bleibt in beiden vertreten.
Eine offene Einladung entfällt wie bisher, wenn dieselbe E-Mail-Adresse
bereits eine aktive Zuordnung an dieser Schule hat. Ob die Einladung noch
offen ist, entscheidet dieselbe Datenbankuhr, die sie ausstellt und einlöst
(ADR 0285, Nachtrag). Dafür liest die Projektion die Uhr einmal pro Abfrage.

Die bisherigen drei GETs behalten ihre Datenfelder und den Auditpfad.
Sie liefern zusätzlich Paginierungs-Metadaten; es gibt keinen
unbegrenzten Aufruf mehr. Die Reihenfolge hat einen eindeutigen
Schul- und Zeilenschlüssel. Der Cursor enthält keine Namen oder
E-Mail-Adressen, wird an die Auswahl gebunden und ist keine
Zugriffsberechtigung. Ist seine Zeile inzwischen aus der Trefferliste
verschwunden, muss die Ansicht von vorne laden.
