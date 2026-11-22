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
- **Der Beweis hat zwei Teile.** Erstens die Vertragsanpassung selbst: Der
  Plan gibt die Buchungen als Anmeldung in dieselbe Rechnung, die
  `AmendFromBookings` nach der Bindung anstellt, und an keinem Tag darf eine
  Version entstehen. Ein Vertrag ohne Ende verspricht Betreuung über das
  Schuljahr hinaus; auch dafür schreibt die Anpassung keine Version
  (`care_ends` nach dem Ende der Phase), das hält keine Zeile zurück.
  Zweitens der direkte Vergleich: Die Anpassung übernimmt aus den Buchungen
  nur die Module, die sich an einem Tag ändern. Beginnt die geltende Version
  nach ihrer Buchung (Phase ab 01.08., Version ab 01.10.), gibt es keinen
  solchen Tag, und eine abweichende Endzeit bliebe unbemerkt. Deshalb
  vergleicht der Plan versprochene und gebuchte Betreuung an jedem Tag, an
  dem eine Buchung, eine Version, ein Modul oder der Vertrag beginnt oder
  endet: Wochentag, Modul und Endzeit. Bereit heißt: Die Buchungen sind der
  Vertrag.
- **Die Vergangenheit zählt, soweit sie gebucht wird.** Abgeleitete
  Buchungen beginnen am Betreuungsbeginn der Phase und werden von dort an
  verglichen, vor heute mit der heute geltenden Version: Versionen davor
  bucht niemand. Die Buchungen einer bestehenden Anmeldung werden ab heute
  verglichen. Was davor liegt, hat die Schule genehmigt, lässt sich nicht
  mehr ändern und erzeugt keine Version.
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
  Buchung in der Phase. Ein Modul der geltenden Version, dessen letzter Tag
  vorbei ist, wird nicht gebucht und entscheidet nichts, auch nicht über
  die Phase.
- **Gekündigte Verträge werden nicht angemeldet** (`contract_not_active`),
  auch wenn sie bis zu ihrem letzten Tag weiterlaufen. Die Anpassung liest
  nur aktive Verträge. Ein gebundener gekündigter Vertrag folgte seinen
  Buchungen nicht mehr: Eine genehmigte Buchungsänderung erzeugte keine
  Version, Vertrag und Buchungen liefen auseinander, ohne dass es jemand
  sieht. Das Kind bleibt bis zum Ende so betreut wie vor dem Lauf; nimmt das
  Büro die Kündigung zurück, nimmt der nächste Lauf den Vertrag mit.
- **Geplante Änderungen bleiben schon im Plan zurück** (`planned_change`).
  Hat der Vertrag eine Version, die erst nach heute beginnt, zeigt die
  Zeile die abgeleiteten Buchungen und die Änderung, ist aber nicht bereit:
  Die stille Anmeldung schreibt keine datierte Änderung (Abschnitt 2). Plan
  und Anmeldung sagen dasselbe. Ausnahme: Trägt eine bestehende Anmeldung
  des Kindes die Änderung schon in ihren Buchungen, wird der Vertrag an sie
  gebunden; dafür wird nichts geschrieben.
- Hat das Kind in der Phase schon eine angenommene Anmeldung, bekommt es
  keine zweite. Der Vertrag wird an genau diese gebunden, wenn es die
  einzige ist, sie keinen Vertrag hat und ihre eigenen Buchungen den Beweis
  bestehen; sonst bleibt die Zeile zurück (`has_application`). So beendet
  auch ein neuer Lauf einen abgebrochenen: Er findet die Anmeldung des
  ersten Laufs und bindet. Bewiesen wird, was gespeichert ist, nicht was der
  Plan heute ableiten würde: Ist seit dem ersten Lauf der letzte Tag eines
  Moduls vergangen, bucht die gespeicherte Anmeldung es weiter bis zu diesem
  Tag, und der Vertrag wird trotzdem gebunden.
- **`has_application` heißt auf beiden Seiten dasselbe, die Anmeldung
  entscheidet.** Der Plan liest nur angenommene Anmeldungen, aus denen ein
  Vertrag entstehen kann. Die Schule sieht mehr: eine Anmeldung, die auf
  eine Entscheidung wartet, und eine, die das Büro der Kinderakte zugeordnet
  hat (`matched_by_office`). Für jede davon antwortet
  `EnrollContractChildren` mit `has_application`. Diese Antwort gilt: Eine
  Zeile, die der Plan bereit nennt, bekommt dann weder Anmeldung noch
  Bindung, und der Workflow zeigt sie als zurückgehalten.
- **Die Zeile trägt, worauf sie bewiesen wurde.** Je Buchung die Endzeiten
  des Moduls an den gebuchten Wochentagen, seine angebotenen Tage und ob sie
  fest sind; je Zeile Betreuungsbeginn und -ende der Phase. Die Anmeldung
  vergleicht das unter ihren Sperren (Abschnitt 2).
- Ein Vertrag ohne Kinderakte wird nur genannt („ohne Kinderakte“); das Büro
  verknüpft ihn zuerst (ADR 0307). Ein gebundener Vertrag gilt als erledigt.
- Der Plan zeigt dem Träger-Büro Kinderakten und Anmeldungen der Schule. Er
  läuft nur in der Tenant-Transaktion genau dieser Schule (ein Lesen einer
  anderen Schule wird abgelehnt), und der Workflow schreibt das Lesen in
  derselben Transaktion ins Zugriffsprotokoll der Schule (ADR 0084 §7).

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
  (`has_application`). Gemeint ist jedes Kind einer Anmeldung der Phase, das
  die Kinderakte hält und weder abgelehnt noch zurückgezogen ist.
- **Ein überholter Plan wird abgelehnt** (`changed`). Unter den Sperren der
  Genehmigung vergleicht die Anmeldung, was die Zeile vom Plan mitbringt,
  mit der Schule: Betreuungsbeginn und -ende der Phase, je Buchung
  Endzeiten, angebotene Tage und Tagesmodus des Moduls. Hat die Schule
  zwischen Plan und Anmeldung etwas davon geändert, schreibt die Anmeldung
  nichts: Die Buchungen wurden gegen eine Schule bewiesen, die es so nicht
  mehr gibt. Der nächste Lauf plant neu.
- Abgelehnt je Zeile, ohne etwas zu schreiben: Kinderakte fehlt, ist nicht
  aktiv, hat keinen Betreuungsplatz oder kein Geburtsdatum; Angebot gehört
  nicht zur Phase; Tag wird nicht angeboten; Buchung beginnt nicht am
  Betreuungsbeginn der Phase.
- **Geplante Änderungen bleiben zurück** (`planned_change`). Eine datierte
  Änderung der Buchungen eines genehmigten Kindes läuft über Care Plans
  `AdjustOfferings`, und die endet in der Bekanntgabe an die
  Erziehungsberechtigten im Elternportal. Die stille Anmeldung schreibt
  deshalb keine. Das Kind wird angemeldet, sobald die geplante Version gilt.
  Der Plan hält solche Zeilen selbst zurück (Abschnitt 1); die Anmeldung
  lehnt sie zusätzlich ab.
- **Das Roster endet mit der Buchung.** Eine Buchung, die vor der Phase
  endet (Modul mit letztem Tag, Vertrag mit Ende), beendet auch die
  Roster-Zeile des Kindes. Für Angebote, die ihr Roster über die direkte
  Verknüpfung `ActivityGroupID` benennen, galt das bisher nicht: Care Plan
  schrieb die Zeile bis zum Ende der Phase, und das Kind blieb auf dem
  Roster und seinen Terminen. Das war ein Fehler für jede befristete
  Buchung bei einer Genehmigung und ist in Care Plan behoben
  (`booking_drafts.go`).
- **Die Zahl der Statements der Anmeldung selbst wächst nicht mit den
  Kindern.** Enrollment liest und schreibt in Mengen: Kinderakten und
  Personen, Angebote, Anmeldungen der Phase und deren Buchungen je einmal;
  Anmeldungen, Kinder und Wahlen in je einem Insert, die Genehmigungen in
  einem Update, die Entschuldigungen der Abholzeiten in einem Aufruf.
  **Rest:** Was aus den Buchungen eines Kindes entsteht, schreibt Care Plan
  mit den Bausteinen einer Genehmigung je Kind: Buchungen
  (`RecordCareOfferingBookings`), Roster (`MaterializeApprovedBookings`) und
  Roster mit mehreren Quellen (`ResyncMultiSourceTemplatesForChild`).
  Gemessen mit einem Angebot und einem Roster: 30 Statements für ein Kind,
  15 je weiteres Kind (3 + 9 + 3). Eine Mengenform wäre ein Umbau des
  Roster-Schreibers, den auch `Decide` und die Verlängerung nutzen, kein
  Zusatz zu diesem Lauf. Das Query-Budget
  `services.enrollment.contract_enrollments.enroll` hält beide Zahlen fest;
  der Rest ist dort exakt geprüft.
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
Versand. Eine wiederholte Bindung ändert nichts. Nennt ein Aufruf einen
Vertrag zweimal, bekommt jede Zeile ihre Antwort; der Aufruf scheitert nicht.

**Gebunden wird nur, was der Plan bewiesen hat.** Eine Regel sagt, an
welches Kind einer Anmeldung eine Bindung gehen darf, und das Kennzeichen der
Plan-Zeile (`Token`) trägt sie mit der Zeitleiste:

- Nennt die Zeile ein Kind einer Anmeldung (die bewiesene bestehende
  Anmeldung), wird genau an dieses gebunden. Das Kind wird nicht angemeldet.
- Nennt sie keines, wird an das Kind gebunden, das
  `EnrollContractChildren` für den Vertrag mit `enrolled` oder `existing`
  beantwortet hat; die Bindung trägt diese Antwort.

Jede andere Bindung ist `changed`. Auf `has_application`, `changed` oder
eine Ablehnung der Anmeldung folgt nie eine Bindung. Eine Anmeldung, die auf
eine Entscheidung wartet, eine später abgelehnte und eine vom Büro
zugeordnete werden deshalb nie gebunden. Zwischen dem Plan in der
Tenant-Transaktion und der Bindung in der Träger-Transaktion kann die Schule
eine bewiesene Anmeldung noch ablehnen; keine Transaktion hält beide Scopes
(ADR 0105). Der Vertrag stünde dann an einer abgelehnten Anmeldung. Das
Fenster ist eine Anfrage lang und bleibt als bekannte Lücke stehen; der Weg
zurück (Bindung lösen, siehe unten) ist auch dafür gedacht.

Für den Zustand „beide Ursprünge gesetzt“ gilt:

- Der Vertrag folgt seinen Buchungen (`AmendableContracts`); die
  Zusammenfassung sagt es (`follows_bookings`). `imported` und `taken_over`
  bleiben wahr.
- Die Verknüpfung mit der Kinderakte lässt sich nicht mehr lösen
  (`care_contract.child_link_bound`, 409): Anmeldung und Buchungen gehören zu
  dieser Kinderakte. **Eine falsche Verknüpfung aus Teil 1 lässt sich nach
  der Bindung also nicht mehr berichtigen**: Das Lösen ist abgelehnt, und
  die stille Anmeldung hat keinen Weg zum Löschen. Deshalb zeigt die
  Vorschau des Workflows (eigener PR) je Zeile das Kind des Vertrags neben
  der Kinderakte, bevor etwas läuft, und das Büro bestätigt diese Vorschau.
  Der Weg zurück, die Bindung lösen und die stille Anmeldung zurückziehen,
  ist ein eigenes Kommando und gehört zum selben PR; bis dahin ruft nichts
  die Bindung auf.
- **Der Vertrag schützt weiter vor einem zweiten Vertrag.** Er zählt für
  die Anmeldung, an die er gebunden ist, über seinen Schlüssel. Für jede
  andere Anmeldung des Kindes, deren Betreuung in seine Laufzeit fällt,
  bleibt er, was er vor der Bindung war: ein importierter Vertrag, der sie
  deckt (`runningImports`, `importCovers`). Ein gebundener Vertrag ohne Ende
  hält deshalb die Anmeldung der nächsten Phase als Kandidat zurück
  (`imported_contract`), statt dass ein zweiter Vertrag neben ihm entsteht
  und beide abgerechnet werden. Das Büro beendet ihn durch Kündigung; dann
  bekommt das Kind seinen Vertrag für die nächste Phase (ADR 0153). Nur die
  Anmeldung, an die er gebunden ist, deckt er nicht: Sie ist seine eigene.
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
   bereiten Kinder ohne bestehende Anmeldung (`EnrollContractChildren`),
   Eintrag ins Zugriffsprotokoll der Schule (ADR 0084 §7). **Das Protokoll
   ist Pflicht des Workflows**: Plan und Anmeldung schreiben es nicht selbst,
   und kein Lauf, auch keine Vorschau, liest die Schule ohne den Eintrag in
   derselben Transaktion.
3. Träger-Transaktion: Bindung (`BindApplications`), nach der Regel aus
   Abschnitt 3. Der Workflow führt die Antworten von Plan und Anmeldung
   zusammen; die Antwort der Anmeldung geht vor.

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

### 6. Die Verlängerung ins nächste Schuljahr

Die Verlängerung (`CreatePhaseFromSource`) übernimmt jedes genehmigte Kind
in die neue Phase. Für ein Kind der stillen Anmeldung hätte sie die leeren
Angaben der Erziehungsberechtigten kopiert, die Herkunft nicht (also
`public`), und keine Mail verschickt. Danach hätte im Modus Opt-in die Frist
das Kind zurückgezogen, weil niemand zugestimmt hat, und im Modus Opt-out
wäre eine Anmeldung ohne Erziehungsberechtigte ungesehen verlängert worden.

Regel: Eine Verlängerung, die keine Eltern beantworten können, geht in die
Prüfung der Schule. Das ist jede Anmeldung der Herkunft `contract_import`
und jede ohne Adresse und ohne Konto der Erziehungsberechtigten.

- Das neue Kind entsteht in `pending_admin_review` mit dem Grund
  `no_guardian`, in beiden Modi. Die Vorschau der Verlängerung zählt es
  unter diesem Grund; Vorschau und Lauf teilen die Regel.
- Die neue Anmeldung trägt die Herkunft `contract_import` weiter.
- Es geht keine Mail, und die Frist lässt die Prüfung in Ruhe: Sie zieht
  nur `pending_renewal` zurück und befördert nur `auto_renewed`.
- Die Schule entscheidet in der bestehenden Prüfliste der Verlängerung
  (behalten, entfernen, zurückstellen). Die Liste zeigt den Grund als
  „Keine Erziehungsberechtigten hinterlegt“.

Offen bleibt, was „behalten“ für eine solche Anmeldung tut: Es führt in die
übliche Genehmigung einer Verlängerung, und die gleicht Erziehungsberechtigte
und Einwilligungen mit der Anmeldung ab. Für eine Anmeldung ohne
Erziehungsberechtigte ist das nicht festgelegt. Der Schritt für die Eltern
(Abschnitt 5) und die Bindung des Folgevertrags gehören zu den Folge-PRs;
bis dahin gibt es keine Kinder dieser Herkunft.

## Register

Die Entscheidung ändert diese Register (ADR 0057 Punkt 5, ADR 0070):

- **Kommando-Effekte** (`backend/architecture/command-effects/`): neu für
  `enrollment.ContractEnrollments.EnrollContractChildren` die Sperre
  `timetable.RecurrenceWriteLock.LockRecurrenceWrites` und die Änderung
  `careplan.PickupAutoExcusal.ResyncFutureExceptions`, beide als bekannte
  Koordinationsschuld wie bei `Decide`, mit diesem ADR als Freigabe, sowie
  das Lesen `securityruntime.FillRandom`. `CheckContractChildren` hat keinen
  Effekt. Dazu das Lesen der Kinderakten und ihrer Personen als Menge
  (`peopledirectory.ListStudentsByID`, `ListPersonsByID`) über die Bindung
  `EnrollmentContractStudents`, als Abfrage eingestuft.
- **Query-Budget** (`backend/test/query-budgets/`): neu
  `services.enrollment.contract_enrollments.enroll`, 30 Statements für ein
  Kind; der Test prüft dazu exakt 15 je weiteres Kind (Abschnitt 2).
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
- **Prüfgrund der Verlängerung**: `no_guardian` (Abschnitt 6).

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
- **An eine vom Büro zugeordnete Anmeldung binden** (`matched_by_office`).
  Verträge lesen solche Anmeldungen bewusst nicht (#6053): Wer sie abgegeben
  hat, ist nicht Vertragspartei der Kinderakte. Das Kind bleibt zurück
  (`has_application`).
- **Ein gebundener Vertrag deckt keine andere Anmeldung mehr.** So stand es
  zuerst hier. Ein Vertrag ohne Ende hätte dann in der nächsten Phase einen
  zweiten Vertrag neben sich bekommen, und beide wären abgerechnet worden.
- **Eine Zeile mit geplanter Änderung bereit nennen und erst die Anmeldung
  ablehnen lassen.** Plan und Anmeldung widersprächen sich, und die Vorschau
  verspräche, was der Lauf nicht tut.
- **Die Roster je Lauf als Menge schreiben.** Verlangt einen zweiten
  Roster-Schreiber neben dem der Genehmigung; der Rest von 15 Statements je
  Kind ist für einen Lauf je Schule tragbar (Abschnitt 2).
- **Kinder der stillen Anmeldung von der Verlängerung ausnehmen.** Sie
  verlören ihre Betreuung im nächsten Jahr, ohne dass es jemand entscheidet.

## Folgen

- Ein gebundener Vertrag ist für seine Anmeldung ein Vertrag mit Anmeldung:
  Er folgt den Buchungen und erscheint an der Anmeldung der Schule. Für jede
  andere Anmeldung des Kindes bleibt er ein laufender importierter Vertrag,
  der sie zurückhält, bis er endet.
- Ein importierter Vertrag ohne Ende bleibt nach dem Schuljahr bestehen. Die
  Anpassung nennt ihn je Lauf als übersprungen (`care_ends`); beendet wird er
  über die Kündigung.
- Zeilen mit geplanter Änderung, abweichender Endzeit oder anderen Buchungen
  bleiben zurück, bis das Büro sie berichtigt oder die geplante Version gilt.
  Der Lauf ist wiederholbar und nimmt sie dann mit.
- Ändert die Schule zwischen Vorschau und Lauf ein Modul oder die Phase,
  meldet der Lauf die betroffenen Kinder als geändert und schreibt für sie
  nichts.
- Kinder der stillen Anmeldung erscheinen bei der Verlängerung in der
  Prüfliste der Schule statt in der Frist der Eltern.
- Die Rücknahme der Migration löst die Bindung importierter Verträge wieder;
  die Anmeldungen bleiben an der Schule und heißen dann „von Hand
  eingetragen“.
