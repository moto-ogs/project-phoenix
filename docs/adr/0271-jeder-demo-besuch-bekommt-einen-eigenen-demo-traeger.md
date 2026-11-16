---
status: proposed
---

# Jeder Demo-Besuch bekommt einen eigenen Demo-Träger

Vorschlag vom 16.11.2026 für
[#6193](https://github.com/moto-ogs/project-phoenix/issues/6193). Er nimmt die
Trägerapp in die öffentliche Demo auf
([ADR 0029](0029-public-demo-runs-as-its-own-environment.md)) und ändert dafür
[ADR 0233](0233-personalakte-des-traegers-verknuepft-beschaeftigungen-und-uebernimmt-bankdaten.md)
Punkt 9 und den Abschnitt „Was bleibt“ von
[ADR 0189](0189-demo-betrieb-loescht-ausgemusterte-demo-schulen-nach-90-tagen-aus-der-datenbank.md).

## Kontext

- Jede Demo-Schule eines Besuchers hing bisher am selben Demo-Träger
  `demo-traeger-nord`. Kein Besucher erreichte dessen Träger-Büro (ADR 0233
  Punkt 9): Es hätte die Schulen, Verträge und Namen aller anderen Besucher
  gezeigt.
- Die Träger-Schritte des Seeds wirken auf jede Schule des Trägers. Mit jeder
  weiteren Besucherschule wuchs ihre Arbeit, und Freigaben des Trägers
  erreichten fremde Besucherschulen (#6385).
- Die Standschule hat seit #6962 einen eigenen Träger, `demo-traeger-messe`.
- Vertrieb und Interessenten sollen die Trägerapp an echten Demo-Daten sehen:
  mehrere Schulen, Belegung, Verträge, Abrechnung, Personal.

## Entscheidung

1. **Ein Träger je Bestellung.** Der Demo-Betrieb seedet jede Demo-Schule
   unter einem eigenen Träger `traeger-<slug der Bestellung>`. Alle Versuche
   einer Bestellung nutzen denselben Träger. Zwei Nachbarschulen kommen hinzu,
   mit zwei Gruppen und zwölf Kindern je Schule; die Träger-Schritte laufen
   danach über alle drei. Die Standschule bekommt dieselben Nachbarschulen
   beim nächsten frischen Seed.
2. **Die Bestellung kennt ihren Träger.** `platform.demo_school_states.traeger_id`
   nennt den Träger, sobald der Seed ihn angelegt hat; die Nachbarschulen
   stehen in `visitor_school_ids`. Ein Trigger trägt den Träger in
   `platform.demo_traeger_origins` ein, wie die Schulen in
   `platform.demo_school_origins` (ADR 0148). Nur dieser Eintrag beweist einen
   Demo-Träger.
3. **Demo-Rolle Träger-Büro.** Die Demo-Rolle `traeger` meldet das Konto des
   Besuchers im Träger-Portal des eigenen Trägers an, mit allen Rollen des
   Büros und dem Namen des Besuchers an der Mitgliedschaft. Der Demo-Link gilt
   als Nachweis des Postfachs (`proofDemoLink`), wie bei den anderen
   Demo-Rollen; die Mitgliedschaft prüft der Sitzungsaufbau wie bei jeder
   Träger-Anmeldung. Eine Schule unter dem gemeinsamen Demo-Träger bietet die
   Rolle nicht an (`identity.demo_access_invalid`). Der Rollenwechsel und der
   Absprung in die Schulen laufen über die vorhandenen Wege.
4. **Der Besucher bleibt ohne Personalakte.** Der Seed verknüpft die
   Personalakten des eigenen Trägers, lässt aber jeden Vorschlag aus, der die
   Beschäftigung des Besuchers nennt. Die Gastfamilie der Ferienanmeldung
   bekommt eine Adresse im Demo-Bereich der Schule, damit kein Konto zwei
   Besucher-Träger verbindet.
5. **Stilllegen nimmt den Träger mit.** `platform.retire_expired_demo_schools`,
   der Neustart und der endgültige Fehlschlag blenden jede Schule des eigenen
   Trägers aus. Vorher beendet `auth.revoke_organization_sessions` die
   Sitzungen des Träger-Portals, der Absprünge und aller Schulen, in der
   Sperrreihenfolge einer Anmeldung (Konten, dann Schulen). Stilllegen und
   Neustart setzen den Träger außerdem außer Dienst (`active = false`): Jede
   Träger-Sitzung verlangt beim Ausstellen und bei jeder Prüfung einen
   aktiven Träger, also entsteht auch keine, die eine gleichzeitige Einlösung
   ausstellen wollte. Nach dem endgültigen Fehlschlag einer Bestellung tut
   `platform.retire_failed_demo_traeger` dasselbe: Ein aufgeschobener Seed
   kann scheitern, nachdem Besucher die Schule schon betreten haben.
6. **Die Besuchslöschung nimmt das Büro des Besuchers mit**
   (`platform.erase_demo_visitor_traeger_member`): Sitzungen und gemerkte
   Geräte am Träger, Rollen, Mitgliedschaft mit Namen und die Einträge im
   Kontenprotokoll des Büros, die der Besucher machte oder die ihn nennen. Erst
   danach prüft sie, ob das Konto anderswo gebraucht wird.
7. **Der Träger geht mit seiner letzten Schule.** Sind alle Schulen eines
   Demo-Trägers nach ADR 0189 aus der Datenbank gelöscht und nennt keine
   Bestellung ihn mehr, löscht `platform.erase_retired_demo_traeger` ihn im
   selben Lauf. Sie ist das Gegenstück zu `platform.erase_organization`
   (Kaskade von `platform.organizations`), ohne Operator-Auftrag und
   Schonfrist, nur für `phoenix_demo` ausführbar, mit Zeit und Zeilenzahlen am
   Herkunftsnachweis. Ein Fehler rollt den Träger zurück und meldet nur den
   SQLSTATE.

## Folgen

- ADR 0233 Punkt 9 gilt für den gemeinsamen Demo-Träger weiter. Ein eigener
  Träger hat den Besucher im Büro, aber keine Akte, die ihn nennt.
- ADR 0189 „Was bleibt“: Beim eigenen Träger bleibt nichts mehr, Vorlagen,
  Tarife und Freigaben gehen mit dem Träger. Freitext, den der Besucher im
  Träger-Büro eingibt, bleibt wie Freitext in der Schule bis zu dieser
  Löschung.
- Ein Nachweis zu einem Monatsbeitrag verweist mit `RESTRICT` auf seine
  Beitragsregel. Erreichen die Kaskaden der Träger-Wurzel die Regel vor dem
  Vertrag, der den Nachweis mitnähme, bricht die Löschung ab. Die
  Demo-Löschung löscht die Nachweise deshalb vor der Wurzel; ein Demo-Träger
  führt keine Bücher (ADR 0184 gilt nicht), und der Beleg-Wächter nennt sie.
  Die Operator-Löschung (`platform.erase_organization`) hat dasselbe Problem;
  wie sie mit den Belegen umgeht, klärt #7248.
- Die Schullöschung löscht `users.rfid_cards` nach `users.persons`: Die Karte
  einer Person (`tenant_id, tag_id`, `ON DELETE SET NULL`) hätte sonst die
  Schule der Person geleert und jede Löschung einer Schule mit Karten
  abgebrochen, auch jede Demo-Schule nach 90 Tagen.
- Ein Seed einer Bestellung dauert länger: zwei kleine Schulen mehr und die
  Personalakten. Die Träger-Schritte verschiedener Besucher warten nicht mehr
  aufeinander.
- Das Träger-Portal sammelt auch in der Demo keine Nutzungsanalyse; die
  Entscheidung aus #4649 bleibt unverändert.

## Verworfene Optionen

- **Gemeinsamer Demo-Träger mit Träger-Rolle.** Jeder Besucher sähe die
  Schulen und Namen der anderen.
- **Ein synthetisches Konto als Träger-Büro.** Ein Konto ohne Namen des
  Besuchers, also keine Änderung an ADR 0233 nötig. Verworfen: Der Besucher
  sähe sich im Träger-Portal als fremde Person, und der Rollenwechsel bräuchte
  ein zweites Konto je Besuch.
- **Ein Träger ohne Nachbarschulen.** Billiger im Seed, aber Standortvergleich,
  Auslastung und Belegung zeigten nur eine Schule; die Demo zeigte gerade das
  nicht, wofür ein Träger die App braucht.
