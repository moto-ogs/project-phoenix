# Uploads in einen gemeinsamen S3-Speicher umziehen

`UPLOADS_BACKEND=local` oder ein leerer Wert verwendet das bestehende
Upload-Volume. Mit `UPLOADS_BACKEND=s3` verwenden API, Worker und die
Wartungsbefehle denselben Bucket. Die öffentlichen App-Routen für Login-Bilder
und Rechtstexte bleiben erreichbar. Auch deren Objekte liegen privat im Bucket.
Der Download geschützter Dateien läuft weiterhin über die Berechtigungen der
App. Freigegebene Rückgabepakete (`phoenix-<env>-data-return`) liegen auf einem
separaten Volume. Beim Betrieb über mehrere Hosts muss die Archivroute diesen
Speicher erreichen, etwa über Routing an den Host mit dem Volume.

## Vorbereiten

1. Für jede Umgebung Anbieter und Region der laufenden Server im
   Betriebsinventar prüfen. Diese Zuordnung ist hier nicht bestätigt. Pro
   Umgebung einen neuen, privaten S3-Bucket beim selben Anbieter in der
   bestätigten Region anlegen. Versionierung und Object Lock ausgeschaltet
   lassen. Ein Bucket mit jemals
   aktivierter Versionierung wird abgewiesen, weil alte Objektversionen bei
   einer Löschung zurückbleiben könnten. Keine anonymen Bucket- oder
   Objektberechtigungen vergeben. Der technische Zugang braucht für diesen
   Bucket `GetBucketVersioning`, `ListBucket`, `GetObject`, `PutObject` und
   `DeleteObject`. Vor dem Umzug mit Testobjekten prüfen, dass anonyme GETs
   scheitern und ein PUT mit veraltetem `If-Match` fehlschlägt.
   [Beispiel für Anbietergrenzen bei Hetzner](https://docs.hetzner.com/storage/object-storage/supported-actions/)
2. `UPLOADS_S3_ENDPOINT` (HTTPS), `UPLOADS_S3_REGION`, `UPLOADS_S3_BUCKET`,
   `UPLOADS_S3_ACCESS_KEY` und `UPLOADS_S3_SECRET_KEY` per SOPS hinterlegen.
   Zugangsdaten über die vorgesehenen SOPS-Dateien in die Prozesse geben.
   Die App bricht mit einer Fehlermeldung ab, wenn im S3-Modus ein Wert fehlt
   oder der Bucket für die App nicht geprüft werden kann. `UPLOADS_BACKEND`
   erst beim Wechsel auf `s3` setzen.
3. Für den Wechsel und den späteren Betrieb zusammengehörige DB- und
   Datei-Sicherungen samt Wiederherstellung vorbereiten und prüfen. Die
   bestehenden [täglichen Sicherungen](daily-backup.md) und
   [Release-Snapshots](release-backup-rollback.md) erfassen das lokale
   Upload-Volume. Sie erfassen keine Dateien, die nur im Bucket liegen. Nach
   dem Wechsel muss auch ein Rollback die zum DB-Snapshot gehörenden
   Bucket-Dateien wiederherstellen. Erst mit geprüfter Sicherung und
   Wiederherstellung der Bucket-Dateien auf S3 umstellen.

## Kopieren und prüfen

1. Alle Schreiber stoppen, einschließlich API, Worker, Demo-Prozess, Importen
   und Wartungsjobs. Laufende Uploads und `upload-seal` abwarten. Öffentlichen
   Verkehr bis zur Prüfung nach dem Wechsel gesperrt halten. Das Upload-Volume
   der Quelle schreibgeschützt einhängen und dessen absoluten Pfad als
   `UPLOADS_ROOT` exportieren. Es muss die Ordner wie `avatars`, `files` und
   `staff-documents` direkt enthalten. Symlinks und andere Spezialdateien vor
   der Kopie im geschützten Arbeitsbereich prüfen und bereinigen.
2. Die Befehle unten unter `sops exec-env` mit der SOPS-Datei der Umgebung in
   einer Shell mit deaktiviertem Tracing ausführen. `rclone` kommt aus dem
   gepinnten Devbox-Toolchain. Die Remote-Konfiguration lebt in der Umgebung.
   Rclone kann Dateinamen ausgeben. Ausgaben im geschützten Arbeitsbereich halten.

   ```bash
   export RCLONE_CONFIG_UPLOADS_TYPE=s3 RCLONE_CONFIG_UPLOADS_PROVIDER=Other
   export RCLONE_CONFIG_UPLOADS_ENV_AUTH=false RCLONE_CONFIG_UPLOADS_ACL=private
   export RCLONE_CONFIG_UPLOADS_ENDPOINT="$UPLOADS_S3_ENDPOINT"
   export RCLONE_CONFIG_UPLOADS_REGION="$UPLOADS_S3_REGION"
   export RCLONE_CONFIG_UPLOADS_ACCESS_KEY_ID="$UPLOADS_S3_ACCESS_KEY"
   export RCLONE_CONFIG_UPLOADS_SECRET_ACCESS_KEY="$UPLOADS_S3_SECRET_KEY"
   UPLOADS_REMOTE="uploads:${UPLOADS_S3_BUCKET:?}"

   rclone --config /dev/null --no-unicode-normalization copy "${UPLOADS_ROOT:?}" "$UPLOADS_REMOTE" \
     --exclude '.replace-*' --checksum --immutable
   rclone --config /dev/null --no-unicode-normalization check "$UPLOADS_ROOT" "$UPLOADS_REMOTE" \
     --exclude '.replace-*' --download
   ```

   `copy` behält vorhandene, übereinstimmende Objekte und überträgt fehlende.
   Den gleichen Aufruf nach einem Abbruch mit der gleichen schreibgeschützten
   Quelle wiederholen. Erkennt die Kopie ein abweichendes Zielobjekt, meldet
   sie einen Fehler und lässt dessen Bytes stehen. Der anschließende Vergleich
   mit `check --download` prüft alle Inhalte sowie fehlende und zusätzliche
   Objekte, unabhängig von den verfügbaren S3-Prüfsummen. Bei Abweichungen
   Quelle, Ziel und Objekt prüfen, bevor der Wechsel weitergeht. Die
   Ausnahme `.replace-*` betrifft temporäre Zwischenstände. Alle
   Originalschlüssel bleiben erhalten, weil versiegelte Dateien an ihren
   Schlüssel gebunden sind.
3. Nach erfolgreichem Vergleich die SOPS-Konfiguration auf
   `UPLOADS_BACKEND=s3` setzen. Alle API- und Worker-Instanzen sowie den
   Demo-Prozess mit der gleichen Konfiguration starten. Vor Freigabe der
   Umgebung prüfen, dass die Anwendung ein bestehendes versiegeltes Dokument
   öffnen kann. In einer Testschule eine Datei über Instanz A hochladen und
   über Instanz B abrufen. Geschützte Objekte müssen ohne App-Berechtigung
   unzugänglich bleiben.

## Lokal mit zwei Replikaten prüfen

Der [Replikat-Check](../../scripts/check-upload-replicas.py) verwendet zwei
Go- und zwei Next.js-Prozesse, eine gemeinsame migrierte lokale Datenbank und
einen lokalen S3-Testbucket. Beide APIs brauchen `RATE_LIMIT_ENABLED=true` und
`RATE_LIMIT_AUTH_REQUESTS_PER_MINUTE=1`. Eine Testschule ohne Login-Bild und ein
Passwortkonto mit `config:update` ohne Admin-Rolle verwenden.

```bash
python3 scripts/check-upload-replicas.py \
  --apis 9880 9881 --next 4800 4801 --tenant default --email replica-smoke@example.test
```

Der Check fragt nach dem lokalen Testpasswort. Er prüft das gemeinsame
Anmeldelimit, den Abruf eines Uploads über beide APIs und den Wechsel der
Einstellung in beiden Next.js-Prozessen.

## Wiederherstellung und Löschung

- Vor den ersten S3-Schreibvorgängen kann die gleiche lokale Quelle wieder
  verwendet werden. Sind schon Änderungen im Bucket erfolgt, für die
  Rückkehr alle Schreiber stoppen und den vollständigen aktuellen Bucket in
  ein frisches privates lokales Volume kopieren und prüfen. Das alte Volume
  enthält weder neue Uploads noch spätere Löschungen. Für einen Restore den
  bestätigten, zusammengehörigen Stand von Dateien und DB verwenden.
- Für einen [Mandantenexport](auskunft-und-rueckgabe.md) eine passende
  Bucket-Momentaufnahme als privaten lokalen Upload-Root bereitstellen.
  Während DB und Dateien für die Momentaufnahme erfasst werden, die Schreiber
  gestoppt halten. Mit den obigen Rclone-Einstellungen vom Bucket in ein
  frisches Arbeitsverzeichnis kopieren. Mit `check --download` prüfen.
  Schlüssel und Verzeichnisstruktur beibehalten.
- Für [Mandantenlöschung](tenant-erasure.md) dieselbe Backend-Konfiguration
  wie in der App verwenden. Falls die alte lokale Ablage noch vorhanden ist,
  `tenant erase` im S3-Modus zusätzlich mit `--uploads-root` aufrufen und die
  korrekte alte Ablage einhängen. So prüft und löscht der Befehl beide Quellen. Der Demo-Prozess verwendet im
  S3-Modus den Bucket und das eingebundene alte Upload-Volume für die
  Dateiphase ausgemusterter Schulen.
  Nach dem Wechsel alte Upload-Volumes und Backups gemäß dem bestehenden
  Lösch- und Aufbewahrungsverfahren behandeln.
