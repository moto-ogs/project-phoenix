---
status: accepted
---

# Der Lohnexport des Trägers teilt nach Arbeitgeber oder kennzeichnet mit Kostenstelle

Entscheidung vom 24.11.2026 zu
[#8041](https://github.com/moto-ogs/project-phoenix/issues/8041). Der Product
Owner hat am 24.11.2026 entschieden, dass beide Formen möglich sein müssen
und der Träger wählt (Kommentar im Issue). Die Einzelheiten unten hat die
Umsetzung aus Issue, Code und den ADRs entschieden. Die ADR löst
[ADR 0089](0089-personal-wird-beim-traeger-gefuehrt-und-in-der-schule-eingesetzt.md)
§4 Satz 3 („In v1 hat ein Träger genau einen Arbeitgeber und einen
DATEV-Mandanten“) ab und ergänzt
[ADR 0250](0250-lohnexport-des-traegers-bucht-jede-art-des-arbeitsvertrags-mit-eigenen-lohnarten.md)
und [ADR 0318](0318-zustaendigkeit-je-schule-ist-einstellung-die-stelle-stammdatum.md)
§8. Sie führt keinen neuen Owner ein.

## Kontext

- Seit ADR 0318 bestimmt die Einstellung `responsibility.staff` je Schule,
  wer das Personal anstellt: Träger, Schulträger oder Gemeinde. Wirksam ist
  eine Stelle erst mit ihren Stammdaten (`organizationtenancy.EffectiveBody`).
- Der Lohnexport des Trägers schreibt eine Datei über alle Schulen mit einer
  Berater- und Mandantennummer (`traeger_payroll.*`, ADR 0250 §3). Er
  vermischt so die Stunden verschiedener Arbeitgeber ohne Kennzeichen.
- LODAS liest Berater- und Mandantennummer aus dem Kopf `[Allgemein]` der
  Datei. Eine Datei gehört zu genau einem Mandanten. Lohn und Gehalt hat
  keinen Kopf; der Mandant wird beim Import gewählt. Ein Arbeitgeber ist in
  DATEV ein eigener Mandant.
- Beide Formate kennen je Buchung eine Kostenstelle: LODAS das Feld
  `kostenstelle#bwd` der Tabellen `u_lod_bwd_buchung_stunden` und
  `u_lod_bwd_buchung_tage`, Lohn und Gehalt die Spalte
  `Kostenstellennummer` der Bewegungsdaten, die der Export schon schreibt
  (leer).
- Die Personalnummer ist in DATEV je Mandant eindeutig. ADR 0089 §4 hält
  eine Nummer je Personalstamm, eindeutig je Träger, und schreibt sie in das
  Profil jeder Beschäftigung (ADR 0233 §5).

## Entscheidung

1. **Der Träger wählt die Form.** Die Einstellung
   `traeger_payroll.file_form` hat die Werte `traeger` („Eine Datei für den
   ganzen Träger“, Standard, das bisherige Verhalten) und `arbeitgeber`
   („Eine Datei je Arbeitgeber“). Sie hat die Ebene `traeger` und das Recht
   „Personal“, wie die übrigen Lohnwerte (ADR 0250 §3).
2. **Arbeitgeber eines Einsatzorts** ist die Stelle, die
   `responsibility.staff` an dessen Schule wirksam nennt (ADR 0318 §3). Ein
   Einsatzort aus dem Vertretungspool gehört immer zum Träger, wie in der
   Personalakte (ADR 0318 §7). Ein Arbeitsvertrag mit Einsatzorten bei zwei
   Arbeitgebern wird je Arbeitgeber getrennt summiert; nichts zählt doppelt.
   Maßgeblich ist die Stelle, die beim Export wirksam ist: Wechselt eine
   Schule den Arbeitgeber, ordnet ein erneuter Export auch frühere Monate dem
   neuen zu. Eine Historie der Zuständigkeit gibt es nicht.
3. **Lohnwerte eines anderen Arbeitgebers liegen bei Workforce.** Die neue
   Tabelle `workforce.payroll_employers` hält je Schule und Stelle
   (Schulträger oder Gemeinde) Berater-, Mandantennummer und Kostenstelle.
   Sie sind Lohnwerte wie `traeger_payroll.*`, keine Stammdaten der Stelle:
   Sie gehören auf die Seite „Lohnexport“, unter das Recht „Personal“. Name
   und Anschrift der Stelle bleiben bei Organisation & Tenancy (ADR 0318 §2).
   Die Zeile steht unter der Träger-Policy und nennt ihre Schule ohne
   Fremdschlüssel. Entfernt das Träger-Büro die Stelle, bleibt die Zeile
   ohne Wirkung stehen und wirkt wieder, wenn dieselbe Stelle zurückkommt.
4. **Form `arbeitgeber`: eine Datei je DATEV-Mandant.** Jede Datei hat im
   LODAS-Kopf die Nummern ihres Arbeitgebers, der Träger die aus
   `traeger_payroll.*`. Haben zwei Stellen dieselbe Berater- und
   Mandantennummer, etwa eine Gemeinde an zwei Schulen, ist das eine Datei.
   In dieser Form braucht jeder Arbeitgeber mit Werten im Monat beide
   Nummern, auch bei Lohn und Gehalt: Sie unterscheiden die Dateien und
   stehen im Dateinamen, damit das Lohnbüro jede in den richtigen Mandanten
   liest. Jede Datei ist für sich bereit; eine fehlende Nummer beim einen
   Arbeitgeber hält die Datei des anderen nicht auf.
5. **Form `traeger`: eine Datei mit Kostenstelle.** Die Datei hat die
   Nummern des Trägers. Jede Zeile eines Einsatzorts bei einem anderen
   Arbeitgeber trägt dessen Kostenstelle; Zeilen des Trägers haben keine.
   Eine Person mit Einsatzorten bei zwei Arbeitgebern hat so je Arbeitgeber
   eigene Zeilen. Fehlt einem anderen Arbeitgeber mit Werten im Monat die
   Kostenstelle, entsteht keine Datei. So stehen Einsatzorte verschiedener
   Arbeitgeber nie ungekennzeichnet in einer Datei. LODAS bekommt dafür die
   Satzarten 4 (Stunden) und 5 (Tage) mit `kostenstelle#bwd`; sie stehen nur
   in einer Datei, die eine Kostenstelle bucht, so bleibt jede andere Datei
   Byte für Byte gleich. Die Kostenstelle hat 1 bis 8 Ziffern, was beide
   Formate lesen.
6. **Personalnummer je Arbeitgeber.** Die Nummer des Personalstamms gilt bei
   jedem Arbeitgeber (ADR 0089 §4 bleibt sonst). Für einen Einsatzort bei
   einem anderen Arbeitgeber kann die Personalverwaltung eine eigene Nummer
   eintragen, wenn dessen Lohnbüro die Person unter einer anderen Nummer
   führt. Sie steht am Einsatzort (`workforce.staff_record_links`) mit der
   Stelle, für die sie gilt; nennt die Schule später eine andere Stelle,
   gilt sie nicht mehr. Nur die Form `arbeitgeber` nutzt sie; die eine Datei
   ist ein Mandant und braucht die eine Nummer. Jede Änderung steht im
   Verlauf der Akte. Die Nummer der Beschäftigung in der Schule bleibt die
   des Personalstamms (ADR 0233 §5).
7. **Was die Prüfung je Datei zeigt.** Die Prüfung nennt je Datei
   Arbeitgeber, Schulen, Personen, Zeilen und ob sie bereit ist, dazu je
   Arbeitgeber, was fehlt. Eine Datei, in der zwei Personen dieselbe Nummer
   hätten, entsteht nicht; DATEV würde die Stunden einer Person zuschreiben.
   Ebenso wenig eine Datei, in der eine Person unter zwei Nummern stünde,
   etwa weil ihre Nummer bei der Gemeinde nur an einem von zwei Einsatzorten
   eingetragen ist. Ein Arbeitgeber ohne Wert im Monat hält nichts auf, und
   eine Datei ohne Zeile erscheint nicht.
   Steht eine Person in mehreren Dateien, nennt die Prüfung sie, damit das
   Lohnbüro ihre Nummer bei jedem Arbeitgeber prüft. Personen ohne
   Personalnummer und fehlende Lohnarten halten wie bisher jede Datei auf.
8. **Lohnarten des Trägers gelten für alle Arbeitgeber.** Jede Datei bucht
   mit den 35 Lohnarten aus `traeger_payroll.wage_type.*`. Eigene Lohnarten
   je Arbeitgeber gibt es nicht.
9. **Lesen ohne neuen Owner.** Workforce liest die wirksame Stelle je Schule
   über den eigenen Port `TraegerPayrollEmployers`, den die Wurzel an
   `ResponsibleParties` bindet (wie `TraegerStaffEmployers`). Die Werte des
   Monats liest der Export wie bisher je Schule in ihrer Tenant-Transaktion,
   nach dem Eintrag im Zugriffsprotokoll (ADR 0250 §5). Das Abfragebudget
   `api.traeger.staff_payroll_export` bleibt bei 41: Die Lohnwerte des
   Trägers lesen in derselben Träger-Transaktion wie die Akten, und
   Organisation & Tenancy liest Einstellungen und Schulliste nur für Schulen
   mit gespeicherter Stelle; ohne Stelle kostet die Frage eine Anweisung.

## Verworfene Optionen

- **Nur eine Datei je Arbeitgeber:** Ein Träger, dessen Lohnbüro alles unter
  einem Mandanten abrechnet und Kosten weiterberechnet, verlöre seine Datei.
  Der Product Owner verlangt beide Formen.
- **Ein Kennzeichen als Freitext im Kopf:** LODAS und Lohn und Gehalt kennen
  im Kopf keinen Freitext für einen Arbeitgeber (#8041).
- **Berater- und Mandantennummer bei den Stammdaten der Stelle**
  (`platform.school_responsible_parties`): Die Nummern des Trägers sind
  Lohnwerte unter dem Recht „Personal“. Bei der Stelle bräuchte die
  Personalverwaltung das Recht „Einstellungen“ und eine zweite Seite für
  dieselbe Aufgabe.
- **Eine Nummer je Person für alle Arbeitgeber:** Führt das Lohnbüro der
  Gemeinde die Person unter einer anderen Nummer, bucht die Datei die
  Stunden einer anderen Person zu. Eine Pflichtnummer je Arbeitgeber wäre
  das andere Extrem: Wer bei allen Arbeitgebern dieselbe Nummer hat, müsste
  sie mehrfach eintragen.
- **Eigene Lohnarten je Arbeitgeber:** 35 Felder je Schule und Stelle, ohne
  Kunden, der das braucht. Ein Lohnbüro, das mehrere Mandanten führt, legt
  Lohnarten meist mandantenübergreifend an.
- **Personalnummer je Arbeitgeber in einer eigenen Tabelle:** Die Nummer
  gehört zu genau einem Einsatzort; die Zeile des Einsatzorts hat schon
  Träger-Policy, Lebenszyklus und Rückgabe.

## Folgen

- Migration `20261124180000_traeger_payroll_employers` legt die Tabelle an,
  ergänzt `workforce.staff_record_links` um `employer_body` und
  `employer_personnel_number` und erlaubt im Verlauf das Feld
  `employer_personnel_number`.
- Neue Routen `GET` und `PUT /traeger/staff-exports/payroll/employers` (Recht „Personal“)
  und `PUT /traeger/staff-records/{id}/employer-numbers/{schoolId}`. Die
  Download-Route der Lohndatei nimmt in der Form `arbeitgeber` den
  Parameter `file`.
- Hat ein Träger schon eine Schule, deren Personal eine Gemeinde anstellt,
  hält die eine Datei an, bis die Kostenstelle eingetragen ist. Die Seite
  nennt den Arbeitgeber und führt in die Einrichtung.
- Die Hilfe „Lohnexport und Zeitexport“ beschreibt beide Formen Schritt für
  Schritt.
- Offen bleiben: eigene Lohnarten je Arbeitgeber, eine Kostenstelle für die
  Zeilen des Trägers und ein SFTP-Ziel (ADR 0250).
