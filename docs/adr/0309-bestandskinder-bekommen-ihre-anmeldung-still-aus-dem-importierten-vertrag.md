---
status: accepted
---

# Bestandskinder bekommen ihre Anmeldung still aus dem importierten Vertrag

Entscheidung vom 22.11.2026 zu
[#7760](https://github.com/moto-ogs/project-phoenix/issues/7760), Teil 2. Sie
setzt die drei Entscheidungen um, die
[ADR 0307](0307-importierte-vertraege-werden-ueber-kennungen-mit-der-kinderakte-verknuepft.md)
im Abschnitt „Anmeldung und Buchungen“ festhält, und ändert die Regel aus
[ADR 0232](0232-bestandsvertraege-kommen-aus-einer-datei-ohne-anmeldung.md)
und [ADR 0153](0153-betreuungsvertrag-entsteht-im-traeger-buero-aus-der-angenommenen-anmeldung.md),
dass ein Vertrag genau einen Ursprung hat.

## Kontext

Ein importierter Vertrag ist nach ADR 0307 mit der Kinderakte verknüpft. Das
Kind hat damit aber weder Anmeldung noch Buchungen. Die tägliche Betreuung
liest genehmigte Buchungen aus Enrollment und Care Plan, und
`AmendFromBookings` folgt nur Verträgen mit `request_child_id`. Die 313
Kinder von SJR Pforzheim haben einen Vertrag, den das Träger-Büro sieht, aber
keine Betreuung, die die Schule sieht.

Keiner der vorhandenen Wege passt: Die manuelle Anmeldung mit
`ExistingStudentID` setzt `matched_by_office`, und solche Kinder liest der
Vertrag nicht. Eine Phase für bestehende Kinder ändert Angaben der Eltern und
kann einem Elternkonto Zugang zur Schule geben.

## Entscheidungen des Product Owners

Yannick Wenger, 22.11.2026 (#7760), wie in ADR 0307 festgehalten:

1. Jedes migrierte Kind bekommt nachträglich eine Anmeldung, aus der die
   Buchungen entstehen. Der importierte Vertrag wird an Kinderakte und
   Anmeldung gebunden; `chk_contracts_origin` verlangt dafür mindestens einen
   Ursprung statt genau einen.
2. Nach der Bindung gilt der normale Weg: Eine genehmigte Buchungsänderung
   erzeugt eine neue Vertragsversion. Migrierte Verträge verhalten sich danach
   wie alle anderen.
3. Der Massenlauf bleibt still: kein Versand und keine Einladung als
   Nebenwirkung. Danach löst das Büro bewusst einen getrennten Schritt aus:
   eine Mail an die Eltern und die Einladung ins Elternportal für alle, die
   noch kein Konto haben.

## Entscheidung

### 1. Buchungen aus dem Vertrag, mit Beweis (Care Contract)

Der Plan (`carecontract.ContractEnrollments`) sagt je importiertem Vertrag
einer Schule, welche Buchungen eine Anmeldung tragen muss:

- Buchungen sind halboffen. Das Roster eines genehmigten Kindes wird am
  Betreuungsbeginn der Phase gelesen, also beginnt die Buchung der heute
  geltenden Version dort, egal wann der Vertrag begann. Sie endet mit dem
  frühesten von: letzter Tag des Moduls, Ende der Version, Ende einer
  Kündigung, Beginn der nächsten Version, Ende der Phase.
- Jede spätere Version ist eine geplante Änderung an ihrem ersten Tag.
  Versionen vor der geltenden werden nicht gebucht.
- **Der Beweis ist die Vertragsanpassung selbst.** Der Plan gibt die
  abgeleiteten Buchungen als Anmeldung in dieselbe Rechnung, die
  `AmendFromBookings` nach der Bindung anstellt. Bereit ist eine Zeile nur,
  wenn an keinem Tag eine Version entstünde. Ein Vertrag ohne Ende verspricht
  Betreuung über das Schuljahr hinaus; auch dafür schreibt die Anpassung
  keine Version (`care_ends` nach dem Ende der Phase), das hält keine Zeile
  zurück.
- **Abweichende Endzeiten bleiben zurück.** Weicht die Endzeit eines
  Wochentags im Vertrag von der des Moduls ab, etwa weil eine
  Angebotskorrektur (ADR 0306) die alte Endzeit behielt, würde die Buchung
  eine neue Version mit der Endzeit des Moduls erzeugen. Der Standard ist:
  Die Zeile bleibt zurück (`end_time`), nie eine stille neue Version. Das
  Büro berichtigt den Vertrag oder das Modul.
- Nicht ableitbar, jeweils mit Grund: Vertrag nicht aktiv, Vertrag noch nicht
  begonnen, Modul kein Betreuungsangebot der Schule mehr, Module aus zwei
  Phasen, Phase noch nicht begonnen oder beendet, Modul mit festen Tagen an
  anderen Tagen, Tag vom Modul nicht angeboten, Betreuung versprochen ohne
  Buchung in der Phase.
- Hat das Kind in der Phase schon eine angenommene Anmeldung, bekommt es
  keine zweite. Der Vertrag wird an diese gebunden, wenn deren Buchungen den
  Beweis bestehen; sonst bleibt die Zeile zurück (`has_application`). So
  beendet auch ein neuer Lauf einen abgebrochenen: Er findet die Anmeldung
  des ersten Laufs und bindet.
- Ein Vertrag ohne Kinderakte wird nur genannt („ohne Kinderakte“); das Büro
  verknüpft ihn zuerst (ADR 0307). Ein gebundener Vertrag gilt als erledigt.

### 2. Die stille Anmeldung (Enrollment)

`enrollment.ContractEnrollments.EnrollContractChildren` legt in der
Tenant-Transaktion der Schule je Kind eine Anmeldung mit der Herkunft
`contract_import` an: ohne Erziehungsberechtigte, ohne Adresse, ohne Konto,
ohne Einwilligungen und ohne Rechtsnachweis, mit einem genehmigten Kind, das
auf die bestehende Kinderakte zeigt, mit den Buchungen des Plans und den
Rostern, die eine Genehmigung daraus ableitet. `reviewed_at` trägt den
Zeitpunkt, den der Vertrag als Annahme liest.

Sie ändert weder Kinderakte noch Erziehungsberechtigte, Beziehungen, Konten,
Einwilligungen oder Wochenpläne und schreibt keine Mail, keinen Push und
keine Einladung. Weil die Anmeldung keine Adresse trägt, findet sie kein
Elternkonto im Elternportal. Sie ruft bewusst nicht auf: die Abgabe
(`Submit`), die Entscheidung mit Mail und Einladung (`Decide`,
`DecideAndInvite`), die Verlängerung der Kinderakte, alles zu
Erziehungsberechtigten, die Formularfelder, den Wochenplan und die
Bekanntgabe der Abholzeiten, die die Erziehungsberechtigten im Elternportal
erreicht.

- Wiederholbar: Ein Kind, das die Anmeldung dieser Herkunft in der Phase
  schon hat, wird mit ihr beantwortet.
- Ein Kind mit einer anderen Anmeldung in der Phase bekommt keine
  (`has_application`).
- Abgelehnt je Zeile, ohne etwas zu schreiben: Kinderakte fehlt, ist nicht
  aktiv, hat keinen Betreuungsplatz oder kein Geburtsdatum; Angebot gehört
  nicht zur Phase; Tag wird nicht angeboten; Buchung beginnt nicht am
  Betreuungsbeginn der Phase.
- **Geplante Änderungen bleiben zurück** (`planned_change`). Eine datierte
  Änderung der Buchungen eines genehmigten Kindes läuft über Care Plans
  `AdjustOfferings`, und die endet in der Bekanntgabe an die
  Erziehungsberechtigten im Elternportal. Die stille Anmeldung schreibt
  deshalb keine. Das Kind wird angemeldet, sobald die geplante Version gilt.
- **Buchungen einer bestehenden Anmeldung werden nicht überschrieben**
  (`bookings_differ`). Die Roster eines genehmigten Kindes werden einmal
  abgeleitet; das Büro ändert die Buchungen auf dem üblichen Weg.
- Ein genehmigtes Kind dieser Herkunft belegt seinen Platz wie jedes andere.
  Eine Kapazitätsprüfung gibt es nicht: Die Kinder werden schon betreut.

Die Herkunft `contract_import` gilt überall als vom Büro eingetragen: keine
Unterschrift der Eltern, kein Annahmenachweis für einen Vertragsabschluss,
und eine spätere Änderung hält keine Elternidentität fest. In Listen des
Büros heißt sie „Aus importiertem Vertrag“.

### 3. Die Bindung (Care Contract)

`BindApplications` setzt `request_child_id` eines importierten Vertrags, in
der Träger-Transaktion, unter der Sperre der Verknüpfungen (ADR 0307) und den
Zeilensperren der Verträge. Es prüft erneut: importiert, aktiv, ungebunden,
dieselbe Kinderakte, dieselbe Zeitleiste wie im Plan, und das Kind der
Anmeldung hat noch keinen Vertrag. Ein Vertrag, der sich geändert hat, bleibt
ungebunden (`changed`). Die Bindung schreibt in den Verlauf
(`bind_application`) und sonst nichts: keine Version, kein Dokument, kein
Versand. Eine wiederholte Bindung ändert nichts.

Für den Zustand „beide Ursprünge gesetzt“ gilt:

- Der Vertrag folgt seinen Buchungen (`AmendableContracts`); die
  Zusammenfassung sagt es (`follows_bookings`). `imported` und `taken_over`
  bleiben wahr.
- Die Verknüpfung mit der Kinderakte lässt sich nicht mehr lösen
  (`care_contract.child_link_bound`, 409): Anmeldung und Buchungen gehören zu
  dieser Kinderakte.
- Der Vertrag zählt über seinen Schlüssel und deckt keine andere Anmeldung
  des Kindes mehr (`runningImports`). In der nächsten Phase bekommt das Kind
  seinen Vertrag wie jedes andere (ADR 0153).
- Angebotskorrekturen aus einer Datei (ADR 0306) lehnen ihn als
  `follows_bookings` ab. Korrekturen der Vertragsangaben (#7767) bleiben
  möglich.

Zwischen Anmeldung und Bindung entsteht weder ein zweiter Vertrag noch eine
Mail: Der ungebundene Vertrag deckt das neue Kind der Anmeldung über die
Kinderakte (ADR 0307 Punkt 6), das Anlegen von Hand prüft unter der Sperre,
und der Abschluss bei der Annahme findet keinen Annahmenachweis.

### 4. Der Lauf ist ein Workflow (`contract-enrollment`)

Der Lauf schreibt in zwei Scopes: in der Tenant-Transaktion der Schule
(Anmeldung, Zugriffsprotokoll) und in der Träger-Transaktion (Bindung). Keine
Transaktion hält beide (ADR 0105). Er braucht ein eigenes Protokoll: die
Reihenfolge der Transaktionen, das erneute Lesen des Vertrags unter Sperren
und einen Wiederanlauf nach einem Abbruch. Nach dem Nachtrag zu
[ADR 0067](0067-principle-owners-meet-through-contracts-and-write-together-in-workflows.md#addendum-2026-10-23-command-participation-and-coordination-4538)
ist das Koordination, kein teilnehmendes Kommando. Der neue Owner
`contract-enrollment` unter `workflows/contractenrollment/` koordiniert, nach
dem Muster von `traeger-catalog-rollout`:

1. Träger-Transaktion: Verträge lesen (`EnrollmentContracts`).
2. Tenant-Transaktion der Schule: Plan (`EnrollmentPlans`), Anmeldung der
   bereiten Kinder (`EnrollContractChildren`), Eintrag ins Zugriffsprotokoll
   der Schule (ADR 0084 §7).
3. Träger-Transaktion: Bindung (`BindApplications`).

Bricht der Lauf zwischen 2 und 3 ab, gibt es die Anmeldung, und der Vertrag
ist ungebunden. Der nächste Lauf bindet; nichts entsteht doppelt.

- **Ports**: `Contracts` (`carecontract.ContractEnrollments`),
  `SchoolEnrollments` (`enrollment.ContractEnrollments`), `Access`
  (Zugriffsprotokoll der Schule), `Schools` (Schulen des Trägers), `Runtime`
  (Träger- und Tenant-Transaktion, ein exklusiver Abschnitt je Träger).
- **Routen**: `POST /traeger/contract-enrollments/preview` und
  `POST /traeger/contract-enrollments/` mit `{school_id, fingerprint}`, Recht
  „Verträge verwalten“. Ein Lauf betrifft eine Schule und übernimmt nur die
  bestätigte Vorschau.

Dieser ADR legt den Owner fest. Workflow, Routen, Oberfläche und Seed-Daten
folgen in einem eigenen PR; die Fähigkeiten aus den Abschnitten 1 bis 3
liegen bis dahin vor, ohne dass etwas sie aufruft.

### 5. Der Schritt für die Eltern

Der Auslöser bleibt die bestehende Sammeleinladung der Schule
(`POST /guardians/bulk-invite`). Sie lädt wie bisher alle
Erziehungsberechtigten ohne Konto ins Elternportal ein. Neu ist eine Mail an
Erziehungsberechtigte, die schon ein Konto haben
(`guardian-care-visible.html`, Schalter `NotifyActive` der Sammeleinladung):
Die Betreuung ihres Kindes ist jetzt im Elternportal sichtbar. Der Lauf aus
Abschnitt 4 löst diesen Schritt nie selbst aus.

## Register

Die Entscheidung ändert diese Register (ADR 0057 Punkt 5, ADR 0070):

- **Kommando-Effekte** (`backend/architecture/command-effects/`): neu für
  `enrollment.ContractEnrollments.EnrollContractChildren` die Sperre
  `timetable.RecurrenceWriteLock.LockRecurrenceWrites` und die Änderung
  `careplan.PickupAutoExcusal.ResyncFutureExceptions`, beide als bekannte
  Koordinationsschuld wie bei `Decide`, mit diesem ADR als Freigabe, sowie
  das Lesen `securityruntime.FillRandom`. `CheckContractChildren` hat keinen
  Effekt.
- **Compose-Budgets** (`backend/test/module_legacy_budget_ratchet_test.go`):
  `modules/carecontract/compose` 188 → 195 (Konstruktor
  `NewContractEnrollments` und der Typ seiner Ports). Der Konstruktor baut
  nur seinen Owner (ADR 0068).
- **Verlauf**: `chk_contract_events_action` kennt `bind_application`,
  `chk_contracts_origin` verlangt mindestens einen Ursprung, die Request-Rolle
  darf `request_child_id` setzen (Migration `20261122202100`).
- **Herkunft**: `chk_enrollment_requests_submission_source` kennt
  `contract_import` (Migration `20261122202200`).
- **Fehlercode**: `care_contract.child_link_bound`.

## Verworfene Optionen

- **Manuelle Anmeldung mit `ExistingStudentID`.** Setzt `matched_by_office`;
  solche Kinder liest der Vertrag bewusst nicht.
- **Phase für bestehende Kinder mit `send_notification: false`.** Verschickt
  nichts, ändert aber Angaben der Eltern und kann einem Elternkonto Zugang
  geben.
- **Buchungen direkt in Care Plan schreiben, ohne Anmeldung.** Die tägliche
  Betreuung, die Kapazität und die Verlängerung ins nächste Jahr hängen am
  genehmigten Kind der Anmeldung.
- **Abweichende Endzeiten still übernehmen.** Erzeugt bei der ersten
  Anpassung eine Version, die niemand beschlossen hat.
- **Geplante Änderungen über `AdjustOfferings` schreiben.** Erreicht die
  Erziehungsberechtigten im Elternportal und ist damit nicht still.
- **Buchungen eines schon angemeldeten Kindes ersetzen.** Die Roster einer
  Genehmigung werden nur eingefügt, nie neu abgeleitet; ersetzte Buchungen
  ließen alte Roster stehen.
- **Ein Kommando statt eines Workflows.** Der Lauf wechselt zwischen zwei
  Scopes und braucht den Wiederanlauf; das ist Koordination (ADR 0067).

## Folgen

- Ein gebundener Vertrag ist für jede Stelle ein Vertrag mit Anmeldung: Er
  folgt den Buchungen, erscheint an der Anmeldung der Schule und in der
  nächsten Phase bekommt das Kind einen neuen Vertrag.
- Ein importierter Vertrag ohne Ende bleibt nach dem Schuljahr bestehen. Die
  Anpassung nennt ihn je Lauf als übersprungen (`care_ends`); beendet wird er
  über die Kündigung.
- Zeilen mit geplanter Änderung, abweichender Endzeit oder anderen Buchungen
  bleiben zurück, bis das Büro sie berichtigt oder die geplante Version gilt.
  Der Lauf ist wiederholbar und nimmt sie dann mit.
- Die Rücknahme der Migration löst die Bindung importierter Verträge wieder;
  die Anmeldungen bleiben an der Schule und heißen dann „von Hand
  eingetragen“.
