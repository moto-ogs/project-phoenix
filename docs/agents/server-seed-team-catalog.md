# Server-Seed: tägliche Teamwege und Datenverwaltung

Pfade relativ zu `frontend/src/app/[tenant]/(protected)/`. Alle Einträge
verwenden den Tenant-Snapshot der aufgelösten Schule; Go prüft die Rechte
jedes Abrufs. Ein fehlender Seed lässt den bestehenden Leser nachladen.

| Seite (`page.tsx`) | Erste serverseitige Antworten | Nicht vorgezogen |
| --- | --- | --- |
| `students/search` | Schlanke Kindersuche mit URL- und Berlin-Tagesfiltern; Klassen, Gruppen, Räume und zulässige Anmeldeantwortfilter | Nur lokal bekannte Ansichten, Tracking- und Detailanforderungen nach Auswahl; keine breite Ersatzliste bei verweigerter Filterfreigabe |
| `active-supervisions` | Standard-Auswahl des Aufsichtsdashboards oder persönliche laufende, geplante und Tagesaufsichten | Kein abweichender Raum oder Termin unter dem Standardschlüssel |
| `anfragen` | Aktueller Zugang zur Prüfung; erste Seite der sichtbaren offenen Anfragen mit ihren aktiven Quellen | Andere Tabs, Folgeseiten, Entscheidungsdetails und Vorschauen |
| `home` | Gespeichertes Brett, Kennzahlen, Tagesablauf, eigene Dienste, sichtbare Karten sowie Hinweise zum Phasenende, zur Geräte-PIN und zu Ferien | Die aggregierten Hinweise, deren Antworten zusätzlich nicht benötigte Kindernamen liefern, werden nicht in den RSC-Payload übernommen |
| `database` | Zähler für die Datenverwaltung | Keine Lesezugriffe der verlinkten Zielseiten |
| `database/absence-types` | Abwesenheitsarten | Formulardaten bei Bearbeitung |
| `database/activities` | Aktivitäten inklusive Systemaktivitäten, die Detailansicht für einen Eintrag der Liste bei URL-Auswahl und passendem Recht | Kein Detail für eine ID außerhalb der Liste; Schreibentwurf erst bei Öffnung |
| `database/categories` | Kategorien inklusive Nutzung, archivierter und Systemkategorien | Schreibvorschau |
| `database/devices` | Geräteliste und Geräteplätze | Tokens, Kopplung und neu erzeugte Zugangsdaten erst auf Aktion |
| `database/exports` | Statische Auswahl aus Berechtigungen und gebuchten Modulen | Downloads erst auf Aktion |
| `database/grade-transitions` | Liste der Schuljahreswechsel mit denselben ID-Fenstern und Mappings wie im Browser | Vorschau, Historie und Bearbeitung erst auf Aktion |
| `database/groups` | Erste OGS-Gruppenliste und Gastgruppen | Entwürfe und Vorschauen |
| `database/permissions` | Berechtigungskatalog | Änderungen erst auf Aktion |
| `database/personal` | Personalliste mit der Projektion für die sichtbaren Spalten | Personalnotizen und vollständige Kontodaten gehören nicht zur Liste |
| `database/personal/import` | Rollen für die Importhinweise | Vorlagendownload und Dateivorschau erst auf Aktion |
| `database/personal/opening-balances` | Statisches Importformular | Vorlagendownload und Dateivorschau erst auf Aktion |
| `database/planning-tracks` | Planungsspuren, wenn der Betreuungsplan aktiv ist | Schreiben erst auf Aktion |
| `database/qualification-types` | Qualifikationsarten | Schreiben erst auf Aktion |
| `database/qualifications` | Übersicht über Qualifikationen | Bearbeitung erst auf Aktion |
| `database/roles` | Rollenliste und freigegebenes Rollendetail bei URL-Auswahl | Kein Detail für ausgeblendete Systemrollen oder IDs außerhalb der Liste |
| `database/rooms` | Erste Raumliste inklusive Systemräumen | Schreiben erst auf Aktion |
| `database/shift-types` | Schichtarten mit Nutzung und Kategorien | Schreiben erst auf Aktion |
| `database/students` | Gruppenoptionen und Kinderquote | Die Vollprojektion der Kinder wird bei Gesundheitsdaten protokolliert. Die schlanke Projektion enthält weder Betreuungsende noch die belegten Plätze. |
| `database/students/class-list` | Klasseneinträge, Vorschläge und Namen/Klassen betreuter Kinder über die nicht protokollierte schlanke Projektion | Dokumente und Schreibvorschauen erst auf Aktion |
| `database/students/class-list/import` | Statisches Importformular | Vorlagendownload und Dateivorschau erst auf Aktion |
| `database/students/ended-care` | Erste Seite der beendeten Betreuungen ohne Suchtext | Andere Suchbegriffe und Folgeseiten |
| `database/students/import` | Statisches Importformular | Vorlagendownload und Dateivorschau erst auf Aktion |
| `database/work-time-models` | Arbeitszeitmodelle mit Nutzung | Schreiben erst auf Aktion |

`/students/[id]`: Der GET kann einen Gesundheitszugriff protokollieren.
Weder ein Seiten-Seed noch Link-Intent darf ihn starten.
