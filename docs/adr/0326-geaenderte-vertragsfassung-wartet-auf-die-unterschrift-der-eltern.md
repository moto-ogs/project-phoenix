---
status: proposed
---

# Eine geänderte Vertragsfassung wartet auf die Unterschrift der Eltern, außer sie haben die Änderung selbst beantragt

Vorschlag vom 26.11.2026 zu
[#4816](https://github.com/moto-ogs/project-phoenix/issues/4816), Spec
[#4611](https://github.com/moto-ogs/project-phoenix/issues/4611). Er baut auf
[ADR 0088](0088-betreuungsvertrag-und-elternabrechnung-sind-eigene-owner-beim-traeger.md)
§2, §3 und §7 und auf
[ADR 0155](0155-eltern-unterschreiben-den-betreuungsvertrag-ueber-den-signatur-baustein-beim-traeger.md)
auf und schließt die Lücke, die
[PR #5953](https://github.com/moto-ogs/project-phoenix/pull/5953) (#4681)
offen ließ. Die zwei Grundsätze stehen im Ticket fest: Ändern Träger oder
Schule den Vertrag, unterschreiben die Vertragsparteien neu. Beantragen die
Eltern die Änderung selbst, gilt ihr Antrag als Unterschrift. Dieses ADR
entscheidet, wie moto beides erkennt und umsetzt.

## Kontext

- Care Plan bleibt führend für das, was gebucht ist (ADR 0088 §6). Der
  Vertrag folgt den Buchungen im Abgleich `AmendFromBookings`, bisher sofort
  und ohne Zustimmung.
- Eine Buchungszeile trägt keine Herkunft. Care Plan hält aber die
  Elternanfragen (`enrollment.offering_change_requests`) mit Konto, Zeitpunkt,
  Wirkdatum und gewünschten Angeboten.
- Auch die Schule und das Träger-Büro ändern Buchungen direkt: Korrektur der
  Anmeldung, Angebotswechsel wegen dauerhafter Gehzeiten, Entscheidung bei
  einem Konflikt.
- Ein versendeter, noch nicht unterschriebener Vertrag folgte den Buchungen
  gar nicht. Eltern konnten eine überholte Fassung unterschreiben.

## Entscheidung

1. **Ein Zustand, kein neues Objekt.** Eine geänderte Fassung, der noch
   niemand zugestimmt hat, ist eine Vertragsversion im Status `beantragt`.
   Sie gilt an keinem Tag. Die Zeitleiste (`wirksam`, `abgelöst`) und damit
   die Elternabrechnung sehen sie nicht. Je Vertrag wartet höchstens eine
   Version (partieller Unique-Index).
2. **Der eigene Antrag der Eltern ist die Unterschrift.** Der Abgleich
   prüft für jeden Tag, an dem sich die Buchungen ändern:
   - Es gibt eine freigegebene Elternanfrage mit diesem Wirkdatum.
   - Das Konto, das sie abgeschickt hat, gehört einer Vertragspartei
     (ADR 0088 §7): Es ist ihr Elternkonto. Kennt der Vertrag keines, weil
     die Anmeldung ohne Konto kam, zählt wie im Postfach die Adresse des
     Kontos.
   - Die Buchungen dieses Tages setzen genau die Anfrage um: Jedes
     Betreuungsangebot, dessen Buchung an dem Tag beginnt oder endet, und
     jedes, das die Anfrage nennt, ist ab dann mit den gewünschten
     Wochentagen gebucht oder gar nicht mehr. Eine Anfrage, die eine spätere
     Freigabe überstimmt hat, belegt so nichts.
   - Geprüft werden nur Tage, an denen sich eine Buchung nach dem Beginn der
     geltenden Version ändert. Eine überfällige Änderung gilt ab heute und
     steht mit älteren Tagen zusammen; die trägt die geltende Version schon.

   - Die Anfrage hat noch keine Version dieses Vertrags unterschrieben. Eine
     Anfrage unterschreibt einmal: Bucht die Schule dieselbe Betreuung später
     noch einmal, nachdem die Eltern etwas anderem zugestimmt haben, wartet
     die neue Version.

   Trifft alles zu, wird die Version sofort `wirksam`. `contract_signatures`
   bekommt einen Eintrag mit dem Verfahren `request`, dem Konto, dem
   Zeitpunkt des Antrags, der Nummer der Anfrage und den Prüfsummen der
   Version und ihres PDFs (ADR 0088 §3). Eine gezeichnete Unterschrift gibt es
   nicht.
3. **Alles andere wartet.** Hat die Schule oder der Träger gebucht, hat die
   Freigabe etwas anderes gebucht als beantragt, oder hat ein anderer
   Elternteil als die Vertragspartei gefragt, entsteht die Version als
   `beantragt`. moto friert ihr PDF ein und schickt es mit einem einmaligen
   Link per Mail und ins Postfach der Eltern-App. Die bisherige Version gilt
   weiter. Im Zweifel fragt moto nach einer Unterschrift, nie umgekehrt.
4. **Unterschrift über denselben Baustein.** Link, Eltern-App und
   Papiervertrag unterschreiben die wartende Version wie einen ersten Vertrag
   (ADR 0155), mit Widerrufsbelehrung. Eine geänderte Fassung wird nur mit
   der Prüfsumme des PDFs unterschrieben, das die Seite gezeigt hat, und der
   Papiervertrag nennt seine Version: Hat inzwischen eine neuere Fassung die
   gelesene überholt, lehnt moto ab. Die Unterschrift stellt die Version in
   die Zeitleiste, mit den Schritten von #4681: Sie löst die wirksame Version
   ab, geht vor eine geplante oder ersetzt die Version, die am selben Tag
   beginnt.
5. **Späte Unterschrift.** Liegt das Wirkdatum schon zurück, gilt die
   Version ab dem Tag der Unterschrift: Keine Version reicht in die
   Vergangenheit, und bis dahin galt die alte. `agreed_from` hält das Datum
   fest, das im unterschriebenen PDF steht. Die Prüfsumme der Version zählt
   dieses Datum, damit der Nachweis intakt bleibt. Die Request-Rolle darf
   beide Daten nur in diesem einen Schritt schreiben (`guard_version_dates`).
6. **Eine Änderung nach der anderen.** Solange eine Version wartet, plant
   der Abgleich dieselbe erste Änderung erneut. Trägt der Plan dieselbe
   Betreuung, bleibt die wartende Version. Trägt er eine andere, wird sie
   `ueberholt` und eine neue wartet, mit neuem PDF und neuem Link. Auch
   eine Version, die die Eltern inzwischen selbst beantragt haben, überholt
   die wartende in derselben Transaktion. Nimmt die
   Schule die Änderung zurück, endet das Warten. `ueberholt` ist ein neuer
   Status: Die Version bleibt lesbar, galt nie und wird nie unterschrieben.
7. **Versendete Verträge folgen auch.** Bucht das Kind vor der ersten
   Unterschrift etwas anderes, überholt eine neue Fassung die versendete. Der
   alte Link und das alte PDF schließen nichts mehr ab. Diese Fassung ist die
   erste, der die Eltern zustimmen. Sie darf deshalb wie Version 1 ein Datum
   in der Vergangenheit nennen; der Trigger aus 1.15.787 fragt dafür nicht
   mehr nach der Versionsnummer, sondern danach, ob der Vertrag schon eine
   Version in Kraft hatte.
8. **Erinnerungen je Version.** `contract_reminders` nennt die Version. Eine
   wartende Änderung wird wie ein erster Vertrag erinnert, mit eigener
   Zählung bis zur selben Grenze.
9. **Zustellung der neuen Fassung.** Jede neue Version aus einer
   Buchungsänderung bekommt ihr eingefrorenes PDF und geht auf dem Weg an die
   Eltern, auf dem der Vertrag bisher ging. Ging er nie per Mail (Papier,
   Import) oder nimmt die Adresse keine Mail an, bleibt es beim PDF, und das
   Träger-Büro übergibt es. Eine vorige Mail, die noch unterwegs ist, hält
   die neue Fassung nicht auf: Der alte Link soll nie der einzige bleiben.
   Fehlt der Briefkopf oder antwortet der Mail-Dienst nicht, hält der Lauf
   die Änderung mit Grund zurück und versucht es beim nächsten Mal.
10. **Lesen in Care Plan.** `care-contract` bekommt den Port
    `SchoolParentRequests`. Die Root bindet ihn an eine neue Lesefähigkeit von
    Care Plan (`ContractOfferingChanges`), in der Tenant-Transaktion der
    Schule wie die Buchungen. `care-contract` schreibt weiter nie in Care
    Plan.

## Verworfene Optionen

- **Herkunft an der Buchungszeile speichern:** ändert die meistgelesene
  Tabelle von Care Plan und alle ihre Schreibwege. Die Anfrage selbst belegt
  mehr, nämlich Konto und Zeitpunkt.
- **Änderungen der Schule sofort wirksam, Unterschrift nachträglich:** Die
  Abrechnung liefe auf einer Fassung, der niemand zugestimmt hat.
- **Mehrere wartende Versionen je Vertrag:** Eltern müssten in fester
  Reihenfolge unterschreiben, und jede Unterschrift änderte die Grundlage der
  nächsten.
- **Wirkdatum in der Vergangenheit bei später Unterschrift:** griffe in
  Monate ein, die schon abgerechnet sein können.

## Folgen

- Buchungen und Vertrag gehen auseinander, solange eine Änderung wartet. Das
  Träger-Büro sieht das in der Liste und am Vertrag und kann den
  Papiervertrag erfassen.
- Die Freigabe darf das Datum einer Elternanfrage verschieben (#2484). Die
  Anfrage speichert danach nur das angewandte Datum. Sie gilt trotzdem als
  Unterschrift: Die Eltern haben die Änderung beantragt, nicht den Tag.
- Offen für die Rechtsprüfung der Spec: Die Widerrufsbelehrung beim
  Unterschreiben einer Änderung ist dieselbe wie beim ersten Vertrag. Ein
  Widerruf nur der Änderung hat in moto noch keinen eigenen Weg; die Eltern
  erklären ihn beim Träger.
- Zählt der Antrag der Eltern als Unterschrift, sehen sie dabei keine
  Widerrufsbelehrung. Auch das gehört in die Rechtsprüfung.
- Der Abgleich läuft alle fünf Minuten. Unterschreiben Eltern in diesem
  Fenster eine Fassung, deren Buchungen sich gerade geändert haben, schließt
  der Vertrag auf dieser Fassung. Der nächste Lauf legt die Änderung dann als
  Version an, die auf die Unterschrift wartet oder vom Antrag getragen ist.
  Der Vertrag bleibt also nicht auf der alten Fassung stehen; die Abrechnung
  folgt ihr aber, bis die neue gilt. Dasselbe gilt für einen versendeten
  Vertrag, dessen Kind gar keine Betreuung mehr bucht: Das ist ein Ende der
  Betreuung, keine neue Fassung, und läuft über Kündigung oder Rücknahme.
- Das Postfach der Eltern-App bietet die Unterschrift dem Konto an, an dessen
  Adresse der Vertrag ging und das für das Kind handeln darf, wie beim ersten
  Vertrag (ADR 0155). Leitet das Träger-Büro den Versand an einen anderen
  Elternteil um, kann dieser unterschreiben. Das ist die Entscheidung des
  Büros.
- Die Down-Migration ist ein Werkzeug für die Entwicklung. Nach dem ersten
  Einsatz in Produktion löscht sie Nachweise (Unterschriften per Antrag,
  `agreed_from`) von Versionen, die weiter gelten. Ein Rollback in Produktion
  geht nur vorwärts.
