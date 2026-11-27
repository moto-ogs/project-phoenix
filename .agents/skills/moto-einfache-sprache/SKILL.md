---
name: moto-einfache-sprache
description: Use when writing or reviewing ANY user-facing German text in the moto/Project-Phoenix apps (tenant portal, parents portal, PyrePortal kiosk, e-mails, help guide) - labels, buttons, error messages, empty states, notifications, explanatory copy. Triggers on new UI copy, Fehlermeldungen, Hinweistexte, or when the user asks to simplify texts.
---

# Einfache Sprache für moto-Nutzer

## Zielgruppe

Betreuungskräfte und Eltern an OGS-Schulen. Sie nutzen die App nebenbei, unter Zeitdruck, oft auf dem Handy, mit sehr gemischter Technik-Erfahrung. Viele lesen Deutsch nicht als Muttersprache. Jeder Text muss beim ersten Lesen sitzen, ohne Vorwissen über Browser, Server oder Apps.

Diese Zielgruppenbeschreibung ist intern. Sie taucht nie in Commits, PR-Texten, Code-Kommentaren oder UI-Texten auf.

## Kernregeln

1. **Keine Technik-Wörter.** Verboten in UI-Texten: Server, Browser (wenn vermeidbar), Push, System-, konfiguriert, eingerichtet, Session, Token, synchronisieren, Cache, Endpunkt, aktivieren/deaktivieren.
   - aktivieren → einschalten, deaktivieren → ausschalten
   - "auf diesem Server nicht eingerichtet" → "hier zurzeit nicht verfügbar"
   - "Systembenachrichtigung auf diesem Gerät" → "direkt auf dieses Gerät"
2. **Ein Gedanke pro Satz, maximal ~12 Wörter.** Lieber zwei kurze Sätze als ein Schachtelsatz.
3. **Sagen, was die Person TUN kann, nicht was das System hat.** Wenn sie nichts tun kann: kurz sagen, dass es gerade nicht geht und dass es nicht an ihr liegt. Interne Ursachen (Config, Server, Bug) gehören ins Log, nie in den Text.
4. **Fehlertexte beruhigen.** Muster: "Das hat leider nicht geklappt. Bitte versuche es noch einmal." Keine Schuldzuweisung, kein Fachjargon, keine Fehlercodes.
5. **Anleitungen als nummerierbare Mini-Schritte** in der Reihenfolge, in der man sie sieht ("Unten auf das Teilen-Symbol tippen, dann ‚Zum Home-Bildschirm' wählen").
6. **Konkrete Wörter aus dem Schulalltag**: Kind, Gruppe, Abholung, Krankmeldung, Gerät, Tablet. Die App heißt "moto", nicht "die Anwendung" oder "das System".
7. **Portale „du“, Mails und Briefe „Sie“ ([ADR 0328](../../../docs/adr/0328-portale-duzen-mails-und-briefe-siezen.md)).** Die Grenze ist der Kanal, nicht die Person.
   - **Portal-Texte** (alle Portale, Kiosk, Fehlermeldungen, Hilfe, In-App- und Push-Mitteilungen): „du/dein/dir/dich“ klein, an mehrere Personen „ihr/euch/euer“.
   - **Was moto verschickt** (jede E-Mail, auch an Personal, und jedes Schreiben: Bestätigung, Rechnung, Bescheid, Vertrag und die Bausteine darin): „Sie/Ihr/Ihre/Ihnen“ groß, auch an eine Familie. Nutzt eine Mail die gewählte Anrede, beginnt sie mit „Liebe Frau Klein,“, sonst mit „Guten Tag Karin Klein,“; Vorname allein plus „Sie“ gibt es nicht.
   - Freundlich und sachlich, deutsch mit Umlauten (ä/ö/ü/ß). Keine em-dashes. Buttons benennen die Aktion in einem Wort oder zwei ("Einschalten", "Ändern", "Speichern").
   `scripts/check-du-form.mjs` (in `pnpm run check` und `check-changed.mjs`) prüft beide Richtungen: „Sie“ im Portal-Text, „du/ihr“ in Mail-Vorlagen und den Go-Dateien seiner Liste `OUTGOING`. Ein Mailtext in einer gemischten Go-Datei trägt den Kommentar `sie-anrede-erlaubt (ADR 0328): <Grund>`, ebenso ein gebundener Wortlaut im Portal; ein gebundenes „du“ oder ein „ihr“ der dritten Person im ausgehenden Text `du-anrede-erlaubt (ADR 0328): <Grund>`.
8. **Weglassen schlägt Erklären.** Erklärtext, der keine Entscheidung oder Handlung verändert, fliegt raus. Eine Karte braucht selten mehr als einen Satz unter der Überschrift.

9. **„Pro“ bei Mengen und Aufteilungen.** Schreibe „pro Kind“, „pro Schule“ und „pro Tag“. „Je nach“, „jeweils“ und „je …, desto …“ bleiben grammatisch richtig.

## Selbsttest vor dem Abschluss

Würde eine gestresste Betreuungskraft mit dem Handy in der Hand nach 3 Sekunden wissen, (a) was los ist und (b) was sie jetzt tippen soll? Wenn nein: kürzen und vereinfachen.

## Abgrenzung

- Gilt für alle nutzersichtbaren Texte der moto-Repos (project-phoenix, PyrePortal), inkl. E-Mails und Hilfe-Guide.
- Gilt NICHT für Operator-Portal (internes Team; Regel 7 gilt auch dort), Logs, Code, Entwickler-Doku.
- Bestehende Fach-Fehlerstrings, auf die anderer Code matcht (z.B. PyrePortal-Error-Mapping, `isPushConfigurationMissing`), nie ändern, ohne die Konsumenten zu prüfen.
