# Rechtstexte der Online-Anmeldung

Die Online-Anmeldung zeigt am Ende Rechtstexte als Blöcke. Diese Seite legt
fest, was jede Blockart bedeutet, ob Eltern etwas ankreuzen müssen und was
moto als Nachweis speichert. Entscheidungen und Quellen: #2787.

Verantwortlich für die Texte ist die Schule oder der Träger; moto verarbeitet
im Auftrag. moto gibt Form und Pflichtregeln vor, den Inhalt schreibt die
Schule in den Einstellungen (`Rechtstexte`) oder in der Formularvorlage.

## Blockarten

| Art (`kind`) | Zweck | Häkchen | Pflicht | Widerruf |
|---|---|---|---|---|
| `terms` | Vertrags- oder Teilnahmebedingungen (AGB, Info-Brief), die für die Anmeldung gelten | ja | ja, ohne Häkchen kein Absenden | kein Widerruf; Kündigung nach den Bedingungen |
| `privacy_notice` | Datenschutzinformation nach Art. 13 DSGVO | nein | – | – |
| `notice` | Hinweis ohne Entscheidung, z. B. E-Mail-Kontakt für Rückfragen | nein | – | – |
| `consent` | freiwillige Einwilligung, z. B. Fotos | ja | nie (Art. 7 Abs. 4 DSGVO) | jederzeit für die Zukunft; der Text muss das sagen |

Regeln, die Backend und Editor durchsetzen
(`backend/modules/enrollment/legal_block_rules.go`,
`frontend/src/lib/enrollment-legal-blocks.ts`):

- **`privacy_notice` hat kein Häkchen.** Die DSGVO verlangt, dass die
  Information bereitgestellt wird, nicht, dass Eltern sie bestätigen
  (Art. 12, 13 DSGVO). Die Datenschutzkonferenz hält eine erzwungene
  Kenntnisnahme für unzulässig; als Nachweis genügt die Dokumentation des
  Ablaufs ([DSK-Beschluss vom 05.09.2018](https://www.datenschutzkonferenz-online.de/media/dskb/20180905_dskb_aerzte.pdf)).
  Ein Pflicht-Häkchen würde zudem wie eine Einwilligung wirken. Vorlagen,
  die vor #2787 mit Häkchen gespeichert wurden, zeigen den Block ohne
  Häkchen; der alte Standardsatz „Ich habe die Datenschutzinformation … zur
  Kenntnis genommen.“ wird durch „Hier findest du die
  Datenschutzinformation der Schule.“ ersetzt.
- **`consent` ist nie Pflicht.** Ein Pflicht-Häkchen ist eine `terms`-Zeile;
  das Backend lehnt `consent` mit `required` ab
  (`enrollment.legal_block_required_not_allowed`).
- **`notice` ist nie Pflicht.**
- Für `notice` und `privacy_notice` steht in `consent_flags` `true`: Das
  Formular hat den Block gezeigt. Nachweis und Unterschrifts-PDF nennen das
  „Angezeigt“, nicht „Zur Kenntnis genommen“.

## Einvernehmen der Sorgeberechtigten

Eine `consent`-Zeile kann `guardian_agreement` tragen (Editor: „Einvernehmen
aller Sorgeberechtigten abfragen“). Dann bestätigt das Häkchen zusätzlich:
„Ich handle dabei im Einvernehmen mit allen anderen sorgeberechtigten
Personen meines Kindes.“

Gedacht für Fotos im Internet. Bei gemeinsamer Sorge vertreten beide Eltern
das Kind (§ 1629 Abs. 1 BGB); die Veröffentlichung von Kinderfotos im
Internet ist eine Angelegenheit von erheblicher Bedeutung, für die beide
zustimmen müssen ([OLG Düsseldorf, 20.07.2021, 1 UF 74/21](https://nrwe.justiz.nrw.de/olgs/duesseldorf/j2021/1_UF_74_21_Beschluss_20210720.html)).
Ein Elternteil darf den anderen dazu ermächtigen (§ 1627 BGB); die Bestätigung
dokumentiert das. Fotos für interne Aushänge brauchen sie nicht, deshalb
schaltet die Schule sie je Block ein. Die Ferienanmeldung des Trägers fragt
das Einvernehmen nicht ab.

Grenze: Bestätigt ein Elternteil das Einvernehmen falsch, bleibt die
Einwilligung unwirksam. Widerspricht der andere Elternteil, nimmt die Schule
das Foto heraus.

## Einwilligung für Gesundheitsangaben

Fragt eine Vorlage ein Feld mit dem Ziel `student.health_info` ab, fügt moto
die Zeile `health_data` hinzu (`consent`, Reihenfolge 45, Text fest in
`HealthConsentBlock`). Gesundheitsangaben sind besondere Daten (Art. 9
Abs. 1 DSGVO); weder der Betreuungsvertrag noch die Datenschutzinformation
sind dafür eine Grundlage. Deshalb gilt die ausdrückliche Einwilligung
(Art. 9 Abs. 2 lit. a DSGVO), wie schon bei der Ferienanmeldung:

- Das Gesundheitsfeld ist nie Pflicht; das Backend speichert es als
  freiwillig. Die Anmeldung geht ohne Gesundheitsangaben und ohne
  Einwilligung durch (Art. 7 Abs. 4 DSGVO).
- Steht etwas im Gesundheitsfeld und fehlt das Häkchen, lehnen Formular und
  Backend ab (`enrollment.health_consent_required`). Das gilt auch für
  Bearbeitungen, Änderungsanfragen und Erfassung durch die Schule.
- Der Schlüssel `health_data` ist für eigene Blöcke gesperrt.
- Medikamentengabe gehört nicht in dieses Feld, sondern in eine eigene
  schriftliche Vereinbarung.

Offen für anwaltliche Prüfung: ob eine angekreuzte Einwilligung die
Schriftform erfüllt, die § 16 Abs. 2 DSG NRW öffentlichen Stellen für
Gesundheitsdaten vorschreibt.

## Nachweis (Snapshot)

Jede Abgabe der Eltern hängt einen Eintrag an `legal_blocks_snapshot` an
(Art. 5 Abs. 2, Art. 7 Abs. 1 DSGVO). Er enthält je gezeigtem Block:
Schlüssel, Art, Titel, Satz neben dem Häkchen, Text mit SHA-256, Anhänge mit
Prüfsummen, `required`, Quelle, angebotene Übersetzungen und bei
`guardian_agreement` den Einvernehmens-Satz (`guardian_agreement_label`).
Dazu kommen die gefilterten `consent_flags`, der Zeitpunkt und die
Formularversion. Die Schule sieht den Nachweis in der Anmeldung unter den
Rechtstexten.

Diese Seite ist eine Recherche, keine anwaltliche Beratung.
