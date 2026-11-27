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
7. **Du-Form, nie „Sie“ ([ADR 0294](../../../docs/adr/0294-moto-spricht-alle-nutzer-mit-du-an.md)).** „du/dein/dir/dich“ klein, an mehrere Personen „ihr/euch/euer“. Ausnahme: Die Bestätigungsmail der Ferienanmeldung steht in der Sie-Form (Nachtrag 2026-11-27 der ADR). Freundlich und sachlich, deutsch mit Umlauten (ä/ö/ü/ß). Keine em-dashes. Buttons benennen die Aktion in einem Wort oder zwei ("Einschalten", "Ändern", "Speichern").
   `scripts/check-du-form.mjs` (in `pnpm run check` und `check-changed.mjs`) meldet „Sie“, „Ihnen“ und „Ihr…“ im Satz. Nur ein Wortlaut, den die Ausnahmen der ADR binden, bekommt direkt am Text den Kommentar `sie-anrede-erlaubt (ADR 0294): <Grund>`; ein JSON-Schlüssel einen Eintrag in `JSON_EXCEPTIONS` des Skripts.
8. **Weglassen schlägt Erklären.** Erklärtext, der keine Entscheidung oder Handlung verändert, fliegt raus. Eine Karte braucht selten mehr als einen Satz unter der Überschrift.

9. **„Pro“ bei Mengen und Aufteilungen.** Schreibe „pro Kind“, „pro Schule“ und „pro Tag“. „Je nach“, „jeweils“ und „je …, desto …“ bleiben grammatisch richtig.

## Selbsttest vor dem Abschluss

Würde eine gestresste Betreuungskraft mit dem Handy in der Hand nach 3 Sekunden wissen, (a) was los ist und (b) was sie jetzt tippen soll? Wenn nein: kürzen und vereinfachen.

## Abgrenzung

- Gilt für alle nutzersichtbaren Texte der moto-Repos (project-phoenix, PyrePortal), inkl. E-Mails und Hilfe-Guide.
- Gilt NICHT für Operator-Portal (internes Team; die Du-Form gilt auch dort), Logs, Code, Entwickler-Doku.
- Bestehende Fach-Fehlerstrings, auf die anderer Code matcht (z.B. PyrePortal-Error-Mapping, `isPushConfigurationMissing`), nie ändern, ohne die Konsumenten zu prüfen.
