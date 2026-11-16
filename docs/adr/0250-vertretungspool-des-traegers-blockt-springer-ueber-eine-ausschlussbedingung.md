---
status: proposed
---

# Vertretungspool des Trägers blockt Springer über eine Ausschlussbedingung

Vorschlag vom 15.11.2026 für
[#4709](https://github.com/moto-ogs/project-phoenix/issues/4709), Etappe 4
der Spec [#4611](https://github.com/moto-ogs/project-phoenix/issues/4611),
User Story 105. Sie setzt
[ADR 0089](0089-personal-wird-beim-traeger-gefuehrt-und-in-der-schule-eingesetzt.md)
§9 um und verschiebt dort einen Punkt. Sie baut auf der Personalakte aus
[ADR 0233](0233-personalakte-des-traegers-verknuepft-beschaeftigungen-und-uebernimmt-bankdaten.md),
dem Arbeitsvertrag aus
[ADR 0237](0237-arbeitsvertrag-des-traegers-spiegelt-das-soll-in-die-zeiterfassung-der-schule.md),
den Nachweisen aus
[ADR 0238](0238-nachweise-liegen-am-personalstamm-und-die-schule-liest-nur-ihren-stand.md)
und dem Funktionsmuster aus
[ADR 0242](0242-einsatzplanung-des-traegers-prueft-die-schichten-aller-einsatzorte-ueber-eine-datenbankfunktion.md)
auf.

## Kontext

- Ein Springer ist eine Person mit einem Arbeitsvertrag mit dem Merkmal
  „Vertretungspool“. Jede Schule des Trägers darf ihn blocken (ADR 0089 §9).
- Die Rolle der Schule liest keine Tabelle des Trägers. Ein Springer ist an
  der blockenden Schule meist kein Einsatzort; die Funktionen aus ADR 0236
  und 0242 antworten aber nur Einsatzorten.
- Zwei Schulen blocken in zwei Tenant-Transaktionen. Eine Prüfung „frei?“
  vor dem Schreiben ließe beide durch, wenn sie gleichzeitig kommen.

## Entscheidung

1. **Merkmal am Vertrag.** `workforce.staff_contracts.pool` macht die Person
   für die Laufzeit dieses Vertrags zum Springer. Die Personalverwaltung
   setzt es beim Anlegen oder Ändern des Vertrags.
2. **Eine Blockung ist eine Zeile.** `workforce.staff_pool_blocks` hält Tag,
   Beginn, Ende, die blockende Schule als einfache ID und wer blockt oder
   aufhebt. Grund und Gruppe speichert moto nicht. Eine aufgehobene Blockung
   bleibt mit `lifted_at`, damit die Schule sieht, dass die
   Personalverwaltung sie aufgehoben hat.
3. **Keine Doppelbelegung durch die Datenbank.** Eine Ausschlussbedingung
   (`EXCLUDE USING gist`, Akte gleich, Zeitraum überlappend, nur lebende
   Blockungen) verhindert zwei überlappende Blockungen. Kommen zwei Schulen
   gleichzeitig, wartet die zweite auf die erste und bekommt danach die
   Verletzung. moto antwortet mit 409 `workforce.pool_block_taken`. Eine
   Blockung darf beginnen, wenn eine andere endet. Hat der Springer zu der
   Zeit eine Schicht an einem seiner Einsatzorte, lehnt `pool_block` ab
   (409 `workforce.pool_springer_busy`). Geblockt wird Montag bis Freitag
   ab heute.
4. **Die Schule liest über Funktionen ihres Trägers.** SECURITY-DEFINER-
   Funktionen antworten nur der Schule der Tenant-Transaktion und nur, wenn
   ihr Träger „Personal beim Träger“ freigeschaltet hat:
   `pool_springers` (Name, erster und letzter Tag im Pool; ohne diese
   Tage könnte die Schule „Nicht im Pool“ nicht anzeigen),
   `pool_blocks` (Tag, Zeit und blockende Schule; die ID nur für eigene
   Blockungen), `pool_proof_status` (Art, Pflicht, vorhanden, Ablauf) sowie
   `pool_block` und `pool_lift` zum Schreiben. Geburtstag, Personalnummer,
   Vertrag, Soll und Einsatzorte verlassen den Träger nicht.
5. **Recht.** In der Schule das Recht des Dienstplans
   (`time_tracking:manage`), beim Träger das Recht „Personal“. Die
   Träger-Transaktion läuft als `phoenix_tenant`; die Rolle liest die
   Blockungen und darf nur die drei Spalten des Aufhebens ändern. In der
   Tenant-Transaktion sieht sie keine Zeile (RLS über `app.current_org_id`).
6. **Zugriffsprotokoll.** Jede Leseansicht der Schule schreibt einen Eintrag
   `traeger_staff_pool` mit den Akten in ihr Protokoll. Die Ansicht des
   Trägers schreibt einen Eintrag an jedem Einsatzort und an jeder Schule,
   die einen gezeigten Springer je geblockt hat (ADR 0089 §6). Hebt die
   Personalverwaltung eine Blockung auf, steht das im Protokoll der Schule.

## Verschoben

ADR 0089 §9 sagt: „Das erste Blocken legt über den Workflow aus §8
Personensatz und Beschäftigung in der Schule an, mit einer Springer-Rolle mit
minimalen Rechten. Der Zugang gilt nur in den geblockten Zeiten.“ Dieser
Workflow über Identity & Access, People Directory, School Membership und
Workforce kommt mit
[#7173](https://github.com/moto-ogs/project-phoenix/issues/7173): Er
allein hat deutlich mehr als 1.000 Zeilen. Bis dahin reserviert eine
Blockung den Springer; die Schule plant seine Schicht erst, wenn die
Personalverwaltung ihn dort beschäftigt. Der Dialog zum Blocken sagt das.
Das ist ein Übergang, kein Ziel: eine dauerhafte Beschäftigung gibt mehr
Zugang, als §9 vorsieht.

## Verworfen

- **Sperre per Advisory-Lock und Prüfung davor:** Jeder Schreibpfad müsste
  die Sperre kennen. Die Ausschlussbedingung gilt für jeden Schreiber.
- **Lesen über die Projektion `traeger-view`:** Die Schule bräuchte eine
  neue Leseerlaubnis auf Tabellen des Trägers und sähe alle Spalten.
- **Blockung als Schicht in der Schule:** Ohne Beschäftigung gibt es keine
  Schicht; die Prüfung über Schulen bliebe dieselbe.

## Folgen

- Neue Tabelle `workforce.staff_pool_blocks` mit `write_owner` `workforce`;
  sie geht mit ihrer Akte und dem Träger.
- Die Ausnahmeliste der Demo-Löschung wächst um diese Tabelle (+1).
- Wegezeiten bleiben offen. Plant eine Schule eine Schicht an einem
  Einsatzort in eine schon geblockte Zeit, prüft moto das noch nicht; das
  kommt mit #7173, wenn die Blockung eine Beschäftigung ist.
