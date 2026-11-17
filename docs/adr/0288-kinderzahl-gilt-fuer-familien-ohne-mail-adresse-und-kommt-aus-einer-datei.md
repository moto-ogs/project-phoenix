---
status: proposed
---

# Kinderzahl gilt für Familien ohne Mail-Adresse und kommt aus einer Datei

Vorschlag vom 17.11.2026 zu [#7356](https://github.com/moto-ogs/project-phoenix/issues/7356),
Spec [#4611](https://github.com/moto-ogs/project-phoenix/issues/4611). Er ergänzt
[ADR 0088](0088-betreuungsvertrag-und-elternabrechnung-sind-eigene-owner-beim-traeger.md)
§4 (Nachtrag 08.11.2026, Kinderzahl der Familie, #5918) und
[ADR 0232](0232-bestandsvertraege-kommen-aus-einer-datei-ohne-anmeldung.md)
Punkt 7 (Familie `contract:<Vertrag>`).

## Kontext

- Birkenfeld zählt Geschwister über „Anzahl der Kinder in der Familie unter
  18 Jahren“. Ob die Geschwister betreut werden, spielt keine Rolle: Im
  Oktober 2026 sind 153 von 193 Rechnungen zum Geschwisterpreis gestellt, nur
  34 dieser Kinder haben ein betreutes Geschwisterkind (Rückmeldung SJR vom
  17.11.2026).
- Die Kinderzahl der Familie gibt es seit #5918. Sie hing an der Mail-Adresse
  des Rechnungsempfängers; ein Vertrag ohne Adresse bekam
  `parent_billing.family_without_address`. Alle importierten SJR-Verträge
  haben keine Mail-Adresse (ADR 0232 Punkt 7).
- Der Stammdaten-Export von OGS Connect enthält das Feld nicht. Wie SJR es
  liefert, ist offen (Frage über Conrad). Deshalb gibt es beide Wege: eine
  Spalte im Vertragsimport und eine eigene Datei für schon importierte
  Verträge.

## Entscheidung

1. **Familie ohne Mail-Adresse hat eine Kinderzahl.** Schlüssel ist
   `parentbilling.ContractFamilyKey`: die Mail-Adresse, sonst
   `contract:<Vertrag>`. Lesen, Bestätigen, Ändern, Entfernen, Gültigkeit,
   Hinweis bei Ablauf und Verlauf sind dieselben wie in #5918. Es gibt keine
   neue Tabelle und keine Migration: `family_child_counts.family_email` trägt
   den Schlüssel schon. `parent_billing.family_without_address` bleibt
   registriert, wird aber nicht mehr gesendet.
2. **Die Zahl geht mit der Familie.** Eine Zahl steht unter dem Schlüssel, den
   die Familie beim Bestätigen hatte. Bekommt der Vertrag später eine
   Mail-Adresse, allein oder mit anderen Verträgen (#7161), gilt:
   Eine unter der Adresse bestätigte Zahl ist die Zahl der Familie. Sonst
   zählt, was ihre Verträge mitbringen, wenn alle dasselbe sagen. Bringen sie
   verschiedene Zahlen mit, zählt keine: Die Liste zeigt „Verschiedene
   Angaben“ (`differing`; verglichen werden die Zahlen, nicht ihre Tage), das
   Büro bestätigt eine Zahl für die Familie, und
   die steht dann unter dem Schlüssel der Familie. Die Zuordnung geschieht
   beim Lesen (`numbersByFamily`), im Monatslauf wie in der Liste; kein
   Schreiben in Care Contract zieht Zeilen um.
3. **Prüfphase nennt die Verträge.** Zählt eine Geschwisterregel die
   Familienangabe, nennt die Vorschau eines Monatslaufs je Rechnung ohne
   bestätigte Zahl Kind, Schule und Grund: `missing` oder `expired`
   (`uncounted_contracts`). Familien ohne Mail-Adresse zählen dabei mit; die
   frühere Ausnahme für `contract:`-Familien entfällt. Regeln ohne
   Familienangabe (Ispringen) rechnen unverändert.
4. **Spalte im Vertragsimport.** Optionales Feld „Kinder in der Familie“
   (`family_children`). Die Zahl gilt als von der Abrechnung bestätigt, ab dem
   ersten Vertragstag in moto, ohne Ende. Deshalb braucht die Spalte zusätzlich
   das Recht „Abrechnung“: Ohne das Recht schlägt moto sie nicht vor, und eine
   Zuordnung, die sie nennt, bekommt 403. Ein Wert, der keine ganze Zahl von 1
   bis 20 ist, macht die Zeile ungültig; moto übernimmt sie nicht. Care
   Contract hat dafür den Port `ContractFamilyChildren`; die Root bindet ihn an
   `parentbilling.ContractImportFamilyChildren` (Blatt-Kommando nach ADR 0067,
   Teilnahme an der Träger-Transaktion des Imports, wie die Debitorennummer).
5. **Nachtragen per Datei.** `parentbilling.FamilyChildrenImports`, Routen
   `POST /traeger/family-children/imports/preview` und
   `POST /traeger/family-children/imports` hinter dem Recht „Abrechnung“. Die
   Datei nennt Kind (Vorname, Nachname, optional Geburtsdatum), Schule (Spalte
   oder Auswahl) und die Zahl. moto sucht den Vertrag des Kindes unter den
   Verträgen der Kinderzahl-Seite (wirksam von drei Monaten zurück bis neun
   voraus), wie der Vertragsimport Kinder vergleicht: gleiche Schule und
   Namen, zwei verschiedene Geburtsdaten trennen. Vorschau und Bestätigung mit
   Fingerabdruck wie beim Mandatsimport, mit eigenen Fehlercodes
   `parent_billing.family_children_import_*`. Die Zahl gilt ab dem ersten Tag
   des Vertrags, frühestens ab Beginn dieses Fensters. Die Datei wird nie
   gespeichert.
6. **Dieselben Regeln für beide Wege** (`decideImportedChildren`): Eine
   bestätigte Zahl, die noch gilt, wird nie überschrieben (`differs`),
   dieselbe Zahl ist `same`, Zeilen einer Familie mit verschiedenen Zahlen
   übernehmen keine (`rows_differ`). Eine abgelaufene Bestätigung erneuert die
   Datei ab dem Tag nach ihrem Ende; die Monate davor behalten ihre Zahl. Der
   Import hält die Sperre der Monatsabrechnung, bevor er die Zahlen liest;
   übernommene Zahlen und ihr Verlaufseintrag entstehen in einem Statement.
7. **Datenminimierung.** Gespeichert wird nur die Zahl, kein Name und kein
   Geburtsdatum eines Geschwisterkinds ohne Vertrag. Vorschau und Antwort
   nennen keine Mail-Adresse.

## Register

Die Entscheidung ändert diese Register (ADR 0057 Punkt 5, ADR 0070):

- **Compose-Budget** (`backend/test/module_legacy_budget_ratchet_test.go`):
  `modules/parentbilling/compose` 136 → 141 (Konstruktor
  `NewFamilyChildrenImports`), Summe 13645 → 13650. Der Konstruktor baut nur
  seinen Owner (ADR 0068). Ein eigener Konstruktor statt einer breiteren
  Fassade: `parentbilling.CareReductions` hat 12 Methoden, die Grenze der
  Fassaden-Ratchet (ADR 0178).
- **Kommando-Effekte** (`backend/architecture/command-effects/`): die Bindung
  `roots/owners.CareContractFamilyNumbers.DecideImportedFamilyChildren`,
  Blatt-Kommando nach ADR 0067.

## Verworfene Optionen

- **Zahl beim Zusammenführen umschreiben.** Jede Stelle, die den Schlüssel
  einer Familie ändert, müsste die Zeilen umziehen und bei verschiedenen
  Zahlen eine Entscheidung erzwingen. Die Zuordnung beim Lesen braucht keinen
  Schreibpfad und gilt für #7161 ohne weitere Arbeit.
- **Nachtragen im Vertragsimport.** Der Vertragsimport verlangt Modul und
  ersten Vertragstag und sitzt hinter „Verträge verwalten“. Die Kinderzahl
  kommt bei SJR aus einer anderen Quelle und gehört der Abrechnung.
- **Datei überschreibt bestätigte Zahlen.** Eine neue Bestätigung ersetzt
  ältere ab ihrem Beginn; ein Import mit Beginn am ersten Vertragstag würde
  die Vergangenheit einer von Hand gepflegten Zahl ändern. Abweichungen zeigt
  die Vorschau, das Büro ändert sie in der Liste.
- **Daten der Geschwister speichern.** Für den Geschwisterpreis genügt die
  Zahl (ADR 0088 §4).
- **Fehlercodes des Mandatsimports wiederverwenden.** Die Texte passen
  wörtlich, aber der Code ist die Identität (ADR 0006): Eine veraltete
  Vorschau der Kinderzahl stünde in Protokoll und Auswertung als Fehler des
  Mandatsimports.

## Folgen

- Der Januarlauf 2027 rechnet Birkenfelder Kinder mit bestätigter Zahl zum
  Geschwisterpreis, ohne zweites Kind mit Vertrag.
- Familien ohne Mail-Adresse erscheinen in der Kinderzahl-Liste, je Vertrag
  eine, benannt als „Vertrag Nr. …“. Bis #7161 bleiben Geschwister ohne
  Adresse getrennte Familien mit je eigener Zahl.
- Die Rolle „Verwaltung“ kann die Spalte im Vertragsimport nicht nutzen; sie
  braucht zusätzlich die Rolle „Abrechnung“, oder die Abrechnung trägt per
  Datei nach.
- Der Vertragsimport vergleicht eine Zahl nur mit dem eigenen Schlüssel der
  Familie (Adresse oder Vertrag), nicht mit Zahlen, die ein anderer Vertrag
  mitbringt: Er kennt keine Empfänger fremder Verträge. Das wird erst
  erreichbar, wenn eine Adresse nachgetragen werden kann (#7161).
- Entfernt das Büro die eigene Zahl einer Familie, deren Vertrag noch eine
  mitgebrachte Zahl trägt, zeigt die Liste diese; ein zweites Entfernen nimmt
  auch sie weg.
- Offen: das Dateiformat von SJR. Die Zuordnung der Spalten deckt beliebige
  Überschriften ab; die Überschrift von OGS Connect erkennt moto selbst.
