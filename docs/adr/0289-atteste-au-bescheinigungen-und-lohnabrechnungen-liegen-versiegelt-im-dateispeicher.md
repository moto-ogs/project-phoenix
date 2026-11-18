---
status: proposed
---

# Atteste, AU-Bescheinigungen und Lohnabrechnungen liegen versiegelt im Dateispeicher

**Status: Vorgeschlagen.** Vorschlag vom 18.11.2026, Teil von #3840.
Entscheidung des Nutzers vom 18.11.2026: Hochgeladene Atteste,
AU-Bescheinigungen und Lohnabrechnungen werden verschlüsselt gespeichert, wie
schon Bankdaten ([ADR 0188](0188-bankdaten-von-eltern-und-personal-liegen-versiegelt-im-bankring.md))
und die Gesundheitsangaben der Kinder (#5472). Diese ADR löst
[ADR 0095](0095-gespeicherte-daten-risikobasiert-ohne-feldverschluesselung-schuetzen.md)
für diese Dateien ab.

## Entscheidung und Invarianten

1. **Welche Dateien.** Versiegelt wird nach der Kategorie, die beim Hochladen
   feststeht und danach nicht mehr geändert wird:
   - Personaldokumente (`users.staff_documents`, Speicherart `staff-documents`):
     `au_bescheinigung` mit dem Gesundheitsring, `lohnabrechnung` mit dem
     Bankring. Lohnabrechnungen tragen IBAN, Steuer-ID und SV-Nummer, die
     `users.staff_financial_data` schon im Bankring hält.
   - Kinderdokumente (`users.student_documents`, Speicherart
     `student-documents`): die Gesundheitsklasse `attest`, `impfnachweis` und
     `medikamentenplan` mit dem Gesundheitsring. Alle drei sind Art.-9-Daten
     mit derselben Berechtigung `student_documents:health`.
   Die Entscheidung trifft der Owner (`workforce.StaffDocumentKeyRing`,
   `careplan.StudentDocumentKeyRing`). Alle anderen Kategorien und Upload-Arten
   bleiben unverändert.
2. **Kein neuer Schlüssel.** Es gibt keine neue Kryptoprimitive und keine neue
   Umgebungsvariable. Security Runtimes Feld-Cipher (AES-256-GCM,
   Schlüssel-ID im Chiffrat, der erste Schlüssel schreibt, alle lesen)
   versiegelt den ganzen Dateiinhalt. Die Root bindet `HEALTH_DATA_KEYS` und
   `BANK_DATA_KEYS` über `owners.UploadFileKeys`. Beide Ringe sind schon heute
   Pflicht beim Start. Der Bankring behält seinen Legacy-Lesepfad
   (`BANK_DATA_LEGACY_KEYS`, ADR 0183). Ein Gesundheits-Chiffrat öffnet nie
   mit dem Bankring und umgekehrt.
3. **Format.** Eine versiegelte Datei beginnt mit `MOTOSEAL`, dem
   Formatbyte `1` und dem Ringbyte (`h` Gesundheit, `b` Bank). Danach folgt der
   Wert des Feld-Ciphers. Das AAD ist
   `moto.upload.v1 \0 <speicherart>/<schule>/<gespeicherter name> \0 <ringbyte>`.
   Eine Datei, die in eine andere Schule kopiert, umbenannt oder auf den
   anderen Ring umetikettiert wird, öffnet nicht. Die Anwendung liefert dann
   nichts aus (404 im Download).
4. **Lesepfad.** `delivery/objects.PrivateUploads.OpenPrivate` erkennt den
   Kopf: Versiegelte Dateien werden im Speicher geöffnet (Grenze 64 MiB, die
   Uploads sind auf 10 MB begrenzt), alle anderen unverändert gestreamt. So
   liest der Download in der Übergangszeit alte Klartextdateien und neue
   Chiffrate. Die Kategorie braucht der Lesepfad nicht. Rechteprüfung,
   Zugriffsprotokoll, Mandantengrenze und RLS bleiben, wo sie waren: Der
   Download prüft unverändert vor dem Öffnen.
5. **Größe.** Die Metadaten speichern weiter die Größe des hochgeladenen
   Dokuments, nicht die des Chiffrats.
6. **Export.** Der Mandantenexport gibt versiegelte Originale geöffnet aus,
   wie die versiegelten Spalten (ADR 0192). Ohne beide Ringe startet der Export
   nicht. Ein versiegeltes Original, das nicht öffnet, bricht ihn ab.

## Nachverschlüsselung des Bestands

Der Wartungsbefehl `upload-seal --school ID --uploads PFAD --batch-size 100`
läuft nur mit dem privilegierten Wartungs-DSN, nie im HTTP-Prozess. Je
Batch öffnet die CLI-Root die Schultransaktion. Workforce und Care Plan
sperren höchstens 1000 lebende Dokumentzeilen der versiegelten Kategorien,
geordnet nach ID und `FOR UPDATE` ohne `SKIP LOCKED`. Ein paralleles Löschen
wartet daher auf den Batch, und kein entfernter Dateiinhalt wird neu
angelegt. Je Zeile gilt:

- Eine Klartextdatei wird versiegelt.
- Eine Datei mit einem älteren Schlüssel wird auf den aktiven Schlüssel
  umgeschlüsselt (`Rewrap`, Rotation).
- Eine Datei auf dem aktiven Schlüssel bleibt bytegleich.
- Eine fehlende Datei zählt als `missing`.

Das Ersetzen ist atomar: Die neue Datei entsteht als `.replace-*` daneben
(Rechte 0600, `fsync`) und tauscht dann mit `renameat2(RENAME_EXCHANGE)` den
Platz mit der alten Datei. Ist die Datei inzwischen gelöscht, schlägt der
Tausch fehl. Auch eine Bereinigung ohne Zeilensperre, etwa beim Offboarding,
bekommt ihre Datei also nie zurück. Danach wird die Tauschdatei mit den alten
Bytes gelöscht. Was ein abgebrochener Lauf an `.replace-*` hinterlässt, entfernt
der nächste Lauf vor seinen Batches (`stale_removed`); der Mandantenexport
überspringt diese Dateien. Je Schule darf nur ein Lauf gleichzeitig aktiv
sein. Außerhalb von Linux gibt es keinen atomaren Tausch; Produktion läuft auf
Linux. Ein Dateisystem ohne `RENAME_EXCHANGE` lässt den Lauf mit einem Fehler
`storage` abbrechen, ohne etwas zu ändern. Die
Ausgabe nennt nur Mengen je Quelle: `stale_removed`, `scanned`, `changed`,
`missing` und die Summen. Ein fehlgeschlagener Batch nennt nur die
Fehlerklasse (Ring öffnet nicht, Speicher, Datenbank). Ein zweiter vollständiger Lauf muss `changed_total=0` liefern.
Datenbankzeilen ändert der Befehl nicht.

### Ablauf je Umgebung (Staging, Demo, Produktion)

Verantwortlich: Betrieb. Keine Live-Zugriffe durch Implementierungsagenten.

1. Mergen und die neue Version vollständig ausrollen. Ab dann versiegeln alle
   Uploads der drei Arten. Eine ältere Version kann versiegelte Dateien nicht
   ausliefern. Ein Rollback auf ein Image ohne diese Änderung ist daher kein
   Rollback mehr, sobald die erste Datei versiegelt ist.
2. Im Deployment-Verzeichnis (`~/staging`, `~/production`, `~/demo`) den
   folgenden Block ausführen. Der Dienst `upload-seal` im Profil
   `maintenance` nutzt das Server-Image, das Upload-Volume des Servers, den
   privilegierten `DB_DSN` sowie `HEALTH_DATA_KEYS`, `BANK_DATA_KEYS` und
   `BANK_DATA_LEGACY_KEYS`. Keine Schlüssel als Shell-Literal.

   ```bash
   (
     set -euo pipefail
     school_ids=$(docker compose exec -T postgres psql -U postgres -d postgres \
       -At -v ON_ERROR_STOP=1 -c 'SELECT id FROM platform.schools ORDER BY id')
     while IFS= read -r school_id; do
       [ -n "$school_id" ] || continue
       docker compose run --rm --no-deps upload-seal ./main upload-seal \
         --uploads /app/public/uploads --school "$school_id" --batch-size 100
     done <<< "$school_ids"
   )
   ```

3. Den Block ein zweites Mal ausführen. Fertig ist er erst, wenn jede Schule
   fehlerfrei für beide Quellen `changed_total=0` meldet.
   `missing_total > 0` heißt: Zu einer lebenden Zeile fehlt die Datei. Das
   gab es schon vorher, die Nachverschlüsselung verursacht es nicht. Die
   betroffenen Dokumente prüft der Betrieb getrennt.

Abbruch mit SIGTERM verliert höchstens den laufenden Batch. Eine Wiederholung
ab null ist sicher. Bei einer Rotation eines Rings (neuer Schlüssel vorne)
gilt derselbe Block. Erst nach zwei vollständigen Läufen mit
`changed_total=0` darf der alte Schlüssel aus dem Online-Ring. Der Lauf erfasst
nur lebende Dokumente. Dateien gelöschter Dokumente, deren Entfernen noch
aussteht, und verwaiste Uploads bleiben auf ihrem alten Schlüssel. Der alte
Schlüssel muss daher auch so lange im Ring bleiben, bis die Bereinigung diese
Dateien entfernt hat. Sonst bricht der Mandantenexport an ihnen ab.

## Grenzen

- Root auf dem Host liest die Ringe in der `.env` und damit jede Datei.
  Dasselbe gilt für Release-Snapshots, die `.env` und Uploads gemeinsam
  enthalten.
- Uploads ohne Kategorie bleiben Klartext, auch wenn Nutzer dort Atteste
  ablegen: Anmeldeuploads (`enrollment-uploads`), Nachrichtenanhänge,
  Dateiablage (`files`), Leistungsnachweise der Ferienanmeldung und
  Trägerdokumente (beide als `BYTEA`). Ebenso bleibt `unfallanzeige` Klartext.
  Folgearbeit.
- Heruntergeladene Dateien und das lokale Exportpaket sind Klartextkopien
  außerhalb der Anwendung.

## Architektur

ADR 0066: Workforce und Care Plan besitzen ihre Dokumenttabellen und die
Kategorie-Entscheidung. Delivery Platform (`modules/delivery/objects`) besitzt
die Bytes und rahmt sie, ohne Kategorien zu kennen. ADR 0067: Der Cipher ist ein
consumer-owned Port (`objects.FileCipher`). Organization Tenancy liest
Originale über `TenantExportObjects`. ADR 0068: Die Root bindet die Ringe
(`owners.UploadFileKeys`, `cmd/tenant.go`), die Owner-Kompositionen bauen die
Batches (`NewStaffDocumentFileSeal`, `NewStudentDocumentFileSeal`). Keine
Migration, kein neuer Owner, keine neue Env-Var.

`fieldcipher.Cipher.Rewrap` macht die Umschlüsselung des Gesundheitsrings
idempotent wie `BankCipher.Rewrap` (ADR 0183). Die Methoden-Evidenz unter
dieser ADR umfasst `Coordinator.SaveSealed`,
`StaffDocumentFileSeal.Batch`, `PrivateUploads.RemoveStaleReplacements` und den geänderten `PrivateUploads.OpenPrivate`. Der atomare Tausch liegt im neuen Paket `modules/delivery/objects/exchange` (Rolle `contract` der Delivery Platform), das als einziges `golang.org/x/sys/unix` (Klasse `utility`) importiert.
Die Konstruktoren der beiden Batches erhöhen die Compose-Fläche von Care Plan
um 13 Zeilen (1703 → 1716) und von Workforce um 6 (937 → 943); die Summe steigt
13647 → 13666 (nach ADR 0283). Das Pass-through-Budget von Workforce steigt um eins (137 → 138,
Summe 1395 → 1396 nach ADR 0283).

Verworfen:

- Ein eigener Dateiring: Er bräuchte ein neues Produktionsgeheimnis. Der
  Schutzbedarf entspricht dem der schon versiegelten Spalten derselben
  Personen.
- Versiegeln ganzer Speicherarten: Das ginge über die Entscheidung hinaus und
  würde Personaldokumente einem fachfremden Ring zuordnen.
- Eine Datenmigration: Migrationen haben kein Upload-Volume, und ihre Dauer
  würde den Deploy verlängern.
