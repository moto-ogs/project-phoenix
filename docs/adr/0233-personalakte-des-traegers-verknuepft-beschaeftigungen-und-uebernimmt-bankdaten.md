---
status: accepted
---

# Personalakte des Trägers verknüpft Beschäftigungen und übernimmt Bankdaten

Entscheidung vom 14.11.2026 für
[#4705](https://github.com/moto-ogs/project-phoenix/issues/4705), Etappe 4 der
Spec [#4611](https://github.com/moto-ogs/project-phoenix/issues/4611). Sie
setzt [ADR 0089](0089-personal-wird-beim-traeger-gefuehrt-und-in-der-schule-eingesetzt.md)
Abschnitte 1 bis 6 für den Personalstamm um, ohne Arbeitsvertrag. Sie nimmt
die Entscheidungen E1 und E2 vom 13.11.2026 aus #4705 auf und legt fest, wie
Personalstamm, Schule und Freigabe technisch zusammenhängen.

## Kontext

- ADR 0089 legt Personalstamm und Arbeitsvertrag in Workforce, im Schema
  `workforce`, mit RLS über die Träger-Transaktion. Den Arbeitsvertrag baut
  [#4706](https://github.com/moto-ogs/project-phoenix/issues/4706). Bis dahin
  hängt die Beschäftigung einer Schule direkt am Personalstamm.
- E1: Die Finanzdaten liegen dort, wo die Personalakte geführt wird. Beim
  Verknüpfen gehen sie aus `users.staff_financial_data` in die Akte. Es gibt
  keine zwei gepflegten Kopien.
- E2: Vor der Freigabe bestätigt der Träger eine Vereinbarung mit
  Betriebsrat oder Mitarbeitervertretung zu Zeiterfassung und Einsatzplanung
  über Standorte (§ 87 Abs. 1 Nr. 2 und Nr. 6 BetrVG, MAVO, MVG.EKD) oder dass
  es keine Vertretung gibt.
- Die Personalnummer der Schule speist DATEV-Export, Personal-Import,
  Eröffnungsbuchungen und die Ansichten der Abrechnung. Alle lesen sie aus dem
  Profil der Beschäftigung.
- Andere Träger-Tabellen (`care_contract`) nennen eine Schule mit einer
  einfachen ID ohne Fremdschlüssel. So bleibt der Plan der Schullöschung
  unverändert.

## Entscheidung

1. **Freigabe beim Owner.** Die Freigabe „Personal beim Träger“ ist eine
   Zeile in `workforce.staff_releases` mit der bestätigten Aussage
   (`agreement` oder `none`). Das moto-Team setzt und entzieht sie im
   Operator-Portal in einer Admin-Transaktion. Den Operator-Audit-Eintrag
   schreibt Organisation & Tenancy in derselben Transaktion vorher, wie bei
   der Belegaufbewahrung (ADR 0184).
2. **Die Datenbank hält die Freigabe.** `workforce.staff_records` verweist
   per Fremdschlüssel auf die Freigabe. Ohne Freigabe entsteht keine Akte.
   Solange eine Akte besteht, schlägt der Entzug fehl. Wer entziehen will,
   löst die Akten vorher auf.
3. **Einsatzort ohne Fremdschlüssel.** `workforce.staff_record_links` nennt
   Schule und Beschäftigung mit einfachen IDs. Eine Verknüpfung, deren
   Beschäftigung die Schule beendet oder löscht, zeigt die Akte als beendet.
   Eine Schule liest per RLS nur die Verknüpfungen ihrer eigenen
   Beschäftigungen, nie eine Akte.
4. **Bankdaten ziehen um.** Beim Verknüpfen versiegelt Workforce die Werte
   neu, gebunden an Feld, Träger und Akte, und löscht danach die Zeile der
   Schule in deren Tenant-Transaktion mit einem Eintrag in deren
   Stammdaten-Audit. Für eine verknüpfte Beschäftigung zeigt die Schule
   „führt der Träger“ und lehnt Lesen im Klartext und Ändern ab
   (`workforce.staff_kept_by_traeger`). „Akte auflösen“ gibt jeder Schule mit
   laufender Beschäftigung die Werte zurück und löscht dann die Akte.
5. **Personalnummer wird gespiegelt.** Die Nummer der Akte ist je Träger
   eindeutig und die führende. Workforce schreibt sie nach jedem Verknüpfen
   und jeder Änderung in das Profil jeder laufenden Beschäftigung der Akte,
   in der Tenant-Transaktion der Schule, mit einem Eintrag im
   Stammdaten-Audit der Schule. So bleiben Export, Import und Abrechnung der
   Schule unverändert und stimmen mit dem Träger überein. Die Schule kann die
   Nummer einer verknüpften Beschäftigung nicht ändern: Ein Trigger an
   `users.staff_employment_profiles` lehnt jede andere Nummer als die der
   Akte ab, auch aus dem Personal-Import. Eine Nummer, die eine andere
   Beschäftigung einer Schule der Akte trägt, lehnt der Träger beim
   Verknüpfen und beim Ändern vor jeder Änderung ab.
6. **Reihenfolge der Transaktionen.** Workforce liest jede Schule in ihrer
   Tenant-Transaktion, schreibt die Akte in der Träger-Transaktion und
   bringt danach jede Schule in ihrer Tenant-Transaktion auf Stand: Nummer
   der Akte, keine Bankzeile der Schule. Keine Transaktion trägt beides
   (ADR 0105). Scheitert eine Schule nach dem Schreiben der Akte, holt jede
   weitere Änderung der Akte sie nach; bis dahin ändert die Schule nichts,
   was die Akte führt. Ändert eine Schule ihre Bankdaten genau zwischen der
   Vorschau und dem Verknüpfen, gilt der Wert der Vorschau; das Fenster ist
   eine Sache von Sekunden und steht im Stammdaten-Audit der Schule.
   „Akte auflösen“ ist ebenso wiederholbar: Eine Schule, die ihre Werte schon
   zurückbekommen hat, behält sie.
7. **Verlauf.** `workforce.staff_record_changes` hält jeden neuen
   Einsatzort, jeden nicht übernommenen Wert mit seiner Schule und jeden
   ersetzten Wert. Bank- und Steuerwerte stehen dort versiegelt mit Maske.
   Nur die Maske verlässt den Server.
8. **Zugriffsprotokoll.** Jede Ansicht, die Personen einer Schule zeigt,
   schreibt vorher einen Eintrag ins Zugriffsprotokoll dieser Schule
   (`traeger_staff_records`, für Bankdaten `traeger_staff_financial`) mit
   den gezeigten Beschäftigungen und der Akte. Eine Akte schreibt den Eintrag
   an jedem Einsatzort, auch wenn die Beschäftigung dort beendet ist. Ein
   gescheiterter Eintrag verhindert die Antwort.
9. **Demo.** Die Akten gehören dem Träger-Büro. Kein Besucher eines Demo-Trägers
   erreicht das Träger-Büro (seedTraegerBueroStep), und der Seed einer
   Demo-Bestellung verknüpft keine Akten: Nur der volle Seed legt sie an,
   bevor es Besucher gibt. Die Beschäftigung eines Besuchers landet so nie in
   einer Akte. Die Löschung von Demo-Besuchern nimmt die Akten deshalb nicht
   mit; sie gehen mit dem Träger.

## Verworfene Optionen

- **Freigabe als Träger-Einstellung:** Eine Einstellung kennt keine
  bestätigte Aussage. Außerdem dürfte das Träger-Büro sie selbst ändern.
- **Fremdschlüssel auf die Beschäftigung:** Er ändert den Fingerabdruck der
  Schullöschung. Er würde außerdem Zeilen des Trägers aus einer Schullöschung
  heraus löschen, was der Plan ausschließt.
- **Personalnummer nur beim Träger, alle Leser der Schule umstellen:** Export,
  Import, Eröffnungsbuchung und Abrechnung lesen das Profil an vielen Stellen.
  Der Lohnexport des Trägers (#4712) ersetzt den Export der Schule ohnehin.
- **Bankdaten in beiden Tabellen behalten:** widerspricht E1.

## Folgen

- Die Eröffnungsbuchung des Saldos jeder Schule (ADR 0089 Abschnitt 5) kommt
  mit dem Arbeitsvertrag (#4706, #4711).
- Namen und Geburtstag ändert die Akte in v1 nicht. Sie kommen aus der Wahl
  beim Verknüpfen. Die Schule pflegt sie weiter.
- Die Löschfrist nach dem Vertragsende (ADR 0089 Abschnitt 12) kommt mit dem
  Arbeitsvertrag. Bis dahin endet eine Akte durch „Akte auflösen“ oder mit dem
  Träger.

## Nachtrag 2026-11-16: eigener Demo-Träger je Besuch (#6193)

[ADR 0271](0271-jeder-demo-besuch-bekommt-einen-eigenen-demo-traeger.md)
ändert Punkt 9 für die Demo-Träger, die eine Bestellung für sich anlegt:
Der Besucher ist Mitglied ihres Träger-Büros. Der Seed verknüpft dort
Personalakten, aber keine, die die Beschäftigung des Besuchers nennt. Für den
gemeinsamen Demo-Träger gilt Punkt 9 unverändert.

## Nachtrag 2026-11-24: Auflösen gibt je Feld die neuere Eingabe zurück (#8029)

Seit [#7941](https://github.com/moto-ogs/project-phoenix/pull/7941) gilt beim
Verknüpfen nicht mehr der Wert der Vorschau (Punkt 6): Ändert eine Schule
ihre Bankzeile zwischen Vorschau und Verknüpfen, behält sie die Zeile. Der
Verknüpfungsschritt stempelt sie dabei über `linked_at` hinaus
(`HoldSchoolFinancialRow`), und der Verlauf der Akte nennt die Werte als
nicht übernommen. Jede spätere Änderung der Akte lässt eine so gehaltene
Zeile stehen.

„Akte auflösen“ entscheidet dann je Feld (IBAN, Steuer-ID, SV-Nummer), welche
Eingabe neuer ist:

1. Eine Zeile von vor dem Verknüpfen (`updated_at <= linked_at`), die eine
   gescheiterte Übergabe zurückließ, verliert in jedem Feld an die Akte.
2. In einer gehaltenen Zeile (`updated_at > linked_at`) gewinnt die Akte ein
   Feld, wenn ihr Verlauf für dieses Feld eine Änderung oder einen Import
   (`changed`, `imported`) nach `updated_at` der Zeile hat; sonst bleibt der
   Wert der Schule. Ein danach geleertes Feld wird auch bei der Schule
   geleert.
3. Ohne Zeile bekommt die Schule die Werte der Akte. Eine Zeile ohne jeden
   Wert wird gelöscht.

Workforce liest Akte und Zeitpunkte im Verlauf in der Träger-Transaktion unter
der Sperre der Akte, die jedes Schreiben ihrer Werte und Einsatzorte nimmt.
Ein Springer-Einsatz (`workforce.pool_link`) nimmt sie nicht selbst, wartet
aber mit seinem Verlaufseintrag über dessen Fremdschlüssel auf sie. Workforce
schreibt jede Schule in ihrer Tenant-Transaktion unter der Sperre der
Beschäftigung (ADR 0105). Gelöscht wird die Akte erst, wenn sie unter
erneuter Sperre noch dieselben Werte und Einsatzorte hat. Hat die
Personalverwaltung währenddessen gespeichert oder verknüpft, gibt die
Auflösung die Werte noch einmal zurück: Ein in dieser Zeit geänderter Wert
gewinnt an jedem Einsatzort, den der vorige Versuch schon geschrieben hat.
Ein neuer Einsatzort folgt den Regeln 1 bis 3; eine Zeile, die sein
Verknüpfen gehalten hat, bleibt also stehen. Ändert sich die Akte auch beim dritten
Versuch, wird die Auflösung als geändert abgelehnt (ADR 0311); die Akte
bleibt. Beide Zeitstempel stammen aus der
Datenbankuhr (ADR 0280). Jedes Feld, das sich bei der Schule ändert, steht mit
alter und neuer Maske in ihrem Stammdaten-Audit; ein unverändertes Feld
schreibt keinen Eintrag. Die Auflösung bleibt wiederholbar: Eine Zeile, die
eine abgebrochene Auflösung schon geschrieben hat, ist neuer als jede
Änderung der Akte davor und bleibt beim nächsten Versuch unverändert.
