# Schutz gespeicherter Daten

Stand: 23.10.2026, Slices 3840-a und 3840-f, Teil von [#3840](https://github.com/moto-ogs/project-phoenix/issues/3840)
und [#3846](https://github.com/moto-ogs/project-phoenix/issues/3846).
Geprüfte Codebasis: `origin/development` bei
`d780efb392ef4d085a5731e615533eead3ee652b`.
Nachprüfung der Dateischreibpfade in Runde 2 nach Merge von `origin/development`
bei `c66191b29879360e1eb6085ce46d716080a3b3be`.
Rollen-/Gesundheitshistorie gegen `origin/development` bei
`caca213bdb1bf4ef8ff9a5713875f88d3ebe5981` geprüft, ergänzt um Migration `1.15.488`.
Foto-/Avatar-Abhilfe aus [#4852](https://github.com/moto-ogs/project-phoenix/pull/4852)
(Slice 3840-h) nach Merge von `origin/development` bei
`6a8e863cf73047493a602a1abd058aa424761d2a` ergänzt.
Feldverschlüsselung von Gesundheits- und Bankdaten und Upload-Speicher am
16.11.2026 gegen `origin/development` bei
`07c2b285731e05ffe6460666a6614725c5f3da30` abgeglichen.

## Ergebnis und Nachweisgrenze

Gewählt war **Option 1 ohne Feld-/Dateiverschlüsselung in der Anwendung**:
Datenträgerverschlüsselung beim Hoster nachweisen, Sicherungen getrennt und
verschlüsselt betreiben, Diagnosezugriffe begrenzen und sensible Protokollkopien
minimieren. Entscheidung und Abwägung: [ADR 0095](../adr/0095-gespeicherte-daten-risikobasiert-ohne-feldverschluesselung-schuetzen.md).

ADR 0095 ist **teilweise abgelöst**. Gesundheits- und Bankdaten liegen
inzwischen feldverschlüsselt in der Datenbank: AES-256-GCM mit Security Runtimes
Feld-Cipher, jeder Wert an Spalte, Mandant und Zeile gebunden, Schlüssel-ID im
Chiffrat [D12]. Gesundheitsangaben nutzen den Ring `HEALTH_DATA_KEYS` (#4722,
#5472), Bankdaten den getrennten Ring `BANK_DATA_KEYS` (ADR 0183, ADR 0188).
Die versiegelten Spalten stehen in der Tabelle unten. Option 1 gilt weiter
für Datei-Uploads, die übrigen Personal-, Eltern- und Kinderdaten sowie
Datenträger, Sicherungen, Diagnosezugänge und Protokollkopien.

**Das Schutzniveau ist nicht produktiv nachgewiesen.** Insbesondere fehlen
Datenträger-/Schlüsselnachweis (3840-c), produktive Einrichtung/Abnahme der
Diagnose-Leserolle (3840-f) und Backup-Abnahme (#3836). Die Diagnoserolle
ist mit Migration `1.15.488` im Code umgesetzt und lokal getestet, nicht
produktiv nachgewiesen. Für Gesundheitsfreitext im Elternportal-Protokoll ist
die Code-Abhilfe umgesetzt (#4854, Slice 4844-a); Rollout und produktiver
Nachweis einschließlich Restore bleiben offen.
Für Kinderfotos und Avatare ist die Code-Abhilfe umgesetzt (#4852): neue
Dateien 0600, Zielverzeichnisse 0700. Bestand, Rollout und produktiver Nachweis
bleiben offen (Slice 3840-h). Beide Befunde und ihr Status stehen unten.
Diese Punkte sind keine akzeptierten Ausnahmen und verhindern den Abschluss
der betreffenden Akzeptanzkriterien. Der Verzicht auf Feldverschlüsselung
ist weder eine Freigabe dieser Lücken noch eine Bestätigung laufender Sicherheit.

„Im Code umgesetzt“ bezeichnet hier den gelesenen Implementierungsstand,
außer bei der Diagnoserolle 3840-f, deren lokale SQL-Verhaltenstests unten
benannt sind. „Produktiv nachgewiesen“ verlangt einen datierten Betriebsnachweis mit geprüftem Umfang.
Dieser Slice hat weder Produktions-/Stagingzugriff noch produktive Daten verwendet.
Wo „offen“ steht, liegt hier kein solcher Nachweis vor, nicht etwa der Beweis,
dass die Maßnahme im Betrieb fehlt.

## Diagnosezugang: im Code umgesetzt, produktive Abnahme offen

Migration `1.15.488` legt `phoenix_diagnostics` als NOLOGIN-Gruppenrolle ohne
RLS-Bypass, erhöhte Attribute oder Mitgliedschaften in anderen Rollen an.
Nur `id`, `tenant_id`, `created_at`, `updated_at` in `facilities.rooms`,
`education.groups` und `activities.groups` sind per Spalten-GRANT lesbar.
Alle Finanz-/Gesundheitstabellen, Protokollkopien, Freitexte, Konten und
Dokumentmetadaten bleiben ausgeschlossen, auch neue Tabellen/Spalten.
Die vorausgesetzte Migration `1.15.481` ersetzt MFA-PUBLIC-GRANTs durch explizite
App-Rollenrechte. Up und Down von `1.15.488` lassen diese Absicherung unverändert.
RLS begrenzt jede Transaktion auf die gewählte Schule; die interne Betriebsrolle
kann die Schul-ID selbst wählen und ist kein schulgebundener Kundenzugang.

Die lokalen `TestDiagnosticsReader*` prüfen erlaubte Metadaten, verweigerte
sensible Abfragen/Schreibzugriffe, zwei Schulen, zukünftige Tabellen/Spalten,
effektive Rechte einschließlich PUBLIC und Views, Funktions-/Rollenwechsel
sowie Up/Down. Systemkataloge und PostgreSQL-Statistikmetadaten bleiben sichtbar,
nicht SQL-Texte anderer DB-Nutzer.

In Produktion ist `phoenix_diagnostics` nicht in Gebrauch und hat keine
persönlichen LOGIN-Zugänge (Stand 14.11.2026); ein Runbook dafür gibt es nicht
mehr. Diagnose läuft dort über persönliche Rollen `dev_<name>`: Mitglied von
`pg_read_all_data`, `default_transaction_read_only=on`, 60 s Abfragezeit, ohne
Superuser und ohne RLS-Bypass, erreichbar über den Loopback-Port des Hosts.
Diese Rollen können alle Tabellen lesen, auch die oben ausgeschlossenen; RLS
begrenzt weiterhin auf die gewählte Schule, wo eine Policy besteht.
Feldverschlüsselte Spalten sehen sie nur als Chiffrat: Die Schlüsselringe
liegen nicht in der Datenbank, sondern in den Umgebungen von Server, Migrationsjob, Rekey-Befehl und
Mandantenexport [D12]. Unverschlüsselte Spalten wie Adressen, Notizen,
`extra_info` und Protokollinhalte bleiben lesbar.
Dieser Teil von AK3/AK4 bleibt offen.

## Bestand und Schutz im Code

Die Tabelle fasst die besonders schutzbedürftigen Bestände zusammen. Der
[gemeinsame Datenkatalog](datenkatalog.md) mit [ADR 0092](../adr/0092-mandanten-datenlebenszyklus-nutzt-einen-gemeinsamen-katalog.md)
bleibt die vollständige Tabellen-/Datei-Klassifizierung, nicht diese Auswahl.
Fristen und Löschpfade stehen in [Löschfristen](loeschfristen.md); es entstehen
hier keine neuen Aufbewahrungsfristen.

| Bestand | Im Code umgesetzt / gespeicherte Form | Produktiv nachgewiesen | Offen / Nachweisbedarf |
|---|---|---|---|
| `users.staff_financial_data`: IBAN, Steuer-ID, SV-Nummer | **Code umgesetzt (#6332, ADR 0188):** AES-256-GCM mit dem Bankring (`BANK_DATA_KEYS`), an Feld, Schule und Personal gebunden; gespeicherte IBAN-Maske, Finanzlesepfade maskieren ohne Öffnen und protokollieren Aufdecken [D1, D4] | Backfill 10.11.2026 in Staging, Produktion und Demo: zweiter Lauf `changed_total=0`, Klartextzeilen 0 | Klartextspalten entfernt (1.15.900, #6363); Abschlusslauf ohne Legacy-Ring je Umgebung (#6508); echte Rollen/DB-Zugänge, Datenträgerschutz; keine pauschalen Diagnose-SELECTs (3840-f) |
| `users.guardian_financial_data`: IBAN, Kontoinhaber | **Code umgesetzt (#6332, ADR 0188):** mit dem Bankring versiegelt, an Feld, Schule und Erziehungsberechtigten gebunden; IBAN aus der gespeicherten Maske, Aufdecken protokolliert. Kontoinhaber bleibt im Standardlesepfad sichtbar [D2, D4] | Wie oben | Wie oben |
| `users.student_care_profiles.health_data` (vorher `health_info`) | **Code umgesetzt (#5472):** Migration `1.15.730` versiegelt den Bestand mit `HEALTH_DATA_KEYS` und entfernt die Klartextspalte `health_info`; an Schule und Betreuungszeile gebunden. Care Plan versiegelt beim Schreiben, People Directory öffnet beim Lesen [D3, D12] | Offen | Rollout je Umgebung; Rollen, Datenträger und Erforderlichkeit je Einsatz; Exporte, Notfallliste und Mandantenrückgabe geben die Werte geöffnet aus; heruntergeladene Dateien sind Klartextkopien außerhalb der Anwendung |
| `enrollment.holiday_registrations`, `enrollment.holiday_registration_children`, `enrollment.holiday_guests`: `health_data` | **Code umgesetzt (#4722, ADR 0084 Nachtrag 2026-11-01):** Migration `1.15.725` versiegelt Gesundheitsangaben und Gesundheitsantworten der Ferienanmeldung und der Feriengast-Kopie mit `HEALTH_DATA_KEYS` und entfernt die Klartextspalten `allergies`, `medication` und `health_notes` der Kinder einer Ferienanmeldung [D12] | Offen | Rollout je Umgebung; Schlüsselablage und Rotation |
| SEPA-Daten in `parent_billing` (`sepa_mandates`, `sepa_debits`: IBAN und Kontoinhaber; `sepa_mandate_consents.text_sealed`; `sepa_debit_files.file_sealed`), Personalstamm des Trägers (`workforce.staff_records`: IBAN, Steuer-ID, SV-Nummer; `workforce.staff_record_changes.value_sealed`), SFTP-Passwort `config.traeger_export_recipients.password_sealed` | **Code umgesetzt:** Diese Werte waren nie Klartextspalten, die Tabellen wurden mit versiegelten Spalten angelegt; Bankring `BANK_DATA_KEYS` (ADR 0171, ADR 0183, ADR 0218) [D12] | Offen | Rollout, Schlüsselablage und Rotation wie oben |
| Personal-, Eltern- und Kinderdaten, insbesondere `users.persons`, `users.staff_master_data`, `users.staff_school_memberships`, `users.guardian_profiles`, `users.student_profiles`, `users.student_school_memberships`, `users.student_notes` | Fachliche Stammdaten, Adressen, Beschäftigung, Beziehungen und Notizen ohne Feldverschlüsselung; Zuordnung und Löschpfade im Katalog [D5] | Offen | Tatsächliche Rechte, Löschläufe, Datenminimierung und Fehlablagen in Freitext prüfen |
| `audit.staff_master_data_changes`, `audit.guardian_financial_changes`: `old_value`, `new_value` | Finanzwerte beim Schreiben maskiert: IBAN-Ende bleibt sichtbar, Steuer-/Sozialversicherungsnummer und geänderter Kontoinhaber vollständig maskiert. Andere Personalwerte und freie Notizen sind nicht pauschal maskiert [D4] | Offen | Version/Bestand und Freitext prüfen; aus aktuellen Schreibern folgt kein vollständiger Nachweis historischer Bereinigung |
| `audit.student_field_edits`: `health_info` | Nur Änderungsmarkierungen; Migration `1.15.475` bereinigt vorhandene Gesundheitswerte. `extra_info` und weitere Freitexte bleiben inhaltlich erhalten [D6] | Offen | Rollout und Bereinigung nach Restore nach [Prüfablauf](../operations/gesundheitsangaben-aenderungsprotokoll-3840.md); Maskierung ist keine Verschlüsselung |
| `users.student_data_change_requests`: `old_value`, `new_value` bei `target=student`, `field_key=health_info` | **Code umgesetzt (#4854, Slice 4844-a):** neue Werte maskiert; Migration `1.15.483` bereinigt historische Gesundheitskopien [D7] | Offen | Rollout, produktiven Nachweis einschließlich Bestandsbereinigung und Restore-Abnahme gesondert führen; Diagnose erhält keinerlei Tabellenzugriff |
| Zugriffs-/weitere fachliche Protokolle, insbesondere `audit.data_access_log` | Finanz-Aufdecken als eigener Zugriffstyp vorgesehen; weitere Protokolle enthalten Akteur-/Objektbezug und teils Personal-/Kinderdaten [D4, D5] | Offen | Nicht mit inhaltsfreier Protokollierung gleichsetzen; Rechte, Fristen und privilegierte Betriebszugriffe prüfen |
| Private Upload-Kinds `files`, `announcement-attachments`, `student-documents`, `staff-documents`, `enrollment-uploads`, `message-attachments` | Datei-Inhalte ohne Anwendungsverschlüsselung, etwa Atteste, AU und Lohnunterlagen: `Local.WriteObject` kopiert die Bytes unverändert in die Datei, kein Upload-Pfad versiegelt. `PrivateUploads.SavePrivate` beziehungsweise `SavePrivateNamedFile` für `staff-documents` schreiben 0600 für Datei und 0700 für Zielverzeichnis [D5, D8] | Offen | Altdateien, alle Schreibpfade, Eigentümer, übergeordnete Pfade, Mounts, Metadaten und verwaiste Dateien prüfen; Unix-Rechte schützen nicht vor Root |
| Kinderfotos `student-photos` und Avatare `avatars` | Ohne Anwendungsverschlüsselung; HTTP-Auslieferung nur authentifiziert. **Code umgesetzt (#4852):** `common.SavePrivateImage` schreibt neue Dateien 0600 und sichert Zielverzeichnisse mit 0700 [D8] | Offen | Bestand, Rollout und produktiver Nachweis offen. Ältere Dateien können weiterhin 0644 haben und bei durchsuchbaren Elternverzeichnissen lokal lesbar sein; Eigentümer, übergeordnete Pfade und Auslieferung nach [Runbook 3840-h](../operations/private-fotodateien-3840.md) prüfen |
| Öffentliche Upload-Kinds `login-images`, `enrollment-legal-documents`, `enrollment-form-legal-documents` | Explizit ohne Anmeldung bereitgestellt [D8] | Offen | Nur für öffentliche Inhalte verwenden; keine vertraulichen Dokumente oder personenbezogenen Fehlablagen |
| Datenträger/Volumes einschließlich PostgreSQL-Daten/WAL, Uploads, temporärer Dateien, Swap und Host-Snapshots | Keine Aussage zur Verschlüsselung beim Hoster aus dem Anwendungscode möglich | Offen | Mensch-Nachweis 3840-c nach [Prüfablauf](../operations/datentraegerschutz-3840.md), einschließlich Schlüsseltrennung und nicht abgedeckter Medien |
| Dumps und Release-Snapshots | Logische Kopien sind nicht durch die Verschlüsselung des Quelldatenträgers geschützt; Tagessicherung ersetzt keine Prüfung weiterer Kopien [D9] | Offen | Erzeuger, temporäre Klartextorte, Transport, Ziel, Zugriffe und Ablauf sämtlicher Kopien inventarisieren |
| Tagessicherung und bestehendes cron-Altverfahren | Neue DB-/Upload-Sicherung mit age, getrenntem Ziel und maximal 90 Tagen im Code vorbereitet. Alte Monitoring-Regeln belegen keine Eigenschaften des Altverfahrens [D9] | Offen | Einrichtung, Zieltrennung, Fristen, Alarmzustellung, Restore und Ablösung des Altverfahrens nach #3836 nachweisen |
| Schlüssel und Betriebsgeheimnisse | Feldschlüssel: `HEALTH_DATA_KEYS` (Gesundheit) und `BANK_DATA_KEYS` (Bankdaten) als Umgebungsvariablen des Servers; `HEALTH_DATA_KEYS` auch im Migrationsjob, `BANK_DATA_KEYS` auch im Wartungsbefehl `bank-data-rekey`, beide im lokalen Mandantenexport. Ohne gültigen Ring startet der Server nicht. Kein Dateischlüssel. Backup: öffentlicher age-Empfänger auf Quelle, private Identitäten nach ADR 0085 offline. SOPS schützt die Schlüsselringe als Betriebsgeheimnisse, nicht die übrigen DB-Inhalte [D9, D10, D12] | Offen | Tatsächliche Schlüsselablage, Berechtigte, Wiederbeschaffung/Rotation, Hoster-Schlüssel und Root-/Deployment-Zugänge getrennt nachweisen |

**Mandantentrennung:** Tenant-Transaktionen mit `phoenix_tenant` und erzwungene
RLS sind im Code vorgesehen. `TestEveryTenantTableHasRLS` prüft Tabellen,
Aktivierung, FORCE und eine passende Policy. Das begrenzt Mandantenwechsel,
nicht den Zugriff eines berechtigten Kontos innerhalb seiner Schule, einen
DB-Superuser, Root oder den Inhalt eines Dumps. Belege: [Vertrag](../agents/contracts.md#tenant-boundary),
[RLS-Helfer](../../backend/database/migrations/rls_provisioning.go),
[Wächter](../../backend/database/migrations/rls_coverage_test.go).

**Datenbanktransport:** Die gelesene [Produktions-Compose](../../environments/production.compose.yml) deklariert den
Host-Port auf Loopback und `sslmode=require`. Das beweist weder die laufende
Netzkonfiguration noch Datenträgerverschlüsselung oder geprüfte Serveridentität;
die weitere TLS-Prüfung bleibt Slice 3842-d. Es wurden keine Verbindungen aufgebaut.

## Bedrohungsbewertung

Die Schadensschwere ist wegen Kinderdaten, Gesundheit, Identitätsmerkmalen und
Finanzdaten hoch. Es liegen keine Betriebsdaten für belastbare numerische
Eintrittswahrscheinlichkeiten vor. Die folgende Bewertung benennt deshalb
Angriffsbedingungen und Schutzgrenzen statt unbelegter Risikozahlen.

| Bedrohung und Folge | Gewählte Maßnahmen | Verbleibendes Risiko / Bewertung |
|---|---|---|
| Verlorener/ausgemusterter Datenträger: DB, WAL, Dateien oder Reste werden offline gelesen | Nachgewiesene Datenträger-/Volume-Verschlüsselung beim Hoster, geschützte getrennte Schlüssel, sichere Aussonderung; Swap/Temporärorte einschließen | **Offen, hoher möglicher Schaden.** Schutz erst belegbar, wenn konkrete Volumes, Medien und Schlüsselverfahren erfasst sind. Ein entsperrter laufender Host bleibt lesbar |
| Entwendeter Dump: vollständige logische DB-Kopie wird außerhalb des Volumes gelesen | Dumps nur zweckgebunden und zugriffsbeschränkt; im Backup-Code Klartext-Arbeitsbereich auf tmpfs, age vor Transport; andere Dump-/Snapshotpfade separat prüfen | **Offen.** Volume-Verschlüsselung schützt exportierten Klartext nicht. Gesundheits- und Bankdaten liegen im Dump nur als Chiffrat, ihr Schlüssel ist nicht in der Datenbank. Alle übrigen Daten bleiben Klartext; dafür setzt Option 1 weiter lückenlosen Schutz der Kopien voraus. Die Mandantenrückgabe öffnet die versiegelten Spalten (ADR 0192, ADR 0193) und ist damit eine Klartextkopie |
| Gestohlene Sicherung: DB und Dateien samt Historie werden offengelegt oder alle Generationen vernichtet | #3836: verschlüsselte getrennte Sicherung, private Entschlüsselungsschlüssel offline, beschränkte Zugänge, Schutz vor Löschen aller Generationen, Frist und Restore-Test | **Offen bis Betriebsabnahme.** Zielzugänge auf dem Quellhost können ohne separate Zielkontrollen Löschung erlauben. Alte cron-Kopien und Release-Snapshots bleiben eigenständig zu prüfen |
| Unberechtigter interner Zugriff: Diagnose-/Betriebszugang liest Finanz- oder Gesundheitsdaten ohne Aufgabe; lokaler Hostnutzer liest Kinderfotos/Avatare ohne App-Berechtigung | Aufgabenbezogene App-/DB-Rechte, Diagnose-Leserolle ohne sensible Spalten (3840-f), begrenzte persönliche Adminzugänge, Finanz-Zugriffsprotokoll, Datenminimierung; Dateirechte für Fotos/Avatare einschließlich Altbestand beschränken (3840-h) | **Offen: Bestand, Rollout und produktiver Nachweis.** Code-Abhilfe umgesetzt (#4852): neue Fotos/Avatare 0600/0700. Ältere Dateien mit 0644 können bei durchsuchbaren Elternverzeichnissen weiterhin ohne HTTP-Anmeldung gelesen werden. Datenträgerverschlüsselung schützt den entsperrten Host nicht. RLS ersetzt keine Spaltenrechte und sperrt keinen Superuser. Auch 0600/0700 und ein auf demselben Host verfügbarer Feldschlüssel schützen nicht vor uneingeschränktem Root-Zugriff |
| Kompromittierter Anwendungszugang: Angreifer liest alles, was Konto oder Prozess lesen darf | Rollen, Beziehungserlaubnisse im Elternportal, Tenant-Transaktionen/RLS, Zugangsschutz nach #3841, maskierte Standardanzeigen und minimale Protokolle | **Restrisiko bleibt, Wirksamkeit produktiv offen.** Ein berechtigtes kompromittiertes Konto kann Inhalte sehen; ein übernommener App-Prozess kann auch ihm zugängliche Schlüssel nutzen. Die Feldverschlüsselung der Gesundheits- und Bankdaten löst diesen Angriff nicht: Der Serverprozess hält beide Schlüsselringe |

Keine dieser Bewertungen akzeptiert pauschal die offenen Lücken. Vor Abschluss
von #3840 müssen die Nachweise vorliegen und die Gesundheitskopien- sowie
Dateirechte-Befunde behoben oder mit einer konkret geprüften gleichwertigen
Maßnahme behandelt sein.
Fehlt wirksamer Datenträger-/Kopienschutz, muss der Betreiber unmittelbar
Abhilfe und nötige Begrenzung der betroffenen Verarbeitung festlegen, nicht
bis zu einer späteren Neubewertung ungeprüft weiterfreigeben.

## Historischer Befund: Gesundheitskopien im Elternportal

Vor Slice 4844-a schrieb die Eltern-Direktbearbeitung Alt-/Neuwerte von
`health_info` als JSONB in `users.student_data_change_requests`, unabhängig
vom bereits maskierten `audit.student_field_edits`. **Code umgesetzt (#4854,
Slice 4844-a):** Der aktuelle Schreibpfad nutzt `maskedHealthDataRequestValues`;
Migration `1.15.483` entfernt die historischen Gesundheitsinhalte. Belege: [D6, D7].

Das ist Code-Abhilfe, kein Nachweis einer produktiven Bereinigung.
Rollout, alte Sicherungen und erneute Maskierung nach Restore sind nach dem
[Prüfablauf 4844](../operations/gesundheitsangaben-aenderungsprotokoll-3840.md#elternportal-änderungsanfragen-slice-4844-a) abzunehmen.
Die Diagnoserolle 3840-f erhält unabhängig vom Maskierungsstand keinerlei
Zugriff auf diese Tabelle oder das Audit-Schema. Die Tabelle folgt weiterhin
der Kinderlöschung, nicht der 90-Tage-Frist des Kinderänderungsprotokolls.

`extra_info` und andere freie Notizen können sensible Fehlablagen enthalten.
Der Code speichert und protokolliert sie weiterhin inhaltlich [D3, D6]. Eine
regelmäßige Nutzung für Gesundheitsangaben ist daraus nicht belegbar.
Erforderlichkeit, Eingabehinweise und konkrete Fehlablagen muss der Betrieb
prüfen; keine pauschale Löschung oder weitere Maskierung in diesem Slice.

## Foto-/Avatar-Dateirechte: Code umgesetzt, Betriebsnachweis offen

**Code umgesetzt (#4852, Slice 3840-h):** Kinderfotos gehen nach
`public/uploads/student-photos`, Avatare nach `public/uploads/avatars/global`.
Beide Handler nutzen `common.SavePrivateImage` → `saveUploadedFile` →
`SavePrivateNamedFile` → `UploadFiles.SaveNamed(..., private=true)`.
`Local.WriteObject` setzt neue Dateien auf 0600 und sichert auch vorhandene
Zielverzeichnisse mit 0700. HTTP-Auslieferung und Cache bleiben unverändert.
Belege: [D8].

**Bestand und Schutzgrenze:** Der frühere öffentliche Schreibpfad legte
Dateien mit 0644 und Verzeichnisse mit bis zu 0755 an. Der private Writer
migriert weder Altdateien noch alle übergeordneten Verzeichnisse. Bei
durchsuchbaren Elternverzeichnissen können andere lokale UIDs solche
Altdateien weiterhin ohne App-Berechtigung lesen. Auch 0600/0700 schützen
nicht vor derselben UID, Root oder einem kompromittierten Backend. Die
produktiven Verzeichnis-, Mount- und Zugangsrechte sind nicht geprüft;
dies ist kein Beleg einer öffentlichen HTTP-Freigabe oder eines
mandantenübergreifenden API-Lecks.

**Status offen:** Kein akzeptiertes Restrisiko von Option 1. Das
[Runbook 3840-h](../operations/private-fotodateien-3840.md) bereitet den
Bestandsschritt mit Trockenlauf und die Prüfung der weiter authentifizierten
Auslieferung vor. Bestand, Rollout und produktiver Nachweis bleiben vor
Abnahme dieses Teilrisikos von #3840 zu erledigen. Die Code-Abhilfe allein
schließt den Befund nicht.

## Abschluss und erneute Bewertung

Der [Mensch-Prüfablauf 3840-c](../operations/datentraegerschutz-3840.md) führt
durch Datenträger-, Schlüssel- und Zugangsbelege. Unabhängig davon sind
[Backup-Abnahme](../operations/daily-backup.md), die produktive Abnahme der
Diagnose-Leserolle 3840-f,
der Gesundheitsmaskierung (#4854, Slice 4844-a) sowie Foto-/Avatar-Bestand,
Rollout und produktiver Nachweis (3840-h) offen; die Foto-Code-Abhilfe ist
in #4852 umgesetzt. Änderungen an Hosting, Schlüsseln,
Datenarten, Export-/Dumpwegen, Rechten, Kundenanforderungen oder ein Vorfall
lösen eine erneute Risikoprüfung aus. Notwendige Anpassungen dürfen nicht
allein mit Verweis auf Option 1 entfallen.

## Quellen der Codeprüfung

- **D1:** [Migration Finanz-/Personaldaten](../../backend/database/migrations/001015251_staff_stammdaten.go).
- **D2:** [Migration Eltern-Zahlungsdaten](../../backend/database/migrations/001015336_guardian_payment_data.go).
- **D3:** [Getrennte Kinder-/Betreuungsprofile](../../backend/database/migrations/001015393_student_owner_storage_expand.go).
- **D4:** [Personal-Finanzmaskierung](../../backend/modules/workforce/internal/domain/staffadmin.go), [Finanzlesepfad Personal](../../backend/modules/workforce/internal/application/staffadmin.go), [Eltern-Zahlungsservice](../../backend/modules/peopledirectory/internal/application/guardian_payment_service.go), [Zugriffstypen](../../backend/modules/auditlog/records/data_access_log.go), [Personal-Protokoll](../../backend/modules/auditlog/records/staff_master_data_change.go), [Eltern-Finanzprotokoll](../../backend/modules/auditlog/records/guardian_financial_change.go).
- **D5:** [Produktionskatalog](../../backend/modules/organizationtenancy/data_lifecycle_catalog.json), [Fristenliste](loeschfristen.md). Katalogabdeckung ist kein Nachweis ausgeführter Löschung/Rückgabe.
- **D6:** [Kind-Änderungsdiff](../../backend/modules/peopledirectory/internal/domain/student_audit.go), [Maskierung des Altbestands](../../backend/database/migrations/001015475_mask_student_health_audit.go).
- **D7:** [Eltern-Direktbearbeitung](../../backend/workflows/parentportal/internal/care/parent_master_data_service.go), [JSONB-Anfragetabelle](../../backend/database/migrations/001015151_create_student_data_change_requests.go), [Schreib-/Lesespeicher](../../backend/modules/careplan/internal/adapters/postgres/requests.go), [Maskierung des Altbestands](../../backend/database/migrations/001015483_mask_parent_health_history.go).
- **D8:** [Lokaler Dateispeicher](../../backend/modules/delivery/objects/local.go), [Upload-Schreibadapter](../../backend/modules/delivery/objects/uploads.go), [Bild-/Dateihelfer](../../backend/api/common/upload.go), [Kinderfoto-Upload](../../backend/modules/peopledirectory/inbound/students/photo.go), [Avatar-Upload](../../backend/modules/identityaccess/inbound/me/profile.go), [private Schreiboption](../../backend/modules/delivery/objects/private_uploads.go), [Personaldokument-Upload](../../backend/modules/workforce/http/timetracking/staff_admin_documents.go), [Anmeldungs-Uploads](../../backend/api/enrollment_upload_storage_composition.go), [Nachrichtenanhänge](../../backend/modules/communication/message_attachments.go), [öffentliche Mounts](../../backend/api/serve_mounts_public.go). Die Rechte beim Schreiben belegen keine nachträgliche Bereinigung aller Altdateien.
- **D9:** [Backup-Implementierung](../../scripts/daily_backup.py), [Backup-Verfahren und Grenzen](../operations/daily-backup.md), [ADR 0085: Schlüsseltrennung](../adr/0085-backup-decryption-keys-stay-off-the-source-host.md).
- **D11:** [Diagnoserolle](../../backend/database/migrations/001015488_diagnostics_reader.go), [SQL-Verhaltenstests](../../backend/database/migrations/001015488_diagnostics_reader_test.go).
- **D10:** [Betriebsgeheimnisse/SOPS](../agents/operations.md#environment-management-sops). Keine echten Schlüssel oder entschlüsselten Dateien wurden gelesen.
- **D12:** [Feld-Cipher](../../backend/modules/securityruntime/internal/domain/fieldcipher/field_cipher.go), [Schlüsselringe der Roots](../../backend/api/root_env.go), [Produktions-Compose](../../environments/production.compose.yml), [Laufzeitgrenzen der Umgebungen](../operations/runtime-environment-boundaries.md), [Gesundheit Ferienanmeldung](../../backend/database/migrations/001015725_holiday_health_data.go), [Gesundheitsfeld der Kinder](../../backend/database/migrations/001015730_student_health_data.go), [Versiegeln und Öffnen des Gesundheitsfelds](../../backend/modules/studentdirectoryview/internal/adapters/postgres/student_health.go), [Schreibpfad Care Plan](../../backend/modules/careplan/internal/adapters/postgres/student_profiles.go), [Bankdaten Eltern](../../backend/database/migrations/001015836_guardian_financial_data_sealed.go), [Bankdaten Personal](../../backend/database/migrations/001015837_staff_financial_data_sealed.go), [Klartext entfernt](../../backend/database/migrations/001015900_bank_data_plaintext_drop.go), [SEPA-Mandate](../../backend/database/migrations/001015824_parent_billing_sepa_mandates.go), [SEPA-Lastschriften](../../backend/database/migrations/001015826_parent_billing_sepa_debits.go), [Mandatstexte](../../backend/database/migrations/001015852_parent_billing_online_sepa_mandates.go), [PAIN.008-Dateien](../../backend/database/migrations/001015880_parent_billing_sepa_debit_files.go), [Export-Empfänger](../../backend/database/migrations/001015955_traeger_export_transfer.go), [Personalstamm des Trägers](../../backend/database/migrations/20261114153024_traeger_staff_records.go).

Rechtlicher Bewertungsrahmen, nur gelesen: Legal-Repo bei
`7a21f6742782bcf6141470a47333ae5be6c3182f`,
[Pflichtumfang](https://github.com/moto-ogs/legal/blob/7a21f6742782bcf6141470a47333ae5be6c3182f/research/14-dsgvo-mindestumfang.md),
[Checkliste](https://github.com/moto-ogs/legal/blob/7a21f6742782bcf6141470a47333ae5be6c3182f/vertragspaket/intern/checkliste.md),
[AVV-Entwurf, Anhang 1 Ziff. 3/7](https://github.com/moto-ogs/legal/blob/7a21f6742782bcf6141470a47333ae5be6c3182f/vertragspaket/03-avv.md).
Maßstab ist die dort erläuterte risikobasierte Bewertung nach Art. 32 DSGVO,
keine allein aus einer älteren TOM abgeleitete Technologiepflicht.
