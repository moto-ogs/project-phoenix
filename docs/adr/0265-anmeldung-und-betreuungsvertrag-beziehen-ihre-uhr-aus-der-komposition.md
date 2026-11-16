---
status: accepted
---

# Anmeldung und Betreuungsvertrag beziehen ihre Uhr aus der Komposition

Entscheidung vom 2026-11-16 für
[#7104](https://github.com/moto-ogs/project-phoenix/issues/7104). Sie wendet
[ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md) und
[ADR 0240](0240-stoppuhren-sind-keine-uhr-und-care-plan-bezieht-seine-uhr-aus-der-komposition.md)
auf die Anmeldung (`modules/enrollment`) und den Betreuungsvertrag
(`modules/carecontract`) an und führt keinen neuen Owner ein.

## Kontext

`TestModuleLiveClockRatchet` zählte in der Anmeldung 63 direkte Aufrufe von
`time.Now()` und `calendar.TodayDate()`, im Betreuungsvertrag 3. Die
Anwendungsdienste (Intake, Änderungsanträge, Entscheidungen, Löschung,
Aufbewahrung, Berichte, Übernahme, Phasen), die Schreibstempel des
Postgres-Speichers, die Handler und die Datei-Stempel lasen die echte Uhr,
obwohl `Decisions.deps.Today` und die Löschkomposition schon einen Tag
kannten. Die Komposition des Betreuungsvertrags band `time.Now` und
`calendar.TodayDate` selbst. Tests konnten deshalb keinen festen Tag setzen:
am 2029-06-04 war etwa der öffentliche Vertragstest rot, weil die Kurzbetreuung
mit letztem Tag 2028-01-31 dann zu Recht nicht mehr gebucht ist.
`calendarFixtureShiftedLiveDateDebt` führte sieben Testdateien der Anmeldung
mit 29 verschobenen Live-Daten.

## Entscheidung

1. **Anmeldung.** Die Abhängigkeiten von Intake, Änderungsanträgen,
   Entscheidungen, Löschung, Aufbewahrung, Übernahme und Phasen tragen ein
   `Now func() time.Time`; Berichte hatten es schon. Wo ein Tag gebraucht wird
   und keiner gesetzt ist, ist er der Berliner Tag dieser Uhr. Der
   Postgres-Speicher stempelt `updated_at`, `reviewed_at`, die Anlage einer
   Nachmeldung und eines hochgeladenen Nachweises mit seiner Uhr
   (`NewClocked`), die Zeitmodelle einer neuen Ferienzeit gelten ab dem Tag
   der Anwendung. Ferienanmeldung und Prüfung der Ferienanmeldungen bekommen
   den Tag der Wurzel. Die Ressourcen der Handler
   tragen ein Feld `Now`; Exporte, Nachweise und Teilnehmerlisten stempeln
   damit ihre Erzeugungszeit. Die Mail der Schließtage bekommt ihren Tag von
   der Wurzel. Die Wurzel reicht `RootEnvironment.Now` weiter; ohne Uhr
   bleibt es die echte.
2. **Betreuungsvertrag.** Jede Kompositionsfunktion, die `time.Now` oder
   `calendar.TodayDate` band, nimmt die Uhr als Parameter. Der Posteingang
   datiert die Widerrufsfrist und stempelt die Belehrung mit ihr.
3. **Keine Uhr:** Die Frist einer Anfrage (`DatabaseFailures.requestEnded`)
   ist ein Zeitpunkt der Laufzeituhr des Kontexts. Sie wird mit
   `time.Until` auf derselben Uhr gemessen, nie auf einer injizierten.
   Die Speicher-Messungen der Angebotsauswahl nehmen die gemessene Dauer
   (ADR 0240 Punkt 1).
4. **Eine Uhr je Entscheidung.** Die Phasen, die das Elternportal zur
   Anmeldung anbietet (`OpenPhaseCandidates`), prüfen ihr Fenster nicht mehr
   mit `NOW()` der Datenbank, sondern mit der Uhr des Speichers, auf der der
   Intake die Einreichung prüft. Ein hochgeladener Anmeldenachweis trägt
   `created_at` von derselben Uhr, mit der Einlösung und Aufräumen seine
   Frist messen. Ein Nachweis der Ferienanmeldung wird dagegen von der
   Datenbank gestempelt und eingelöst; das stündliche Aufräumen misst sein
   Alter jetzt ebenfalls dort statt mit `time.Now`.
5. **Budget.** Das Compose-LOC-Budget von `modules/enrollment/compose` steigt
   um die Zeilen der Uhrfelder (+9, 639 auf 648: `NewClocked`, `Now` der
   Phasen und des Löschmoduls und ihre `time`-Importe). Die Verdrahtung folgt
   ADR 0239 und ist keine abzubauende Altlast. Die Compose-Zeilen des
   Betreuungsvertrags bleiben gleich.

## Folgen

- Das Uhr-Budget verliert die Einträge `modules/enrollment` (63) und
  `modules/carecontract` (3); beide Owner rufen die Uhr nicht mehr direkt.
- `calendarFixtureShiftedLiveDateDebt` verliert alle sieben Einträge unter
  `modules/enrollment/` (29 Funde). Die Tests stehen auf festen Tagen und
  reichen ihre Uhr über dieselben Fabriken an die Dienste.
- Das Inventar der Command-Effects ändert sich nicht.
- Wo andere Owner im selben Test die echte Uhr oder `now()` der Datenbank
  lesen, bleibt der Test an deren Uhr gebunden; ihre Schnitte von #7104
  folgen in eigenen Pull Requests.
