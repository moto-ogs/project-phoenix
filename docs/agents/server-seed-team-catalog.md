# Server-Seed: tägliche Teamwege und Datenverwaltung

Pfade relativ zu `frontend/src/app/[tenant]/(protected)/`. Alle Einträge
verwenden den Tenant-Snapshot der aufgelösten Schule; Go prüft die Rechte
jedes Abrufs. Ein fehlender Seed lässt den bestehenden Leser nachladen.

| Seite (`page.tsx`) | Erste serverseitige Antworten | Nicht vorgezogen |
| --- | --- | --- |
| `students/search` | Schlanke Kindersuche mit URL- und Berlin-Tagesfiltern; Klassen, Gruppen, Räume und zulässige Anmeldeantwortfilter | Nur lokal bekannte Ansichten, Tracking- und Detailanforderungen nach Auswahl; keine breite Ersatzliste bei verweigerter Filterfreigabe |
| `active-supervisions` | Standard-Auswahl des Aufsichtsdashboards oder persönliche geplante und Tagesaufsichten; laufende eigene Aufsichten kommen aus dem vorhandenen Cache der Hülle (#8085) | Kein abweichender Raum oder Termin unter dem Standardschlüssel |
| `anfragen` | Aktueller Zugang zur Prüfung; erste Seite der sichtbaren offenen Anfragen mit ihren aktiven Quellen | Andere Tabs, Folgeseiten, Entscheidungsdetails und Vorschauen |
| `home` | Gespeichertes Brett, Kennzahlen, Tagesablauf, eigene Dienste, sichtbare Karten sowie Hinweise zum Phasenende, zur Geräte-PIN und zu Ferien; Planungszeitraum und Zähler für Buchungsreste und Abweichungen | Vollständige Buchungsreste und Abweichungen bleiben im Plan; die Startseite erhält nur die Zähler |
| `time-tracking` | Eigene Übersicht, laufende Berliner Woche und Urlaubsübersicht des laufenden Jahres über die drei Verträge aus #8104 | Andere Zeiträume, persönliche Bearbeitung sowie Downloads erst auf Aktion; Kalendertage bleiben bis zur Darstellung Strings |
| `lists` | Listenoptionen für das geprüfte URL-Datum oder heute in Berlin; der vorhandene POST-Vertrag ist `NoCommit` | Ausgabevorschau und Download bleiben auf ihren abgesicherten Pfaden |
| `meal-plan` | gespeicherte Wochentage, aggregierte Bestellungen, Tagesliste der essenden Kinder und Lieferbeziehung gemäß Einstellungen und Rechten | Nicht essende Kinder erst im Änderungsfenster; weitere Wochen und Downloads bleiben bei ihrer Aktion. Entwurf und Schreibversion kommen aus dem gespeicherten Stand, nicht aus einer vorgezogenen Schreibvorschau. |
| `meal-plan/freigabe` | Bestätigte Monatsübersicht und der daraus gewählte Monat | Andere Monate, Freigabedialog und Schreiben erst auf Aktion |
| `students/[id]/change-history` | Feldänderungen mit Go-Prüfung des Vollzugriffs und der Dokumentkategorie | Kein vorgezogener, protokollierter Abruf der Kindakte für die Brotkrumennavigation |
| `students/[id]/feedback-history` | Rückmeldungsverlauf mit `feedback:read` und Go-Prüfung des Kindes, ohne die eingebetteten Kinderdaten aus der Wire-Antwort | Kein vorgezogener Abruf der Kindakte |
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

`/students/[id]`: Der GET der Kindakte kann einen Gesundheitszugriff
protokollieren. Weder ein Seiten-Seed noch Link-Intent startet ihn. Die
unabhängigen Ankunfts-, Abhol- und Statusdaten sowie die offene Abmeldung
nutzen ihre jeweiligen Go-Rechte für dieses Kind und denselben Zeitraum und
Schlüssel wie der Browser. Editoren und auf Wunsch geöffnete Dokumente sind
keine Seeds.
