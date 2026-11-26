---
status: proposed
---

# Verträge ohne Mail-Adresse werden von Hand zu einer Familie

Vorschlag vom 24.11.2026 zu
[#7161](https://github.com/moto-ogs/project-phoenix/issues/7161), Spec
[#4611](https://github.com/moto-ogs/project-phoenix/issues/4611). Er ergänzt
[ADR 0232](0232-bestandsvertraege-kommen-aus-einer-datei-ohne-anmeldung.md)
Punkt 7 (Familie `contract:<Vertrag>`) und
[ADR 0164](0164-ermaessigungen-des-monatsbeitrags-sind-beitragsregeln-des-traegers-mit-nachweis-je-vertrag.md)
Punkt 4 (Familie über die Mail-Adresse). Umfang nach dem Kommentar des Product
Owners vom 18.11.2026 in #7161: nur Zusammenführen und Trennen von Hand, mit
Verlauf, ohne automatischen Vorschlag.

## Kontext

- Der Stammdaten-Export von OGS Connect hat keine Mail-Adressen. Jeder so
  importierte Vertrag ist eine eigene Familie (`contract:<Vertrag>`).
- Ispringen ermäßigt Geschwister mit Vertrag (fester Preis je Modul ab dem 2.
  Kind). Ohne gemeinsame Familie zahlt jedes Kind den Preis des ersten.
- Der Mandatsimport erkennt ein Mandat für zwei Geschwister nur innerhalb
  einer Familie als `same_mandate` (#7078); sonst ist es ein Konflikt.
- Die Elternabrechnung bildet die Familie eines Vertrags an rund 20 Stellen
  aus dem Rechnungsempfänger, den Care Contract liefert
  (`BillingRecipients`). Viele dieser Routen haben ein genaues
  Abfragebudget.
- SJR führt die Debitorennummer je Kind (#7007). Die Nummer steht unter
  Familie und Kind.

## Entscheidung

1. **Die Familie steht am Vertrag.** Wer die Eltern eines Vertrags sind, ist
   Sache des Vertrags (`care-contract`); die Mail-Adresse des
   Vertragspartners bestimmt heute die Familie. Für Verträge ohne
   Mail-Adresse hält das Büro fest, dass ihre Eltern dieselben sind: neue
   Spalte `care_contract.contracts.family_contract_id`, der führende Vertrag
   der Familie. Der führende Vertrag selbst hat keinen Wert, ein Vertrag
   führt nie über eine Kette. Keine neue Tabelle, kein neuer Owner.
2. **Nur von Hand, nur ohne Mail-Adresse.** Das Büro wählt mindestens zwei
   Verträge und den führenden. Jeder ist ein Vertrag des Trägers, kein
   Entwurf, und kein Vertragspartner hat eine Mail-Adresse. Gehört ein
   gewählter Vertrag schon zu einer Familie, kommt die ganze Familie mit.
   moto schlägt nichts vor und führt nichts auf Verdacht zusammen.
3. **Der Schlüssel ist der führende Vertrag.** `parentbilling.ContractFamilyKey`
   bekommt den führenden Vertrag statt des eigenen; die Familie heißt
   `contract:<führender Vertrag>`. Debitorennummer je Zahler, Abweichung,
   Mandat und eigene Kinderzahl der Familie sind die des führenden Vertrags.
   Was unter dem Schlüssel eines geführten Vertrags steht, bleibt
   unverändert stehen und ruht.
4. **Trennen stellt den vorherigen Stand her.** Das Büro löst einen geführten
   Vertrag aus der Familie; er ist wieder `contract:<Vertrag>` und findet
   seine ruhenden Angaben. Kein Schreiben zieht Zeilen um, wie bei der
   Kinderzahl (ADR 0288 Punkt 2). Den führenden Vertrag löst das Büro nicht
   einzeln: Es löst die geführten, bis er allein ist.
5. **Die Elternabrechnung liest die Familie mit dem Empfänger.**
   `carecontract.Party.FamilyContractID` kommt aus derselben Abfrage wie der
   Empfänger; es entsteht keine weitere Abfrage. Jede Stelle, die die
   Familie eines Vertrags aus dessen Empfänger bildet, nimmt
   `CareRecipient.FamilyOf`. Rechnungen, die schon ausgestellt sind,
   behalten ihre Familie; Entwürfe eines Laufs rechnen neu.
6. **Die Nummer des Kindes geht mit dem Kind.** Bei Debitorennummern je Kind
   sucht die Rechnung die Nummer unter der Familie und, ohne Treffer, unter
   dem eigenen Vertrag des Kindes. Die Liste der Familien zeigt sie ebenso.
7. **Mail-Adresse später.** Die Mail-Adresse eines Vertragspartners lässt
   sich heute nicht ändern (ADR 0232, Folgen). Hat ein Vertrag eine, gilt
   sie vor dem führenden Vertrag. Wer das Ändern der Adresse einführt, zieht
   Nummer, Abweichung und Mandat vom Schlüssel des führenden Vertrags auf die
   Adresse um; die Spalte bleibt dann ohne Wirkung und wird geleert.
8. **Zugriff, Stand und Verlauf.** Routen unter `/traeger/contract-families`
   hinter dem Recht „Verträge verwalten“ oder „Abrechnung“, in der
   Träger-Transaktion: Das Büro, das die Verträge importiert, und die
   Abrechnung, die den Geschwisterpreis prüft, brauchen beide den Schritt.
   Jeder Zugriff steht im Verlauf der Verträge: die Liste mit den gezeigten
   Verträgen (`read`, Ansicht `care_contract_families`), jede Änderung je
   Vertrag (`join_family`, `leave_family`) mit führendem und vorherigem
   führendem Vertrag. Zusammenführen und Trennen tragen den gelesenen Stand
   (`expected_version`, ADR 0311) und halten eine Sperre der Familien des
   Trägers bis zum Ende der Transaktion. Die Seite zeigt den Verlauf.
   Die Verträge sind die Kopie des Trägers (ADR 0232 Punkt 6), keine
   Kinderakte einer Schule; wie bei der Kinderzahl (ADR 0288) bleibt es beim
   Verlauf des Trägers. Ein Eintrag in das Zugriffsprotokoll jeder Schule
   bräuchte eine eigene Träger-Transaktion neben der Tenant-Transaktion der
   Schule (ADR 0105), und das Register dieser Transaktionen wächst nicht.

## Register

- **Rückgaberegister** (`modules/organizationtenancy/return_register.json`):
  neue Spalte `care_contract.contracts.family_contract_id`.
- **Verlauf** (`chk_contract_events_action`): Aktionen `join_family`,
  `leave_family`.
- **Fehlercode** `care_contract.family_refused` mit Grund und Vertrag.
- **Analytics** (`backend/analytics/core_actions_traeger.go`): beide
  schreibenden Routen `notCaptured`, wie die übrigen Routen des Trägers.
- **Abfragebudget**: `api.traeger.contract_families`.

## Verworfene Optionen

- **Eigene Tabelle der Elternabrechnung.** Jede Route, die Empfänger liest,
  bräuchte eine Abfrage mehr; viele Budgets sind genau und schrumpfen nur.
  Die Familie hinge außerdem an zwei Owners: Adresse am Vertrag, Ersatz in
  der Abrechnung.
- **Gemeinsame Ersatz-Adresse eintragen.** Eine erfundene Adresse wäre eine
  Adresse, an die moto schreiben würde.
- **Familienvorschlag aus Mandat oder Anschrift.** Entfällt nach dem
  Kommentar vom 18.11.2026; gleiche Anschrift beweist keine Familie.
- **Angaben beim Zusammenführen umziehen.** Trennen könnte den vorherigen
  Stand nicht sicher herstellen, und zwei verschiedene Nummern oder Mandate
  verlangten eine Entscheidung an jeder Stelle.

## Folgen

- Zwei zusammengeführte Geschwister zählen in der Geschwisterregel, im
  Mandatsimport, bei Abweichung und Debitorennummer als eine Familie.
- Ein geführter Vertrag steht in der Liste der Familien nicht mehr allein,
  solange er keine eigenen Rechnungen hat.
- Die Kinderzahl der Familie folgt ohne weitere Arbeit (ADR 0288 Punkt 2):
  Zahlen der geführten Verträge gelten als mitgebracht.
- Das Büro wählt den führenden Vertrag selbst. Die Seite des Vertrags kennt
  keine Nummern und Mandate der Abrechnung; der Dialog sagt deshalb, dass
  Debitorennummer, Zahlungsweg und Mandat vom führenden Vertrag kommen und
  die der anderen ruhen. Wählt das Büro einen Vertrag ohne Mandat, gilt das
  Mandat eines Geschwisterkinds nicht, bis es den Vertrag löst oder neu
  zusammenführt.
- Lösen gibt einem Vertrag seine eigene Familie zurück, nicht eine frühere
  gemeinsame. Wer zwei Familien unter einem neuen führenden Vertrag
  zusammengeführt hat und das zurücknehmen will, löst die Verträge und
  führt neu zusammen; der Verlauf nennt jeden Schritt.
