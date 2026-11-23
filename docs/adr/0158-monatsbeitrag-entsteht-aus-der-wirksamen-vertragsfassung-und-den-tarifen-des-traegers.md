---
status: accepted
---

# Monatsbeitrag entsteht aus der wirksamen Vertragsfassung und den Tarifen des Trägers

**Status: Akzeptiert.** Freigegeben von Yannick Wenger am 07.11.2026.

Entscheidung vom 07.11.2026 zu [#4684](https://github.com/moto-ogs/project-phoenix/issues/4684),
Etappe 2 der Spec [#4611](https://github.com/moto-ogs/project-phoenix/issues/4611),
User Stories 59 und 63. Sie ist ein weiterer Bau-Schnitt des Owners
Elternabrechnung aus
[ADR 0088](0088-betreuungsvertrag-und-elternabrechnung-sind-eigene-owner-beim-traeger.md)
und überträgt den Lauf aus
[ADR 0119](0119-abrechnungslauf-stellt-unveraenderliche-rechnungen-aus-einem-nummernkreis-aus.md)
auf den Monat. Sie liest die Vertragsfassungen aus
[ADR 0153](0153-betreuungsvertrag-entsteht-im-traeger-buero-aus-der-angenommenen-anmeldung.md)
und #4681. Sie führt keinen Owner ein und hält fest, was sie in den Registern
ändert (ADR 0057 Punkt 5, ADR 0070).

## Entscheidung

1. **Preisform E3 A (vorläufig).** Ein Tarif ist der Monatspreis eines
   gebuchten Wochentags eines Moduls (`care_offering`) an einer Schule, gültig
   ab dem 1. eines Monats bis zum nächsten Preis desselben Moduls und
   Wochentags (`parent_billing.care_tariffs`). Der Monatsbeitrag eines Kindes
   ist die Summe der Preise der Wochentage, die seine Vertragsfassung bucht.
   Kein Preis steht im Code; Preise je Schule bilden die Standorte des SJR ab.
   Kommt Utes Preisliste in einer anderen Form (Staffel, Tagespreis), ändert
   sich nur die Berechnung, nicht der Lauf.
2. **Positionen je Modul.** Eine Rechnung hat je gebuchtem Modul eine
   Position mit den gebuchten Wochentagen und ihrem Preis, nie eine Zeile je
   Kalendertag. Früh- und Nachmittagsbetreuung sind zwei Positionen derselben
   Rechnung.
3. **Monatswechsel.** Ob ein Monat mit Vertragsänderung, Eintritt oder
   Austritt anteilig oder voll zählt, ist beim Kunden offen. Die
   Träger-Einstellung `parent_billing.care_month_change` entscheidet:
   `version_on_first` (Standard) rechnet den vollen Monat nach der Fassung am
   1., bei Eintritt im Monat nach der ersten Fassung; `pro_rata` rechnet jede
   Fassung für ihre Kalendertage, kaufmännisch gerundet je Wochentag. Die
   Freigabe hält die angewendete Regel an Lauf und Rechnung fest.
4. **Eine Fassung je Tag.** Der Lauf liest die Fassungen über den Port
   `CareContracts`, den die Root an `carecontract.ContractBilling` bindet.
   Liefert er zwei Fassungen eines Vertrags für einen Tag, rechnet der Lauf
   den Monat nicht ab (409 `parent_billing.care_versions_overlap`).
5. **Lauf.** `parent_billing.care_runs` folgt ADR 0119 Punkte 1, 2 und 6:
   `calculated` ohne gespeicherte Entwürfe, Vorschau bei jedem Lesen,
   höchstens ein Lauf in der Vorschau je Monat. Die Freigabe sperrt die
   Monatsabrechnung des Trägers (Advisory Lock) und den Lauf (`FOR UPDATE`),
   rechnet neu, prüft Zahl und Summe und vergibt lückenlose Nummern aus dem
   eigenen Nummernkreis der Leistung `care`. Ein Vertrag hat je Monat
   höchstens eine Rechnung (`uq_care_invoices_contract_month`); ein späterer
   Lauf desselben Monats rechnet nur, was frühere ausgelassen haben. Der Lauf
   darf im Leistungsmonat laufen und rechnet nach Vertrag, nicht nach
   Anwesenheit.
6. **Unveränderlich.** Rechnung und Positionen halten eine eigene Kopie von
   Kind, Schule, Empfänger und jedem Preis; derselbe Trigger wie ADR 0119
   Punkt 7 lehnt jede Änderung ab. Ein Preis, mit dem eine Rechnung einen
   Wochentag eines Moduls abgerechnet hat, ändert sich für diesen Monat nie
   (409 `parent_billing.care_tariff_month_billed`); ein fehlender Preis lässt
   sich auch für einen abgerechneten Monat ergänzen, damit der nächste Lauf
   des Monats das ausgelassene Kind abrechnet. Preispflege und Freigabe
   halten dieselbe Sperre.
7. **Schulen.** Die Preisliste nennt die Schulen des Trägers über den Port
   `CareSchools`, den die Root an Organisation & Tenancy bindet. Ein Preis für
   eine Schule eines anderen Trägers wird abgelehnt (400
   `parent_billing.care_tariff_invalid`).
8. **Empfänger.** Die Rechnung geht an die erste Vertragspartei mit
   E-Mail-Adresse, sonst an die erste. Abweichende Zahler und Bündelung
   kommen mit #4689.
9. **Zugriffsprotokoll und Recht.** Routen unter `/traeger/care-tariffs` und
   `/traeger/care-billing-runs` verlangen das Träger-Recht „Abrechnung“ und
   laufen in der Träger-Transaktion. Jedes Lesen eines Laufs schreibt
   `parent_billing.care_run_events` mit Konto und den gezeigten Verträgen.
10. **Betragsregeln.** Ein gebuchter Wochentag eines Moduls zählt je Kind
   und Monat höchstens einmal. Buchen zwei aktive Verträge desselben Kindes
   (Schülerakte; fehlt sie bei einem, Name und Geburtsdatum) dasselbe Modul
   an einem Tag, den der Lauf für beide abrechnet, rechnet er keinen von
   beiden ab und zeigt sie als „Doppelter Vertrag – bitte prüfen“. Ein
   Duplikat hält die Abrechnung des Trägers nicht auf: Die Freigabe stellt
   die Rechnungen der übrigen Kinder aus und nennt die Zahl der Kinder mit
   Duplikat; der freigegebene Lauf zeigt sie unter „Nicht abgerechnet –
   Doppelter Vertrag“. Ist das Duplikat behoben, rechnet ein späterer Lauf
   des Monats das Kind ab, wie ein Kind, dem ein Preis fehlte. Ein Modul, das über alle Fassungen des Monats
   gleich bleibt, ist eine Position zum vollen Monatspreis; geteilte
   Positionen ergeben zusammen den Betrag des Moduls auf den Cent (größter
   Rest). Die Demo-Löschung (ADR 0062) entfernt Monatsrechnungen und die
   Lesungen der Laufspur stillgelegter Demo-Schulen; die Nummernlücke nimmt
   sie wie ADR 0119 hin.
11. **Abgrenzung.** Prüfphase mit Standortwahl, Rechnungsdatum, Ausschluss
   und Prüfexport (#5916), Senden und Druck der Schreiben, Empfänger und
   Zahlungsweg (#4689) sowie Ermäßigungen und Geschwister (#4685) bauen auf
   diesen Rechnungen auf und sind nicht Teil dieser Entscheidung.

## Nachtrag 2026-11-07: Abrechnungseinheit Kind-Monat

Präzisiert in Punkt 3 den Eintritt unter `version_on_first` (je Kind, nicht
je Vertrag) und ersetzt in Punkt 10 die Regeln zum doppelten Vertrag. Die Duplikatlogik ist eine reine
Funktion (`childMonthHolds`); die Anzeige eines freigegebenen Laufs eine
zweite (`heldView`).

- **E1 Einheit.** Abgerechnet wird je Kind und Monat. Ein Kind ist ein
  Schülerdatensatz. Ohne Schülerdatensatz gilt das Paar aus normalisiertem
  Namen (klein, Leerzeichen zusammengefasst) und Geburtsdatum; ein Vertrag
  ohne Datensatz gehört zu dem Kind mit Datensatz, dessen Verträge dasselbe
  Paar tragen, wenn es genau eines gibt.
- **E2 Abrechnungstage.** Für jeden Vertrag des Kindes steht zuerst fest,
  welche Kalendertage des Monats er nach `care_month_change` abrechnet.
  Unter „voller Monat“ rechnet den ganzen Monat der Vertrag ab, der am 1.
  gilt, mit den Modulen seiner Fassung am 1. Gilt am 1. kein Vertrag des
  Kindes, rechnet der erste Vertrag, der im Monat beginnt, den ganzen Monat
  ab, mit den Modulen seiner ersten Fassung (Eintritt; bei gleichem
  Beginn der zuerst gelesene). Jeder weitere Vertrag, der später im Monat
  beginnt, rechnet in diesem Monat nichts ab. Unter „anteilig“ rechnet jeder
  Vertrag nur seine eigenen Tage ab.
- **E3 Duplikat.** Ein Duplikat liegt genau dann vor, wenn zwei Verträge
  desselben Kindes nach E2 am selben Kalendertag dasselbe Modul am selben
  Wochentag abrechnen. Laufzeit-Überlappung ohne doppelt abgerechneten Tag
  ist kein Duplikat.
- **E4 Ganzes Kind.** Hat ein Kind im Monat ein Duplikat, hält der Lauf das
  ganze Kind für diesen Monat zurück, mit allen seinen Verträgen. Die
  Freigabe stellt die Rechnungen der übrigen Kinder aus und speichert die
  zurückgehaltenen Kinder als Momentaufnahme (`parent_billing.care_run_holds`:
  Name, Verträge mit Schule, doppelt abgerechnete Module und Wochentage,
  Grund).
- **E5 Momentaufnahme.** Ein freigegebener Lauf zeigt ausschließlich die bei
  der Freigabe gespeicherten Daten: seine ausgestellten Rechnungen und die
  Momentaufnahme aus `care_run_holds`. Er liest keinen Vertrag neu; ein
  später widerrufener, ersetzter oder umbenannter Vertrag ändert die Anzeige
  nicht, und später entstandene Verträge erscheinen erst in einem neuen Lauf.
  Die Momentaufnahme hat RLS, ist unveränderlich und geht mit der
  Demo-Löschung (1.15.805). Ein
  späterer Lauf des Monats rechnet ein zurückgehaltenes Kind ab, sobald es
  kein Duplikat mehr hat.
- **E6 Tabellentest.** `TestCareMonthChildMonthTable` rechnet jede
  Kombination aus Einstellung (voll, anteilig) und Vertragsfolge (15./16.,
  1./1., Überlappung an einem Wochentag, verschiedene Module, drei Verträge
  mit einem Duplikat, Eintritt am 16., Eintritt am 10. mit zweitem Vertrag
  am 20., zwei Schulen) gegen einen von Hand gerechneten Betrag
  oder die Zurückhaltung; die Rechnung steht je Zeile als Kommentar. Je eine
  Mutation von E2 bis E5 macht ihn rot, ebenso das Entfernen der Ausnahme
  „kein Vertrag am 1.“ (Zeile „Eintritt am 16.“).

## Verworfene Optionen

- **Monatsrechnungen in `parent_billing.documents`:** Die Tabelle und ihre
  Lesepfade (Schreiben, Postfach, Storno, Familien) hängen an Ferienanmeldung
  und -zeitraum. Eigene Tabellen halten die Ferienpfade unverändert; die
  Zusammenführung für Versand und Storno entscheidet #5916 oder #4689.
- **Tagespreis mal Betreuungstage (E3 C):** schwankt je Monat und braucht die
  Anwesenheit; der SJR rechnet nach Vertrag.
- **Monatswechsel fest im Code:** Die Kundenentscheidung fehlt; eine
  Einstellung ändert die Regel ohne Codeänderung.

## Register

- `policy.json`: fünf `data_objects` mit `write_owner` `parent-billing`; keine
  neue Regel, kein neues Paket.
- `command-effects`: geprüfte Abfragen der Fassungen und Empfänger
  (Betreuungsvertrag), der Schulen des Trägers (Organisation & Tenancy) und
  der Monatsregel (Settings).
- `passthrough`: `CareBilling.ListCareRuns` und die Root-Übersetzungen
  `parentBillingSettings.CareMonthRule`,
  `parentBillingCareContracts.Recipients` und
  `parentBillingCareSchools.TraegerSchools`.
- Budgets: `modules/parentbilling/compose` 50 → 55 Zeilen
  (`moduleComposeBudgetTotal` 12946 → 12951) und `modules/parentbilling`
  6 → 7 Durchreichungen (`modulePassthroughOwnerBudgetTotal` 1409 → 1410).
- Query-Budgets `api.traeger.care_billing_runs` (2, exact) und
  `api.traeger.care_tariffs` (6, exact).
- Datenlebenszyklus und Aufbewahrung: je fünf Einträge.
- Migrationen `1.15.789` (Tabellen) und `1.15.805` (`platform.erase_closed_demo_visitors`, auf der Fassung von 1.15.797).

## Nachtrag 2026-11-08: Schreiben, Versand und Storno (#4684)

Punkt 11 nannte „Senden und Druck der Schreiben“ als offen. Die Monatsrechnungen
bekommen Schreiben, Versand, Postfach, Sammeldruck, Storno und Neuausstellung
über die Strecke der Ferienrechnungen in eigenen Tabellen:
[ADR 0165](0165-monatsrechnungen-nehmen-schreiben-versand-und-storno-der-ferienrechnungen.md).
Punkt 5 („ein Vertrag hat je Monat höchstens eine Rechnung“) gilt seitdem für
die erste Rechnung; eine stornierte Rechnung ersetzt höchstens eine neue.

## Nachtrag 2026-11-08: Schulen je Lauf (#5916)

Punkt 5 („höchstens ein Lauf in der Vorschau je Monat“) gilt seitdem je Schule:
Ein Lauf nennt seine Schulen, und eine Schule ist je Monat in höchstens einem
offenen Lauf. Die Freigabe stellt das Rechnungsdatum des Laufs aus. Details im
[Nachtrag zu ADR 0119](0119-abrechnungslauf-stellt-unveraenderliche-rechnungen-aus-einem-nummernkreis-aus.md#nachtrag-2026-11-08-prüfphase-im-monatslauf-5916).

## Nachtrag 2026-11-08: Preisformen der Preisliste (#6196)

**Status: Vorgeschlagen.**

1. **Zwei Preisformen, eine Preisliste.** Ein Modul einer Schule hat ab einem
   Monatsersten entweder einen Preis **je Wochentag** (Summe der gebuchten
   Wochentage, Ispringen) oder eine **Staffel nach Tagen je Woche** (Preis
   für 1 bis 7 gebuchte Tage, Birkenfeld; nicht Tagespreis mal Tage). Die
   Form gilt je Modul und folgt dem jüngsten Preis des Moduls, der bis zum
   Monat begonnen hat; Preise der anderen Form zählen dann nicht. Ein
   Preiswechsel, auch der Wechsel der Form, wirkt ab seinem Gültigkeitsdatum.
2. **Staffelposition.** Eine Position nach Staffel kostet die Stufe ihrer
   Zahl gebuchter Wochentage. Anteilig (pro rata) gilt Betragsregel 2 mit der
   Stufe als Monatspreis; die Stufe wird auf die Wochentage zu gleichen
   Teilen verteilt (größter Rest), damit Teile auf den Cent aufgehen. Die
   ausgestellte Position hält Stufe und Stufenpreis fest
   (`days_per_week`, `tier_monthly_cents`). Fehlt die Stufe, bleibt der
   Vertrag unter „Ohne Preis“ mit der fehlenden Stufe, nie mit 0 €.
3. **Abgerechnete Preise** (ADR 0119 Punkt 7): Eine abgerechnete Stufe oder
   ein abgerechneter Wochentag behält im Monat Preis, Geschwisterpreis und
   Form; ein abgerechneter Monat wird nie beitragsfrei.
4. **Beitragsfreie Monate** sind eine Einstellung der Preisliste je Schule
   (`care_price_lists.free_months`, z. B. August in Ispringen). Der Lauf
   stellt dafür keine Rechnung aus und zeigt die Zahl der Verträge.
5. **Essen.** Ein Modul kann „Essen extra“ tragen (`meal_extra`); der Preis
   enthält das Essen dann nicht. Das Essen rechnet die Mensa ab (#6169),
   nie als stillschweigende 0 €. Der Essenspreis Birkenfeld wartet auf Ute.
6. Prüfphase (#6177): Stufe, Form und die Zahl beitragsfreier Verträge
   gehören zum Fingerabdruck; eine Änderung danach lässt die Freigabe
   ablehnen.

Register: Migration `1.15.819`; `policy/parent-billing.json` mit
`parent_billing.care_price_lists`; Datenlebenszyklus und Aufbewahrung je ein
Eintrag (keine Personendaten).

## Nachtrag 2026-11-22: Schulwechsel mit zwei Schülerdatensätzen (#7874)

Ergänzt E1. Entschieden von Product Owner Yannick Wenger (#7874).

**Kontext.** Ein Schülerdatensatz (die Kinderakte) gehört zu genau einer
Schule: Person, Schülerprofil und Datensatz tragen die `tenant_id` der
Schule, und ein Vertrag zeigt auf den Datensatz seiner eigenen Schule
(ADR 0307 Punkt 1). Eine schulübergreifende Kennung des Kindes gibt es
nicht. Wechselt ein Kind mitten im Monat an eine andere Schule des Trägers
und hat dort einen eigenen Datensatz, sah E1 zwei Kinder: Bei „voller Monat“
war der Vertrag an der neuen Schule ein Eintritt (E2) und bekam eine eigene
Rechnung, und die Geschwisterregel zählte das Kind zweimal, wenn beide Schulen
zählen.

**Entscheidung.** Nach E1 legt moto Kinder an verschiedenen Schulen zu einem
Kind zusammen, wenn alle Bedingungen gelten:

1. Die Verträge nennen dieselbe Familie (`ContractFamilyKey`: die
   Mail-Adresse des Rechnungsempfängers). Eine Familie, die moto nur über
   ihren Vertrag kennt, legt nichts zusammen.
2. Vorname, Nachname und Geburtsdatum stimmen überein. Namen vergleicht moto
   zusammengesetzt (NFC), mit ausgeschriebenen Umlauten und ohne Akzente
   (`textnorm.ASCII`), ohne Groß- und Kleinschreibung und mit
   zusammengefassten Leerzeichen: „Müller“, „Mueller“ und ein zerlegt
   eingefügtes „Müller“ sind derselbe Name. Ohne Geburtsdatum legt moto
   nichts zusammen.
3. Jedes der Kinder hat an seiner Schule einen Datensatz, und die Kinder
   liegen an verschiedenen Schulen. Innerhalb einer Schule entscheidet weiter
   der Datensatz: Zwei Datensätze dort sind zwei Kinder. Verträge ohne
   Datensatz gruppiert weiter E1 allein.
4. Die Verträge laufen nacheinander: An keinem Tag laufen Verträge zweier
   dieser Kinder zugleich. Zwillinge gleichen Namens an zwei Schulen haben
   gleichzeitig laufende Verträge und bleiben zwei Kinder.
5. Alles oder nichts: Alle Kinder mit diesem Namen und Geburtsdatum, gleich
   aus welcher Familie, erfüllen die Punkte 1 bis 4 untereinander, sonst legt
   moto keines davon zusammen. Ein Kind gleichen Namens ohne Geburtsdatum
   verhindert das Zusammenlegen ebenfalls, ebenso ein Kind, dessen Verträge
   verschiedene Namen, Geburtsdaten oder Familien tragen. Das Ergebnis hängt
   nicht von der Reihenfolge ab, und eine unklare Lage rechnet wie vor
   diesem Nachtrag.

Das zusammengelegte Kind ist für E2 bis E4 und die Geschwisterregel ein
Kind: Bei „voller Monat“ rechnet der Vertrag, der am 1. gilt, den Monat ab,
der Vertrag an der neuen Schule nichts; er zählt das Kind an seiner Schule
(ADR 0305, Nachtrag #7863). Unter „anteilig“ rechnet jeder Vertrag seine
Tage ab. Ist der Monat an der alten Schule beitragsfrei (#6196), zahlt das
Kind im Monat des Wechsels bei „voller Monat“ nichts, wie beim Wechsel mit
einem Datensatz. Die beiden Gruppierungen aus E1 bleiben, wie sie vor diesem Nachtrag waren:
die laufenden Verträge für E2 bis E4 und die Prüfung, die laufenden Verträge
zusammen mit denen, die nur eine ausgestellte Rechnung des Monats in die Kette
bringen (#7863), für die Geschwisterregel, mit denselben Schlüsseln. Moto legt
ein Kind nur zusammen, wenn jeder Teil auch in der zweiten Gruppierung ein
Kind für sich ist (kein ausgestellter Vertrag verbindet ihn mit einem anderen
laufenden Vertrag) und jede für ihn schon ausgestellte Rechnung die Familie
des Wechsels festhält; dann ändert sich in beiden dasselbe, und kein Eintrag
einer anderen Familie ändert seinen Schlüssel. Punkt 5 zählt die Kinder mit laufendem Vertrag;
Verträge, die nur eine ausgestellte Rechnung in den Monat bringen, verhindern
das Zusammenlegen nur, wenn sie einen Teil in der Gruppierung der Kette mit
einem anderen Vertrag verbinden oder ihn teilen. Seit dem Nachtrag „Schon
abgerechnet je Kind“ (#7892) ist ein solcher Vertrag selbst Teil eines
Schulwechsels; Punkt 5 gilt dann auch für ihn.

Das zusammengelegte Kind behält den Schlüssel des Teils, für den schon eine
Rechnung des Monats ausgestellt ist, sonst den seines ersten Teils; haben
mehrere Teile schon eine, legt moto nicht zusammen (#7892). Hat die Familie
ein weiteres Kind mit demselben Geburtsdatum (einen Zwilling), so wie die
Kette sie rangiert (mit dem Geburtsdatum, das sie einem Kind ohne eines
gibt, und der Familie, unter der eine ausgestellte Rechnung zählt), oder
nennen die Teile des Kindes verschiedene Geburtsdaten, legt moto ebenfalls
nicht zusammen: Die Kette entscheidet Gleichstand bei Preis und
Geburtsdatum nach dem Schlüssel, und nur ein Zwilling könnte mit dem Kind
gleichstehen. So entscheidet der Schlüssel keinen Gleichstand neu, auch nicht
gegenüber Rechnungen, die ein Lauf des Monats schon ausgestellt hat. Gewollt
ändert sich nur, was aus dem einen Kind folgt: Es zählt einmal, mit der Summe
der Beiträge seiner Teile als Basis. Dadurch kann eine Obergrenze je Familie
oder eine Rangregel die Ermäßigung einem anderen Kind der Familie zuordnen;
die Summe der Familie folgt der Regel für ein Kind. Ein Bescheid-Lauf entscheidet in beiden Rechnungen eines
Monats gleich, mit den Familien aller ausgestellten Bescheide und Rechnungen.
Dieselbe Gruppierung zählt die Kinder einer Familie in der
Kinderzahl-Übersicht.

**Sichtbar.** Hier entscheidet der Name, nicht eine Kinderakte. Die Prüfung
eines berechneten Monatslaufs und die Vorschau eines Bescheid-Laufs (ADR 0182,
gleiche Monatsrechnung) zeigen jedes so zusammengelegte Kind unter „Ein Kind
an zwei Schulen“ mit seinen Verträgen und Schulen in der Reihenfolge ihres
Beginns (`joined_children` an `CareRunDetail` und `CareNoticeRunDetail`), für
jeden Lauf mit einer dieser Schulen. Beide Fingerabdrücke enthalten die
Liste, wenn sie nicht leer ist; eine Änderung macht die Freigabe ungültig wie
jede andere. Ein freigegebener Lauf zeigt die Liste nicht (E5 speichert sie
nicht): Dort stehen nur seine Rechnungen.

**Risiko.** Ein falsches Zusammenlegen bedeutet eine Rechnung zu wenig.
Dafür müssten zwei Kinder einer Familie denselben Vor- und Nachnamen und
dasselbe Geburtsdatum haben und ihre Verträge an verschiedenen Schulen
nacheinander laufen. Die Prüfung nennt jeden solchen Fall vor der Freigabe.

**Verworfen.**

- **Verknüpfung über eine gemeinsame Kinderakte.** Es gibt keine
  schulübergreifende Akte; jede Schule führt ihre eigene. Die Regel „verschiedene
  Akten sind verschiedene Kinder“ ließe genau diesen Fall offen.
- **Zusammenlegen auch bei gleichzeitig laufenden Verträgen.** Fängt einen
  vergessenen alten Vertrag ab, legt aber Zwillinge gleichen Namens an zwei
  Schulen zusammen.
- **Eine vom Büro bestätigte Verknüpfung zweier Datensätze.** Ohne Risiko,
  braucht aber Tabelle, Maske und Protokoll; bis zur Bestätigung bliebe die
  zusätzliche Rechnung. Ein eigenes Issue, wenn der Namensvergleich nicht
  reicht.

## Nachtrag 2026-11-23: Schon abgerechnet je Kind (#7892)

Ergänzt E1 bis E5 und den Nachtrag „Schulwechsel“. Entschieden von Product
Owner Yannick Wenger (#7892).

**Kontext.** Der Lauf prüfte „schon abgerechnet“ je Vertrag: Ein Vertrag mit
ausgestellter Rechnung des Monats blieb draußen, jeder andere Vertrag desselben
Kindes wurde abgerechnet, als gäbe es die Rechnung nicht. Drei Fälle:

1. **Zwei Rechnungen über zwei Läufe.** Bei „voller Monat“ ist der Vertrag an
   der neuen Schule schon als Eintritt ausgestellt (60,00 €), bevor der Vertrag
   der alten Schule in moto steht. Der gilt am 1. und wurde im nächsten Lauf
   für den ganzen Monat abgerechnet (45,00 €).
2. **Eine Rechnung nur mit Mensa sperrt die Betreuung.** Ein Vertrag ohne
   Betreuungstage im Monat bekommt bei gebündelter Mensa eine Rechnung nur mit
   Mensa. Wird er später zum Eintritt des Kindes, bleibt seine Betreuung
   unabgerechnet: Ein Vertrag hat je Monat eine Rechnung
   (`uq_care_invoices_contract_month`). Nichts wies darauf hin.
3. **Widerrufener Vertrag mit Rechnung.** Der Vertrag der alten Schule hat eine
   Rechnung des Monats und wird danach widerrufen. Nur die Rechnung bringt ihn
   noch in den Monat. Der Vertrag der neuen Schule war Eintritt und wurde auch
   für den ganzen Monat abgerechnet; mit zwei Kinderakten zählte die
   Geschwisterregel das Kind zweimal.

**Entscheidung.** Rechnet eine ausgestellte, nicht stornierte Rechnung oder ein
Monat eines Jahresbescheids den Monat eines Kindes schon ab, stellt der Lauf
für dieses Kind keine weitere Rechnung aus. Er hält das Kind zurück, und die
Prüfung nennt es mit seinen Verträgen und der vorhandenen Rechnung (Nummer,
Schule, Vertrag, Lauf). Ist die Rechnung falsch, storniert das Büro sie; der
nächste Lauf des Monats rechnet das Kind dann ab. Die Rechnung nur mit Mensa
aus Fall 2 wird genauso genannt.

Die Einzelheiten (`billedChildHolds`, eine reine Funktion):

- **S1 Dasselbe Kind.** Es gilt die Gruppierung der Geschwisterregel: E1 über
  die laufenden und die ausgestellten Verträge (#7863) mit dem Schulwechsel
  aus #7874. Neu ist ein Vertrag, den nur seine ausgestellte Rechnung in den
  Monat bringt (widerrufen oder vor dem Monat beendet), selbst Teil eines
  Schulwechsels: Für ihn stehen Kind, Familie und Schule seiner Rechnung, und
  er läuft an keinem Tag des Monats. Die Punkte 1 bis 5 des Nachtrags
  „Schulwechsel“ gelten unverändert, auch Punkt 5: Ein solcher Namensvetter
  einer anderen Familie oder an derselben Schule verhindert das
  Zusammenlegen. Das Kind behält den Schlüssel seiner ausgestellten Rechnung.
  Die Karte „Ein Kind an zwei Schulen“ nennt auch diesen Vertrag, vor den
  laufenden. Haben schon mehrere Teile eine Rechnung, legt moto weiter nicht
  zusammen.
- **S2 Veraltete Rechnung.** Eine ausgestellte Rechnung behält, was sie
  abgerechnet hat. Sie ist an den Tagen veraltet, die ihre
  Betreuungspositionen abrechnen (ihr Zeitraum; ohne Zeitraum der ganze Monat),
  an denen ihr Vertrag nach E2 heute nichts abrechnet: Der Vertrag ist
  widerrufen oder gekürzt, oder ein anderer Vertrag des Kindes gilt jetzt am
  1. oder ist sein Eintritt.
- **S3 Zurückhalten.** Ein Kind wird zurückgehalten, wenn ein Vertrag des
  Kindes ohne Rechnung einen Tag abrechnen würde, an dem eine Rechnung eines
  anderen seiner Verträge veraltet ist. Bei „voller Monat“ rechnet jede
  Rechnung den ganzen Monat ab: Eine veraltete Rechnung hält das Kind. Zwei
  Verträge, die beide am 1. gelten (verschiedene Module), sind nicht veraltet;
  der zweite wird abgerechnet, wie bisher. Bei „anteilig“ rechnet jeder
  Vertrag seine Tage ab: Eine Rechnung für den 15. bis 31. hält den Vertrag
  für den 1. bis 14. nicht. Hat sie den ganzen Monat abgerechnet und beginnt
  ihr Vertrag heute erst am 15., sind der 1. bis 14. schon abgerechnet, und
  das Kind wird zurückgehalten. Ein Vertrag in einem beitragsfreien Monat
  (#6196) rechnet nichts ab und löst nichts aus.
- **S4 Ganzes Kind.** Wie E4 hält der Lauf alle Verträge des Kindes ohne
  Rechnung zurück, auch ihre Mensa. Ein Kind mit doppeltem Vertrag (E3) bleibt
  unter „Doppelter Vertrag“.
- **S5 Rechnung nur mit Mensa.** Trägt die Monatsrechnung eines laufenden
  Vertrags keine Betreuungsposition und würde der Vertrag heute Betreuung
  abrechnen (Preis vorhanden, kein beitragsfreier Monat), nennt die Prüfung
  das Kind mit dieser Rechnung (`meal_only_invoice`). Nach dem Storno rechnet
  der nächste Lauf Betreuung und Mensa zusammen ab.
- **S6 Jahresbescheid.** Ein Monat eines Jahresbescheids, der Betreuung
  festsetzt, hält wie eine Rechnung; die Prüfung nennt den Bescheid. Ein
  Monat, den ein Änderungsbescheid auf nichts gesetzt hat (ADR 0182), rechnet
  nichts ab und hält keinen anderen Vertrag; für den eigenen Vertrag bleibt
  es bei „Durch aufgehobenen Bescheid gesperrt“. Der häufige Fall ist der
  Schulwechsel im Jahr: Der Bescheid der alten Schule setzt die Monate nach
  dem Wechsel weiter fest, bis ein Jahreslauf dieser Schule ihn ändert.
- **S7 Geschwisterregel.** Ein zurückgehaltenes Kind zählt einmal: über seine
  ausgestellte Rechnung und als Ort seiner zurückgehaltenen Verträge
  (ADR 0305, Nachtrag #7863). Seine Basis ist die ausgestellte Rechnung. Für
  die anderen Kinder ändert sich nur, was daraus folgt.
- **S8 Sichtbar.** `billed_children` an `CareRunDetail` und
  `CareNoticeRunDetail`, Karte „Kind hat schon eine Rechnung – bitte prüfen“
  für jeden Lauf mit einer Schule der zurückgehaltenen Verträge, auch im
  leeren Lauf, und eine Zeile je Kind in der Prüfliste. Beide Fingerabdrücke
  enthalten die Liste, wenn sie nicht leer ist. Das Leseprotokoll nennt die
  Verträge der Karte und den Vertrag der Rechnung.
- **S9 Momentaufnahme.** Die Freigabe speichert diese Kinder in
  `care_run_holds` (Gründe `already_billed` und `meal_only_invoice`, neue
  Spalte `invoices`), und der freigegebene Lauf zeigt sie von dort (E5).
- **S10 Leerer Lauf.** Ein Lauf, der nur solche Kinder zurückhält, lässt sich
  verwerfen: Die vorhandene Rechnung kann stimmen, dann ist nichts offen. Ein
  doppelter Vertrag verhindert das Verwerfen weiter.
- **S11 Bescheid-Lauf.** Er rechnet jeden Monat mit derselben Funktion. Ein
  zurückgehaltener Vertrag behält für den Monat seine bisherige Festsetzung,
  wie bei einem doppelten Vertrag; ohne bisherigen Bescheid bleibt der Monat
  offen. Die Vorschau zeigt dieselbe Karte.

**Grenzen.** Ein Vertrag außerhalb des Monats ohne Kinderakte und ohne
Geburtsdatum hat keine Identität (#7863) und hält kein Kind. Haben beide
Verträge eines Schulwechsels schon eine Rechnung (ausgestellt vor diesem
Nachtrag), legt moto sie nicht zusammen und nennt nichts. Wechselt ein Zwilling
die Schule, legt moto nicht zusammen (#7874) und hält darum auch nicht.
Rechnet eine Rechnung ein Modul ab, das ihr Vertrag nicht mehr bucht, während
er an den Tagen ein anderes Modul abrechnet, gilt sie nicht als veraltet.

**Verworfen.**

- **Nur ein Hinweis, der Lauf rechnet trotzdem ab.** Die zweite Rechnung
  entstünde weiter und müsste storniert werden.
- **Die Rechnung nur mit Mensa nicht als Rechnung des Vertrags zählen.** Dann
  bräuchte der Vertrag eine zweite Rechnung im Monat; Storno, Schreiben und
  der Nummernkreis gehen von einer aus (ADR 0165).
- **Jede Rechnung eines anderen Vertrags hält das Kind.** Das sperrte ein
  Kind mit zwei Verträgen für verschiedene Module, von denen einer später
  einen Preis bekommt, und bei „anteilig“ jeden Wechsel im Monat.

**Register.** Kein neuer Owner, kein neuer Port, keine neue Route. Migration
`20261123091500` erweitert `parent_billing.care_run_holds`;
`return_register.json` und der Text im `data_lifecycle_catalog.json` folgen
ihr. `InvoicedContracts` liest zusätzlich Nummer, Schule, Lauf und Zeitraum
der Positionen, in derselben Anweisung.
