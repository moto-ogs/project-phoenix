---
status: proposed
---

# Erstes Blocken legt die Beschäftigung des Springers an, und der Zugang gilt nur in Zeitfenstern

Vorschlag vom 15.11.2026 für
[#7173](https://github.com/moto-ogs/project-phoenix/issues/7173), Etappe 4
der Spec [#4611](https://github.com/moto-ogs/project-phoenix/issues/4611).
Sie setzt den Punkt aus
[ADR 0089](0089-personal-wird-beim-traeger-gefuehrt-und-in-der-schule-eingesetzt.md)
§9 um, den
[ADR 0250](0250-vertretungspool-des-traegers-blockt-springer-ueber-eine-ausschlussbedingung.md)
verschoben hat:

> Das erste Blocken legt über den Workflow aus §8 Personensatz und
> Beschäftigung in der Schule an, mit einer Springer-Rolle mit minimalen
> Rechten. Der Zugang gilt nur in den geblockten Zeiten.

## Kontext

- Mit ADR 0250 reserviert eine Blockung die Person, mehr nicht. Die
  Personalverwaltung trägt die blockende Schule danach von Hand als
  Einsatzort ein. Erst dann kann die Schule den Springer im Dienstplan
  planen, und erst dann kann er sich dort anmelden und stempeln.
- Eine Beschäftigung an einer Schule ist eine Kette aus drei Ownern:
  Personensatz (People Directory), Beschäftigung (School Membership) und
  Konto mit Zuordnung zur Schule und Rolle (Identity & Access). Identity &
  Access legt die Kette heute schon an: beim Einlösen einer Einladung, bei
  der Rollenzuweisung und beim Zugang durch das moto-Team
  (`EnsureSchoolIdentityChain`, #2222).
- Der Springer hat ein Konto. Es hängt an der Person einer seiner
  Beschäftigungen, die die Personalakte verknüpft (ADR 0233).
- Eine Schule erteilt Zugang heute nur unbefristet. Jede Anfrage prüft die
  Sitzung schon einmal gegen ihre Refresh-Familie (#5194).

## Entscheidung

1. **Workforce stößt an, Identity & Access legt an.** `BlockSpringer`
   ruft nach der Blockung in derselben Tenant-Transaktion den Port
   `SpringerEmployments`. Die Wurzel bindet ihn an die Fähigkeit
   `identityaccess.SpringerAccess`. Sie legt in dieser Reihenfolge an,
   jeweils nur, was fehlt:
   - die Zuordnung des Kontos zur Schule;
   - die Systemrolle `springer`;
   - Personensatz und Beschäftigung über `EnsureSchoolIdentityChain`, mit
     Wiederaufnahme einer früheren Beschäftigung (ADR 0021);
   - das Zeitfenster der Blockung, an der Zuordnung
     (`auth.account_tenants.access_windows`, je Blockung ein Eintrag).

   Danach verknüpft `workforce.pool_link` die Beschäftigung als Einsatzort
   mit der Akte (`staff_record_links.via_pool`). Damit planen Einsatzplanung
   und Dienstplan den Springer an der blockenden Schule (ADR 0242 Punkt 5).
2. **Idempotent über zwei Sperren.** `workforce.pool_springer_identity`
   sperrt die Personalakte bis zum Ende der Transaktion und liest erst
   danach Konto, Namen und die Beschäftigung an der Schule. Identity &
   Access sperrt danach das Konto, wie jede Rollenzuweisung. Zwei
   gleichzeitige Blockungen desselben Springers warten so aufeinander. Die
   zweite findet die Beschäftigung der ersten und legt nur ihr Zeitfenster
   an.
3. **Ein Einsatzort bleibt ein Einsatzort.** Ist die Schule schon ein
   Einsatzort der Akte, den die Personalverwaltung verknüpft hat, legt das
   Blocken nichts an. Hat das Konto an der Schule schon eine andere Rolle,
   bleibt sein Zugang unbefristet (Punkt 6).
4. **Die Systemrolle `springer` hat ein Recht: `time_tracking:own`.** Der
   Springer sieht seinen Dienstplan und stempelt. Mehr gibt ihm die Schule
   bei Bedarf über eine weitere Rolle. Basisrolle ist `user`, damit die
   Person ein Betreuungsprofil hat und planbar ist (wie `ag-leitung`,
   Migration 1.15.478).
5. **Ein Zeitfenster ist die Blockung mit 30 Minuten Rand.** Es beginnt 30
   Minuten vor und endet 30 Minuten nach der Blockung, in Berliner Zeit. So
   stempelt der Springer am Rand der Blockung ein und aus. Hebt eine Schule
   oder die Personalverwaltung die Blockung auf, löscht Workforce das
   Fenster in der Tenant-Transaktion der Schule.
6. **Geprüft wird beim Anmelden und bei jeder Anfrage, ohne Abfrage mehr.**
   `auth.account_tenant_admitted(account, school)` ist falsch nur, wenn das
   Konto an der Schule die Systemrolle `springer` hat, sonst höchstens
   `guardian`, und kein Fenster offen ist. Die Rollen entscheiden, nicht der
   Weg zur Zuordnung: Gibt eine Einladung, das moto-Team oder die Leitung
   dem Konto eine weitere Rolle, gilt der Zugang unbefristet. Eine
   Elternrolle gibt keinen Zugang zum Personalportal und zählt nicht.
   - Die Anmeldung und der Schulwechsel wählen nur zugelassene Schulen.
     Ausstellen und Erneuern einer Sitzung lesen die Zuordnung mit der
     Prüfung.
   - Die Prüfung der Refresh-Familie je Anfrage liest das Ergebnis in
     derselben Abfrage. Ist das Fenster zu, gilt eine Sitzung im Personal-
     oder Schulportal als beendet. Eine Elternsitzung und ein Absprung über
     den Träger bleiben: Sie beruhen nicht auf der Rolle an der Schule.
   - Der Schulwechsel einer Träger-Sitzung behandelt eine Schule ohne
     Zulassung wie eine ohne Zuordnung. Ein Mitglied des Trägers, das dort
     Springer ist, kommt außerhalb der Fenster über den Träger hinein.
   - Der Austritt und andere Wege, die die Schulen eines Kontos zählen,
     sehen weiter jede aktive Zuordnung. Sonst hielte der Austritt an der
     Heimatschule einen Springer außerhalb seines Fensters für
     schullos und sperrte sein Konto.
7. **Audit wie ADR 0089 §6.** Jede Ansicht und jede Blockung steht schon
   im Zugriffsprotokoll der Schule (ADR 0250). Die neue Verknüpfung steht
   zusätzlich im Verlauf der Akte (`staff_record_changes`, Art `linked`,
   mit der Schule und dem Konto der Leitung).
8. **Ohne Konto keine Beschäftigung.** Hat keine Beschäftigung der Akte
   ein Konto, bleibt es bei der Reservierung wie in ADR 0250. Die
   Personalverwaltung lädt die Person dann ein.

   Die Fenster liegen an der Zuordnung, nicht in einer eigenen Tabelle. So
   gehen sie mit der Löschung der Schule und den Zuordnungen des Kontos,
   ohne neuen Löschweg. Ein neues Fenster räumt abgelaufene Fenster weg.

## Verschoben

- **Die frühere Beschäftigung nach der letzten Blockung** (ADR 0089 §8).
  Nach der letzten Blockung bleibt die Beschäftigung bestehen, aber ohne
  offenes Fenster kommt der Springer nicht an die Schule. Der Übergang in
  eine frühere Beschäftigung braucht den Austritt aus
  `workflows/staffoffboarding` und einen täglichen Lauf, der vergangene
  Blockungen findet. Das ist ein eigener Workflow; er folgt in
  [#7197](https://github.com/moto-ogs/project-phoenix/issues/7197). Die nächste Blockung nimmt eine schon frühere
  Beschäftigung wieder auf (Punkt 1).

## Verworfene Optionen

- **Prüfung über die Rolle im Token.** Eine Rolle `springer` im Token
  sagt nichts über das Fenster, und das Token lebt über das Fensterende
  hinaus. Die Prüfung liest die Rollen deshalb in der Abfrage je Anfrage.
- **Eine Marke „nur in Zeitfenstern“ an der Zuordnung.** Jeder Weg, der
  unbefristeten Zugang gibt, müsste die Marke löschen, und ein Konto, das
  schon zugeordnet war, etwa als Elternteil, bekäme sie nie. Die Rollen
  zeigen beides ohne zweite Quelle.
- **Fenster aus den Blockungen von Workforce lesen.** Identity & Access
  läse dann eine Tabelle von Workforce. Die Prüfung gehört dem Owner, der
  den Zugang erteilt (ADR 0067).
- **Zuordnung nur in den Fenstern aktiv schalten.** Das bräuchte einen
  Lauf zu jedem Fensterbeginn und -ende, und der Austritt sähe die Schule
  in der Hälfte der Zeit nicht.

## Folgen

- Die Prüfung je Anfrage liest zusätzlich die Rollen des Kontos an der
  Schule, über den vorhandenen Index, in derselben Abfrage. Es kommt keine
  Abfrage hinzu.
- Die Funktionen umgehen RLS gezielt, wie in ADR 0242. Ihre Prüfung ist
  Teil der Migration und durch API-Tests mit zwei Schulen abgedeckt.
- Hebt die Personalverwaltung eine Blockung auf, schließt das Fenster in
  einer eigenen Transaktion der Schule nach der Aufhebung (ADR 0105).
  Scheitert sie, meldet die Anfrage den Fehler; das Fenster endet dann
  spätestens zu seiner Zeit.
- Läuft ein Fenster während der Arbeit ab, endet die Sitzung an dieser
  Schule. Der Springer meldet sich neu an und landet an einer anderen
  Schule seiner Akte.
