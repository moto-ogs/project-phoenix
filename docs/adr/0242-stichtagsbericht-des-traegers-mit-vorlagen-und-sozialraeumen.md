---
status: accepted
---

# Stichtagsbericht des Trägers mit Vorlagen und Sozialräumen

Entscheidung vom 15.11.2026 zu
[#4716](https://github.com/moto-ogs/project-phoenix/issues/4716), Spec
[#4611](https://github.com/moto-ogs/project-phoenix/issues/4611), User Stories
115 und 116. Sie folgt
[ADR 0154](0154-belegung-des-traegers-liest-gruppen-und-buchungen-ueber-die-fach-owner.md)
und [ADR 0241](0241-auslastung-des-traegers-liest-zeitreihen-ueber-die-fach-owner.md)
und führt keinen neuen Owner ein. Neu ist eine Tabelle bei Organisation &
Tenancy.

## Kontext

Kommune und Jugendamt wollen vom Träger Zahlen zu einem Stichtag: Kinder,
Betreuungsformen, Personal, Fehlzeiten und Nachfrage, je Standort und je
Sozialraum, in der Form, die das jeweilige Amt verlangt. Jedes Amt fragt
andere Abschnitte ab, und eine Kommune schneidet ihre Sozialräume je Bericht
anders. Die Zahlen liegen bei fünf Owners: Mitgliedschaft und Personal bei
School Membership, Buchungen bei Care Plan, Anmeldungen bei Enrollment,
Ein-Checken bei Student Presence, Krank- und Entschuldigt-Tage bei Care Plan.

## Entscheidung

1. **Berichtsvorlage bei Organisation & Tenancy.** `platform.traeger_report_templates`
   gehört dem Träger wie seine Stammdaten und Dokumentvorlagen (ADR 0112, ADR
   0152): Name (1 bis 120 Zeichen, je Träger eindeutig ohne Groß- und
   Kleinschreibung), Abschnitte (nicht leere Teilmenge von `children`,
   `staff`, `absences`, `demand`, in dieser Reihenfolge gespeichert), Stichtag
   des Jahres als Monat und Tag (29.02. zulässig) und die Sozialräume als
   Zuordnung Schule → Sozialraum (1 bis 80 Zeichen, jede Schule höchstens
   einmal, nur Schulen des Trägers). Die Vorlage enthält keine
   personenbezogenen Daten. Sie wird in der Träger-Transaktion geschrieben (ADR
   0105) und steht unter der Träger-Policy auf `app.current_org_id`. Lesen
   braucht „Berichte lesen“ (`traeger_reports:read`), Schreiben
   „Einstellungen“ (`traeger_settings:manage`). Jede Änderung steht im
   Stammdaten-Protokoll (Gegenstand `report_template`). Eine Schule, die den
   Träger verlassen hat, fällt beim Lesen aus den Sozialräumen.
2. **Sozialraum in der Vorlage, nicht an der Schule.** Eine Kommune teilt ihre
   Schulen je Bericht verschieden auf. Ein Sozialraum an der Schule hätte eine
   Aufteilung für alle Berichte erzwungen. Schulen ohne Zuordnung stehen unter
   „Ohne Sozialraum“, sobald die Vorlage mindestens einer Schule einen
   Sozialraum gibt; ohne jede Zuordnung gibt es keine Sozialräume.
3. **Bericht in der Projektion.** `traegerview.KeyDateReports` ist eine eigene
   Fassade neben `Overview` (die schon zwölf Methoden hat). Die Projektion
   liest in ihrer Admin-Einheit je Owner eine Abfrage für die ganze Schulmenge
   und nur für die Abschnitte, die der Bericht zeigt:
   - die Vorlage über den neuen Port `ReportTemplateReads`, an der Wurzel an
     eine Lesung von Organisation & Tenancy gebunden, die nur in der
     Admin-Einheit liest und auf den Träger filtert;
   - Roster und Personal über `SchoolRosters`, Betreuungsformen über die Ports
     der Belegung (ADR 0154), jetzt mit dem Stichtag statt heute;
   - Ein-Checken über `PresenceSeries` (ADR 0241);
   - Krank- und Entschuldigt-Tage über die neue Care-Plan-Lesung
     `StatusDayCountsByTenant` (je Kind und Tag einmal, Montag bis Freitag,
     Statustag „gilt für den Tag“ wie beim Dashboard);
   - offene und Wartelisten-Kinder über die neue Enrollment-Lesung
     `EnrollmentDemandByTenant`; das Dashboard liest seine offenen Kinder jetzt
     über dieselbe Abfrage.
   Jede neue Abfrage filtert mit `tenant_id = ANY(?)` und verweigert ohne die
   Admin-Einheit. Das Budget `api.traeger.reports_key_date` liegt bei 11
   Statements, flach in der Zahl der Schulen.
4. **Definitionen.** Sie stehen an `traegerview.KeyDateReport`: Kinder sind die
   Stichtagszahl (#2791) am Stichtag, Betreuungsformen folgen der Regel der
   Belegung, Personal die Mitglieder ohne gültigen Eintrag als externe Kraft.
   Der Fehlzeiten-Zeitraum beginnt am 1. August des Schuljahres des Stichtags
   (höchstens 365 Tage vorher) und endet am Stichtag, höchstens gestern. Die
   Fehlquote ist Krank- plus Entschuldigt-Tage über diese plus
   Anwesenheitstage. Plätze zählen nur aktive Betreuungsformen mit Grenze.
   Offene Anmeldungen und Warteliste gelten „Stand heute“, weil die Anmeldung
   keinen Statusverlauf speichert; Export und Seite nennen den Stand.
   Sozialraum und Summe werden aus den Schulzahlen addiert, Quoten aus den
   Summen neu gerechnet.
5. **Protokoll.** Der Bericht und sein Export tragen Zahlen und die Namen von
   Schulen, Sozialräumen und Betreuungsformen, keine Kinder und kein Personal.
   Sie stehen nach ADR 0084 Abschnitt 7 nicht im Zugriffsprotokoll.
6. **Export.** `GET /traeger/reports/key-date/export?format=pdf|xlsx|csv`
   rendert über die Listen-Vorlage von Document Rendering. Das übernimmt ein
   neuer Adapter `modules/traegerview/internal/adapters/reportexport` hinter
   dem Port `ReportRenderer` der Anwendung; die Komposition bindet ihn. Die
   Regeln `traeger-view.adapter.public` und
   `traeger-view.adapter.document-rendering-lists` erlauben nur diesem Adapter
   den Listen-Vertrag, wie `care-contract.adapter.document-rendering-lists`.
   Die HTTP-Schicht der Projektion bleibt beim öffentlichen Vertrag.
   Excel und CSV sind eine Tabelle für die Tabellenkalkulation: eine Zeile je
   Schule, je Sozialraum eine Summe, zuletzt „Gesamt“, danach die Kinder je
   Betreuungsform. Das PDF lesen Menschen bei Jugendamt und Kommune; eine
   Tabelle mit bis zu 18 Spalten bricht dort jede Überschrift. Es druckt
   deshalb im Block-Layout des Vertrags (`RenderRecords`) eine Karte je
   Schule mit einer Zeile je Abschnitt und den Betreuungsformen darunter,
   gruppiert nach Sozialraum mit einer Karte für dessen Summe.
7. **Register.** `api/traeger_report_ports.go` übersetzt die Vorlage in das
   Vokabular der Projektion (Pass-through-Register `roots`). Die Konstruktoren
   heben das Compose-Budget von `modules/organizationtenancy/compose` um 5 und
   von `modules/traegerview/compose` um 1 Zeile. Die Tabelle steht im
   Lebenszyklus-Katalog, im Rückgabe-Register und als Ausnahme der
   Demo-Löschung (nur das Träger-Büro des Demo-Trägers schreibt sie).

## Verworfene Optionen

- **Sozialraum als Stammdatum der Schule:** eine Aufteilung für alle Ämter;
  die Kommune bräuchte für jeden Bericht eine Kopie der Schule.
- **Bericht „je Träger“ für eine Kommune über mehrere Träger:** Der Träger ist
  die Mandantengrenze des Träger-Portals (ADR 0084). Eine Kommune mit mehreren
  Trägern bekommt je Träger einen Bericht; eine trägerübergreifende Sicht
  bräuchte eine eigene Rolle und Rechtsgrundlage und ist nicht Teil dieser
  Entscheidung.
- **Offene Anmeldungen zum Stichtag:** setzt einen Statusverlauf der Anmeldung
  voraus, den Enrollment nicht führt.
- **Rendern in der HTTP-Schicht der Projektion:** hätte der HTTP-Rolle einen
  zweiten Fremd-Owner gegeben; der Adapter hält den Listen-Vertrag an einer
  Stelle.

## Folgen

- Ein Stichtag in der Vergangenheit liest Mitgliedschaft und Personal, wie sie
  heute stehen (Status und `enrolled_until`), wie die Stichtagszahl. Ein
  gelöschtes Kind oder Personal zählt nicht rückwirkend.
- Anwesenheit reicht nur so weit zurück wie `gdpr.attendance_retention_days`;
  der Bericht nennt je Schule den ersten Tag mit Daten (`attendance_from`).
- Den Filter der neuen Abfragen sichert
  `api/traeger_key_date_report_test.go` mit einer Schule und einer Vorlage
  eines anderen Trägers.
