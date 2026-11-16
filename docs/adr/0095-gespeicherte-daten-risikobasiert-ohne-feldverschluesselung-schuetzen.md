---
status: superseded in part by ADR 0084, ADR 0171, ADR 0183 and ADR 0188
---

# Gespeicherte Daten risikobasiert ohne Feldverschlüsselung schützen

> **Teilweise abgelöst** seit November 2026: Gesundheits- und Bankdaten
> liegen feldverschlüsselt in der Datenbank (AES-256-GCM mit Security
> Runtimes Feld-Cipher, an Spalte, Mandant und Zeile gebunden). Für diese
> Daten gilt der Satz „keine Feld-/Dateiverschlüsselung in der Anwendung“
> nicht mehr:
>
> - Gesundheitsangaben der Ferienanmeldung und des Feriengasts (#4722,
>   Migration `1.15.725`, Ring `HEALTH_DATA_KEYS`):
>   [ADR 0084, Nachtrag 2026-11-01](0084-traeger-portal-liest-ueber-eine-projektion-und-schreibt-in-der-schule.md#nachtrag-2026-11-01-recht-gesundheitsangaben-sehen-4722).
> - Gesundheitsfeld der Kinder (#5472, Migration `1.15.730`):
>   `users.student_care_profiles.health_info` ist durch das versiegelte
>   `health_data` ersetzt, Ring `HEALTH_DATA_KEYS`. Dafür gibt es keine eigene ADR.
> - Bankdaten der SEPA-Mandate und -Lastschriften:
>   [ADR 0171](0171-sepa-mandat-gehoert-dem-zahler-der-familie-und-die-rechnung-haelt-es-fest.md),
>   seit [ADR 0183](0183-bankdaten-haben-einen-eigenen-schluesselring-und-einen-wiederholbaren-rekey.md)
>   mit dem eigenen Bankring `BANK_DATA_KEYS`.
> - IBAN, Kontoinhaber, Steuer-ID und SV-Nummer von Eltern und Personal (#6332,
>   Migrationen `1.15.836`/`1.15.837`, Klartextspalten mit `1.15.900` entfernt):
>   [ADR 0188](0188-bankdaten-von-eltern-und-personal-liegen-versiegelt-im-bankring.md).
>
> ADR 0171, 0183 und 0188 tragen noch `status: proposed`; ihr Code liegt auf
> `development`. Weiter gilt diese Entscheidung für Datei-Uploads (ohne
> Anwendungsverschlüsselung), für die übrigen Personal-, Eltern- und
> Kinderdaten sowie für Datenträger-, Sicherungs-, Diagnose- und
> Protokollmaßnahmen. Die Abwägung unten bleibt gültig: Der Anwendungsprozess
> erhält die Schlüsselringe als Umgebungsvariablen und kann jeden Wert öffnen.
> Aktueller Stand je Bestand:
> [Schutz gespeicherter Daten](../reference/schutz-gespeicherter-daten.md).

Entscheidung des Nutzers vom 23.10.2026, dokumentiert in Slice 3840-a für
[#3840](https://github.com/moto-ogs/project-phoenix/issues/3840).
Für Finanz-, Gesundheits-, Personal- und Kinderdaten gilt Option 1:
Datenträgerverschlüsselung beim Hoster nachweisen, getrennte verschlüsselte
Sicherungen nach #3836 betreiben, Diagnosezugriffe ohne Finanz-/Gesundheitsspalten
begrenzen und sensible Kopien in Änderungsprotokollen minimieren. Es wird
keine Feld-/Dateiverschlüsselung in der Anwendung eingeführt.

## Abwägung und Grenzen

Ein durch dieselbe Anwendung auf demselben Host nutzbarer Feldschlüssel
schützt nicht zuverlässig vor Übernahme dieses Hosts oder des entschlüsselnden
Anwendungsprozesses. Datenträgerverschlüsselung adressiert verlorene Medien,
Zugriffsbegrenzung interne Leser und Datenminimierung unnötige Kopien.
Asymmetrisch verschlüsselte Sicherungen trennen nach [ADR 0085](0085-backup-decryption-keys-stay-off-the-source-host.md)
die private Entschlüsselungsidentität vom Quellhost.

Feldverschlüsselung könnte dennoch bei einem gestohlenen reinen DB-Dump oder
einem beschränkten SQL-Lesezugriff schützen, wenn der Schlüssel dort nicht
verfügbar ist. Sie ist nicht wirkungslos. Option 1 verlangt stattdessen
wirksamen Schutz **aller** Dumps, Sicherungen und Diagnosewege. Ein externer
Schlüsseldienst mit eigenständiger Autorisierung wäre eine andere Architektur,
die bei geändertem Risiko erneut zu bewerten ist.

Die Alternative einer Feld-/Dateimigration würde auch alte Auditkopien,
Bestandsdaten, Schlüsselrotation und Wiederherstellung umfassen. Diese Kosten
allein rechtfertigen keinen unbeherrschten Klartextbestand. Im gewählten
Modell bleiben insbesondere Root, DB-Superuser und berechtigt kompromittierte
App-Zugänge ein gesondert zu begrenzendes Risiko.

## Folgen

**Akzeptiert ist die Maßnahmenwahl, nicht deren produktive Wirksamkeit.**
Datenträger-/Schlüsselnachweis 3840-c, Diagnose-Leserolle 3840-f und produktive
Backup-Abnahme sind offen. Für Gesundheitskopien in
`users.student_data_change_requests` ist die **Code-Abhilfe umgesetzt
(#4854, Slice 4844-a)**: neue `health_info`-Protokollwerte werden maskiert,
Migration `1.15.483` bereinigt den Altbestand. Rollout und produktiver Nachweis
einschließlich Restore bleiben nach dem
[Prüfablauf](../operations/gesundheitsangaben-aenderungsprotokoll-3840.md#elternportal-änderungsanfragen-slice-4844-a)
offen. Für Kinderfotos/Avatare ist die Code-Abhilfe umgesetzt
(#4852, Slice 3840-h): neue Dateien 0600, Zielverzeichnisse 0700. Bestand,
Rollout und produktiver Nachweis bleiben nach dem
[Foto-Runbook](../operations/private-fotodateien-3840.md) offen. Diese offenen
Punkte sind keine Ausnahmen der Entscheidung. Authentifizierte HTTP-Auslieferung
ersetzt keinen Schutz vor lokalem Dateizugriff. Der [Bewertungsstand](../reference/schutz-gespeicherter-daten.md)
benennt Quellen, Bedrohungen und offene Kriterien; der
[Mensch-Prüfablauf](../operations/datentraegerschutz-3840.md) beschreibt die
erforderlichen Betriebsnachweise. #3840 darf allein wegen dieses ADRs nicht
abgeschlossen werden.

Neue Datenarten, geänderte Hosting-/Schlüssel- oder Zugriffsmodelle,
Export-/Dumpwege, Kundenanforderungen oder Sicherheitsvorfälle erfordern
eine erneute Bewertung. Erweist sich Option 1 als unzureichend, sind die
Maßnahmen anzupassen, gegebenenfalls einschließlich Verschlüsselungsmigration,
Altbestand, Auditkopien und geprüftem Restore.
