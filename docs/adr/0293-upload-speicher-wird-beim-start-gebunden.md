---
status: accepted
---

# Upload-Speicher wird beim Start gebunden

Entscheidung für [#7225](https://github.com/moto-ogs/project-phoenix/issues/7225).
Sie ergänzt [ADR 0148](0148-demo-betrieb-loescht-die-dateien-ausgemusterter-demo-schulen.md)
und [ADR 0289](0289-atteste-au-bescheinigungen-und-lohnabrechnungen-liegen-versiegelt-im-dateispeicher.md).

API, Worker und Wartungsbefehle verwenden den beim Start gebundenen
Upload-Speicher. Die bestehende lokale Ablage ist der Standard. S3 braucht
eine ausdrückliche Konfiguration und einen privaten Bucket ohne
Objektversionen. Delivery Platform kapselt den SDK-Client hinter dem
Byte-Vertrag. Die Fachmodule behalten die Zuständigkeit für Schlüssel,
Zugriffsrechte, Versiegelung und den Zeitpunkt einer Löschung.

Die 12 LOC in `modules/delivery/objects/compose` erlauben beiden Wurzeln und
dem Demo-Prozess, nur diesen Speicher zu binden. Der Speicheradapter
übersetzt einen fehlenden Schlüssel beim Löschen in Erfolg. Die
Mandantenlöschung prüft die Versionierung und erfasst nur den Schlüsselpräfix
der gewählten Schule. Workforce prüft den gespeicherten Dateinamen vor der
Löschung und gibt Fehler ohne Dateinamen weiter. Die beiden S3-Methoden sind als geprüfte Adapterbelege im Methodenregister
erfasst.

Der [Betriebsablauf](../operations/shared-upload-storage.md) beschreibt
Migration, Rückkehr, Mandantenexport und Löschung. Die Aktivierung im
Betrieb folgt erst nach der Wahl und Prüfung des Anbieters.
