---
status: accepted
---

# Die Klassenliste wird beim Einschalten zu Kindern ohne OGS-Platz

Entscheidung vom 16.11.2026 für
[#4803](https://github.com/moto-ogs/project-phoenix/issues/4803). Sie setzt
[ADR 0282](0282-kind-ohne-ogs-platz-ist-ein-kind-der-klasse-mit-eigenem-datensatz.md)
um: wie die Klassenlisteneinträge einer Schule zu Kindern ohne OGS-Platz
werden und wie die Schule danach solche Kinder anlegt. Sie genehmigt zwei
neue Leaf-Befehle und die Bindungen, die sie nach sich ziehen. Es gibt keinen
neuen Owner und keine Policy-Regel.

## Kontext

Die Umwandlung schreibt in fünf Owner: People Directory (Person,
Schülerprofil), School Membership (Mitgliedschaft mit dem Merkmal, Löschen
der Einträge), Care Plan (Betreuungsprofil), Student Presence (Anwesenheit am
Vormittag eines Eintrags) und die Audit-Plattform (Spur der Klassenliste).
Nach ADR 0067 koordiniert ein solcher Vorgang ein Workflow. Data Import ist
ein Workflow-Owner und legt Kinder schon heute in Stapeln über dieselben
Owner an.

## Entscheidung

- **Workflow Data Import.** `ClassListConversion.ConvertClassListEntries`
  (`modules/dataimport`) liest alle Einträge der Schule. Ein Eintrag, dessen
  Namen ein nicht abgegangenes Kind seiner Klasse schon trägt, wird diesem
  Kind zugeordnet. Für jeden anderen Eintrag legt die Stapelanlage des
  Kinder-Imports (`StudentImportConfig.CreateChunk`) ein Kind ohne OGS-Platz
  an. Danach liest ein zweiter Lesezugriff die neuen Kinder nach Name und
  Klasse; beides ist mengenbasiert. Dann zieht die Anwesenheit am Vormittag
  zum Kind, die Einträge gehen, und die Spur hält mit `assigned` fest,
  welches Kind ein Eintrag wurde. Der Handelnde ist das Konto, das den
  Schalter umgelegt hat.
- **Zwei Leaf-Befehle außerhalb der Capabilities** (wie
  `ClassListEntryBatches`, #5827):
  - School Membership `RemoveClassListEntries`: alle oder keine, in einem
    Statement.
  - Student Presence `ClassListMarkTransfer.TransferClassListEntryMarks`:
    Eine Vormittagsmarke eines Eintrags an einem Tag, für den das Kind schon
    eine eigene hat, geht; alle anderen bekommen das Kind als Subjekt. Das
    sind zwei Statements in der Einheit des Aufrufers. Die
    Beobachtungs-Callback-Grenze von Student Presence (`Service.observe`)
    gilt dafür wie für jeden anderen Befehl des Owners.
- **Auslöser.** Ein Seiteneffekt der Einstellungen auf
  `operations.children_without_care_place` und `module.unterricht_vormittag`
  (`api/root_settings_writes.go`) wandelt um, sobald beide an sind. Er läuft
  in der Transaktion des Schreibens; scheitert die Umwandlung, bleibt der
  Schalter, wie er war. Beide Schalter nehmen vor jedem Setzen oder
  Rücksetzen dieselbe exklusive Mandanten-Transaktionssperre. Der Hook liest
  den jeweils anderen Wert direkt aus dieser Transaktion, ohne vorgeladenen
  Snapshot oder Request-Cache. So wandelt auch gleichzeitiges Einschalten
  beider Schalter die Einträge um. Ausschalten wandelt nichts zurück.
- **Danach.** Ein Klassenlisten-Import bei eingeschaltetem Schalter wandelt
  die importierten Einträge in der Mandanten-Transaktion jedes Import-Batches
  gleich mit um. Einträge, Umwandlung und Checkpoint committen gemeinsam;
  ein Fehler rollt nur den betroffenen Batch zurück. Bereits bestätigte
  Batches sind auch bei einem späteren Importfehler vollständig umgewandelt.
  Einen einzelnen neuen Eintrag lehnt ein Dekorator im Root ab
  (`students.class_list_entries_replaced`); die Schule legt das Kind über
  „Ohne OGS-Platz“ im Anlegen-Dialog an. Ein Kind ohne OGS-Platz bekommt
  weder Gruppe noch Zeiten (`students.without_care_place_group`).

## Folgen

- Die Anlage zählt nicht für das Kinderkontingent; eine spätere Verlängerung
  der Anmeldung gibt dem Kind seinen Platz und zählt dann.
- Ein Rücksetzen des Vormittagsmoduls auf seine eingeschaltete
  Voreinstellung führt denselben Seiteneffekt wie das Einschalten aus.
  Scheitert die Umwandlung, bleibt das Modul ausgeschaltet.
