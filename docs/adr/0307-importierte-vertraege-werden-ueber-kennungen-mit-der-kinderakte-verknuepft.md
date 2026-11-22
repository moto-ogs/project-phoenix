---
status: accepted
---

# Importierte Verträge werden über Kennungen mit der Kinderakte verknüpft

Entscheidung vom 22.11.2026 zu
[#7760](https://github.com/moto-ogs/project-phoenix/issues/7760). Sie führt
den Schritt aus, den
[ADR 0232](0232-bestandsvertraege-kommen-aus-einer-datei-ohne-anmeldung.md)
Punkt 6 offen ließ, und hält
[ADR 0214](0214-traeger-buero-sieht-ein-an-einer-schule-bekanntes-ferienkind.md)
ein: Name und Geburtsdatum verknüpfen nichts.

## Kontext

SJR Pforzheim hat 313 Verträge importiert und keiner ist mit einer
Kinderakte verknüpft. Ohne Verknüpfung fehlen Soll-Ist je Kind, die genaue
Zuordnung des Essens, die Geschwisterfolge über die Kinderakte und Rechnungen
im Elternpostfach.

## Entscheidung

1. **Die Kennungen entscheiden.** Das Träger-Büro nennt den Vertrag über
   seine Nummer und die Kinderakte über ihre Nummer an der Schule des
   Vertrags: in einer Datei für viele Verträge oder von Hand für einen.
   Name und Geburtsdatum werden nur verglichen. Stimmen sie nicht überein,
   bleibt die Zeile zurück; stimmen sie überein, verknüpft das allein nichts
   (ADR 0214 bleibt gültig).
2. **Unklares bleibt offen.** Eine Zeile wird nicht verknüpft, wenn der
   Vertrag oder die Kinderakte fehlt, der Vertrag aus einer Anmeldung
   stammt, die Datei einen Vertrag für zwei Kinder oder ein Kind für zwei
   Verträge derselben Zeit nennt (dann bleibt jede dieser Zeilen zurück, die
   Reihenfolge entscheidet nichts), der Vertrag schon ein
   anderes Kind hat, das Kind in derselben Zeit schon einen laufenden
   Vertrag an der Schule hat oder Name und Geburtsdatum abweichen. Die
   Vorschau nennt den Grund. Nur die Abweichung von Name oder Geburtsdatum
   kann das Büro von Hand bestätigen, einzeln und mit beiden Angaben
   nebeneinander.
3. **Wiederholbar.** Ein Vertrag, der schon mit dem genannten Kind verknüpft
   ist, gilt als verknüpft. Der Lauf übernimmt nur die bestätigte Vorschau
   (Fingerabdruck), sonst `care_contract.child_link_changed`. Auch das
   Verknüpfen und Lösen eines einzelnen Vertrags trägt den Stand, den das
   Büro gesehen hat: den Fingerabdruck der Vorschau bzw. die Kinderakte, die
   gelöst werden soll.
4. **Nur die Verknüpfung ändert sich.** Der Lauf setzt `student_id` und
   schreibt in den Verlauf (`link_child`, `unlink_child`, mit Datei und
   Zeile). Version, Dokument, Vertragspartner, Debitorennummer und Mandat
   bleiben. Er verschickt nichts und startet keinen Rechnungs- oder
   Zahlungslauf; schon ausgestellte Rechnungen bleiben, wie sie sind.
5. **Lösen.** Das Büro kann die Verknüpfung eines importierten Vertrags
   wieder lösen, um einen Fehler zu berichtigen. Ein Vertrag aus einer
   Anmeldung behält das Kind seiner Anmeldung.
6. **Kein zweiter Vertrag.** Ein importierter Vertrag hat kein Kind einer
   Anmeldung als Schlüssel. Bisher wurde ein Kind mit laufendem importiertem
   Vertrag deshalb Kandidat für einen zweiten Vertrag, sobald es eine
   angenommene Anmeldung mit Buchungen hatte, und die Elternabrechnung
   rechnete beide ab, wenn Name, Geburtsdatum oder Modul abwichen. Jetzt
   gilt: Deckt ein laufender importierter Vertrag der Schule die gebuchte
   Betreuung zeitlich ab, bekommt das Kind der Anmeldung keinen weiteren,
   weder von Hand noch beim Abschluss bei der Annahme. Der Vertrag gehört
   dem Kind, wenn er mit dessen Kinderakte verknüpft ist; solange er mit
   keiner verknüpft ist, gilt der Vergleich aus ADR 0232 Punkt 5 (gleicher Name, keine
   zwei verschiedenen Geburtsdaten). Ein Kind, das nur so gedeckt ist, bleibt
   in der Kandidatenliste sichtbar, zurückgehalten und mit dem genannten
   Vertrag: Das Büro verknüpft ihn, danach entscheidet die Kinderakte. Auch
   der Vertragsimport nimmt die Sperre, bevor er nach laufenden Verträgen
   sieht. Ein importierter Vertrag, der vor Beginn
   der gebuchten Betreuung endet, hindert nichts: Das Kind bekommt seinen
   Vertrag für die nächste Phase wie bisher. Als Ende gilt wie in der
   Abrechnung das frühere von Kündigung und Ende der Version. Wer einen
   Vertrag anlegt, von Hand oder bei der Annahme, nimmt dieselbe Sperre wie
   ein Verknüpfungslauf und entscheidet unter ihr, ob ein importierter
   Vertrag das Kind abdeckt.
7. **Zugriff und Protokoll.** Recht „Verträge verwalten“. Der Lauf liest die
   genannten Kinderakten in der Tenant-Transaktion jeder Schule des Trägers
   (eine Abfrage je Schule; eine Schule antwortet nur mit eigenen Kindern),
   schreibt in der Träger-Transaktion und trägt in das Zugriffsprotokoll
   jeder Schule ein, deren Kinderakten er gezeigt hat (ADR 0084 §7). Die
   Datei wird nie gespeichert.

## Anmeldung und Buchungen

Die Verknüpfung mit der Kinderakte stellt keine Anmeldung und keine Buchungen
her. Die tägliche Betreuung liest genehmigte Buchungen aus Enrollment und
Care Plan, und `AmendFromBookings` folgt nur Verträgen mit
`request_child_id`. Für die Bestandskinder gibt es heute keinen Massenweg:

- `ExistingStudentID` der manuellen Anmeldung setzt `matched_by_office`;
  solche Kinder liest der Vertrag bewusst nicht.
- Eine Phase für bestehende Kinder verschickt mit `send_notification: false`
  nichts, ändert aber Angaben der Eltern und kann einem bestehenden
  Elternkonto Zugang zur Schule geben.
- Bekommt ein importierter Vertrag `request_child_id`, schreibt
  `AmendFromBookings` selbst neue Versionen, sobald die Buchungen vom Vertrag
  abweichen. Dafür müsste `chk_contracts_origin` von „genau ein Ursprung“ auf
  „mindestens ein Ursprung“ gelockert werden.

**Entschieden am 22.11.2026** von Product Owner Yannick Wenger (#7760):

1. Jedes migrierte Kind bekommt nachträglich eine Anmeldung, aus der die
   Buchungen entstehen. Der importierte Vertrag wird an Kinderakte und
   Anmeldung gebunden; `chk_contracts_origin` verlangt dafür mindestens
   einen Ursprung statt genau einen.
2. Nach der Verknüpfung gilt der normale Weg: Eine genehmigte
   Buchungsänderung erzeugt eine neue Vertragsversion. Migrierte Verträge
   verhalten sich danach wie alle anderen.
3. Der Massenlauf bleibt still: kein Versand und keine Einladung als
   Nebenwirkung. Danach löst das Büro bewusst einen getrennten Schritt aus:
   eine Mail an die Eltern und die Einladung ins Elternportal für alle, die
   noch kein Konto haben. Wo der Auslöser sitzt und wie die Mail lautet,
   legt die Umsetzung fest und hält es im PR fest.

Die Umsetzung folgt in einem eigenen PR auf diesem; bis dahin bleibt das
Schema der Ursprünge unverändert.

## Register

Die Entscheidung ändert diese Register (ADR 0057 Punkt 5, ADR 0070):

- **Compose-Budgets** (`backend/test/module_legacy_budget_ratchet_test.go`):
  `modules/carecontract/compose` 181 → 188 (Konstruktor
  `NewContractChildLinks` und der Typ seiner Ports),
  `modules/peopledirectory/compose` 1002 → 1015 (Konstruktor
  `NewStudentRecordIdentities`), Summe 13644 → 13664. Beide Konstruktoren
  bauen nur ihren Owner (ADR 0068).
- **Träger-Transaktion** (`backend/test/traeger_transaction.go`,
  `transaction_boundaries.json`): Der Lauf und `UnlinkChild` öffnen die
  Träger-Transaktion selbst, weil der Lauf davor jede Schule in ihrer
  Tenant-Transaktion liest und danach in deren Zugriffsprotokoll schreibt
  (ADR 0105).
- **Kommando-Effekte und Pass-through**: die Bindung
  `api.careContractSchoolChildren.SchoolChildren` (Lesen, übersetzt) an
  `peopledirectory.StudentRecordIdentities`. Das Zugriffsprotokoll der Schule
  nennt bei der Verknüpfung auch die Kinderakten.
- **Abfragebudget**: `api.traeger.care_contract_child_links`; die Zahl hängt
  an der Zahl der Schulen, nicht an der Zahl der Zeilen.
- **Verlauf**: `chk_contract_events_action` kennt `link_child` und
  `unlink_child` (Migration `20261122130000`).

## Verworfene Optionen

- **Spalte für die Kind-Nummer im Vertragsimport.** Der Import legt an, die
  Verknüpfung berichtigt Bestehendes; für die 313 schon importierten Verträge
  hülfe eine Spalte nicht, und ein zweiter Import legt keinen Vertrag neu an.
- **Über Name und Geburtsdatum verknüpfen.** Widerspricht ADR 0214.
- **`student_id` direkt in der Datenbank setzen.** Ohne Prüfung, Verlauf und
  Zugriffsprotokoll, und nicht wiederholbar.
- **Kandidaten nur über die Kinderakte sperren.** Solange ein importierter
  Vertrag mit keiner Kinderakte verknüpft ist, bliebe die Lücke offen.
