---
status: accepted
---

# Rechnungssteller ist die Stelle der Abrechnung, erkannt an ihrer Gläubiger-ID

Entscheidung vom 24.11.2026 zu
[#8040](https://github.com/moto-ogs/project-phoenix/issues/8040), Spec
[#4611](https://github.com/moto-ogs/project-phoenix/issues/4611). Die
Grundsatzfrage hat der Product Owner am 24.11.2026 im Ticket entschieden:
Beide Fälle müssen gehen, die Einstellung „Abrechnung“ je Schule wählt. Dieses
ADR entscheidet die Detailfragen aus „Offene Entscheidungen“. Es löst
[ADR 0119](0119-abrechnungslauf-stellt-unveraenderliche-rechnungen-aus-einem-nummernkreis-aus.md)
Punkt 5 („bis er kommt, ist der Träger der Rechnungssteller“) und
[ADR 0318](0318-zustaendigkeit-je-schule-ist-einstellung-die-stelle-stammdatum.md)
Punkt 8 ab und setzt den Rechnungssteller aus
[ADR 0088](0088-betreuungsvertrag-und-elternabrechnung-sind-eigene-owner-beim-traeger.md)
§4 um. Es führt keinen Owner und keine Tabelle ein.

## Kontext

Die Elternabrechnung kannte genau einen Rechnungssteller je Träger: eine
Gläubiger-ID (`parent_billing.sepa_creditors`), ein gültiges Mandat je
Familie (`uq_sepa_mandates_in_force`), einen Nummernkreis je Leistung, eine
Dokumentart je Leistung und eine Lastschriftdatei je Lauf mit dem Konto des
Trägers. Seit ADR 0318 nennt die Einstellung `responsibility.billing` je
Schule den Träger, den Schulträger oder die Gemeinde, und
`platform.school_responsible_parties` hält deren Gläubiger-ID und Konto.

Ein SEPA-Mandat gilt nur für den Gläubiger, dem es erteilt wurde (SEPA
Core Rulebook, Mandat mit Gläubiger-ID und Mandatsreferenz). Nur den Absender
zu tauschen hieße: Das Schreiben nennt das Konto der Gemeinde, die Lastschrift
zieht mit der Gläubiger-ID des Trägers auf das Konto des Trägers ein.

## Entscheidung

1. **Der Rechnungssteller eines Dokuments ist die Stelle, die für seine
   Schule wirksam „Abrechnung“ hat.** Das ist der Träger oder ein
   Schulträger bzw. eine Gemeinde mit Stammdaten, Gläubiger-ID und Konto
   (ADR 0318 §3, `EffectiveBody`). Fehlt der Stelle eines davon, rechnet der
   Träger ab, wie bisher. Es gibt keinen Zwischenstand, der nur den Absender
   tauscht: Wer abrechnet, ist Absender, Gläubiger, Kontoinhaber und
   Nummerngeber zugleich.
2. **Ein Rechnungssteller wird an seiner Gläubiger-ID erkannt.** Der
   Schlüssel `issuer_key` ist leer für den Träger und sonst die Gläubiger-ID
   der Stelle. Schulen, deren Stelle dieselbe Gläubiger-ID hat, haben einen
   Rechnungssteller: einen Nummernkreis, ein Mandat je Familie und eine
   Lastschriftdatei. Die Gläubiger-ID ist rechtlich die Kennung des
   Gläubigers; zwei Nummernkreise für denselben Gläubiger könnten dieselbe
   Nummer zweimal vergeben. Eine Gläubiger-ID gehört deshalb zu genau einem
   Konto: Organisation & Tenancy lehnt eine Stelle ab, die die Gläubiger-ID
   einer anderen Schule mit anderer IBAN, BIC oder anderem Kontoinhaber
   eintragen will (`traeger.school_party_creditor_account_conflict`). Alle
   Schulen einer Gläubiger-ID drucken Absender und Konto ihrer Schule mit
   der kleinsten ID, damit Schreiben, Datei und Nachrichten-ID bei jedem
   Lesen gleich sind.
3. **Welche Schule ein Dokument hat.**
   - Monatsrechnung, Storno und Jahresbescheid: der Betreuungsort ihres
     Vertrags. Ein Änderungsbescheid behält den Rechnungssteller des
     Bescheids, den er ändert, wie ein Storno den seiner Rechnung.
   - Ferien: die Schule, die das Kind besucht (Heimatschule); ein Feriengast
     ohne Schule des Trägers hat die ausrichtende Schule seiner ersten
     gebuchten Woche, wie der Betreuungsort seines Vertrags (ADR 0088 §2).
     Haben die Kinder einer Anmeldung verschiedene Rechnungssteller, bekommt
     jedes Kind ein eigenes Dokument, auch wenn der Träger sonst eine
     Rechnung je Anmeldung schreibt (Form von #7007). Eine Anmeldung, die
     schon eine Rechnung hat, behält ihre Form; ihr neues Dokument hat den
     Rechnungssteller ihres ersten Kindes.
   Eine Familie mit Kindern an zwei Schulen verschiedener Rechnungssteller
   bekommt deshalb zwei Dokumente und braucht zwei Mandate. Eine Regel „ein
   Rechnungssteller je Familie“ gibt es nicht: Sie hieße, dass eine Stelle
   für eine Schule abrechnet, für die sie nicht zuständig ist.
4. **Das ausgestellte Dokument hält seinen Rechnungssteller fest.** Die
   Freigabe kopiert Absender, Ansprechperson, Konto und Gläubiger-ID der
   Stelle in `issuer` (JSONB, `NULL` ist der Träger) und den Schlüssel in
   `issuer_key` von `documents`, `care_invoices`,
   `care_invoice_cancellations` und `care_notices`. Schreiben, Storno,
   Gutschrift, Vorabankündigung und Postfach lesen diese Kopie. Storno und
   Gutschrift nehmen Rechnungssteller und Nummernkreis ihrer Rechnung. Ein
   Wechsel der Einstellung oder der Stammdaten wirkt nur auf Dokumente, die
   danach freigegeben werden; eine Neuausstellung nach einem Storno ist ein
   neues Dokument und folgt dem Rechnungssteller von heute. Der Fingerabdruck
   der Prüfphase enthält den Rechnungssteller jeder Rechnung: Ändert er sich
   zwischen Prüfung und Freigabe, lehnt die Freigabe ab
   (`parent_billing.billing_run_changed`).
5. **Nummernkreis je Rechnungssteller und Leistung** (ADR 0088 §4).
   `number_ranges`, `number_range_counters` und `number_range_starts` tragen
   `issuer_key`; die Eindeutigkeit der Nummern gilt je Träger und
   Rechnungssteller. Hat ein Rechnungssteller für eine Leistung kein Muster,
   lehnt die Freigabe ab (`parent_billing.number_range_missing` mit dem
   Rechnungssteller in `details`). Ein stilles Ausweichen auf das Muster des
   Trägers gibt es nicht: Zwei Stellen hätten sonst dieselben Nummern.
6. **Dokumentart je Rechnungssteller und Leistung** (#4688). Der Träger
   behält seine Voreinstellung (Ferien Bestätigungsschreiben, Monat
   Rechnung). Schulträger und Gemeinde stellen ohne eigene Wahl einen
   Gebührenbescheid aus, beides ist je Leistung änderbar. Die Vorlage
   „Bescheid“ mit ihrer Rechtsbehelfsbelehrung bleibt je Träger (ADR 0152);
   der Platzhalter für den Absender nennt den Rechnungssteller des
   Dokuments. Fehlt die Rechtsbehelfsbelehrung, lehnt die Freigabe wie bisher
   ab. Eigene Vorlagen je Stelle sind nicht Teil dieses Tickets: Die
   Vorlagen gehören Organisation & Tenancy, und ein Editor je Stelle wäre ein
   eigenes Vorhaben.
7. **Ein Mandat gilt je Familie und Gläubiger-ID.**
   `uq_sepa_mandates_in_force` wird `(organization_id, family_email,
   creditor_id)`. Ein neues Mandat (Büro, Import, Elternportal) bekommt die
   Gläubiger-ID des Rechnungsstellers seines Vertrags; das Elternportal und
   der Mandatstext nennen dessen Namen und Gläubiger-ID. Bestehende Mandate
   bleiben beim Träger gültig. **Übergang:** Wechselt eine Schule zu einer
   Stelle, braucht jede Familie, die per Lastschrift zahlt, ein neues Mandat
   für die Stelle. moto überträgt kein Mandat: Ohne neue Erklärung der
   Familie wäre das kein Mandat für den neuen Gläubiger, und eine
   Gläubiger-Änderung im SEPA-Verfahren setzt eine Rechtsnachfolge voraus,
   die hier fehlt. Bis das neue Mandat vorliegt, gilt für die Rechnungen der
   Stelle die Wahl des Trägers bei fehlendem Mandat (Überweisung mit Hinweis
   oder Freigabe gesperrt). Die Seite „Zuständigkeiten“ zählt je Stelle die
   Familien, denen das Mandat fehlt.
8. **Eine Lastschriftdatei je Lauf und Rechnungssteller** (ADR 0181, ADR
   0187). Die Lastschriften und Raten eines Laufs werden nach dem
   Rechnungssteller ihrer Rechnung oder ihres Bescheids geteilt; Datei,
   Übersicht und Bestätigung nehmen den Parameter `issuer` (die Gläubiger-ID
   der Stelle, leer für den Träger), die Antwort nennt in `issuers` jede
   Stelle mit Lastschriften im Lauf. Die Datei des Trägers trägt seine
   Gläubiger-ID und sein Standardkonto, die Datei einer Stelle ihre
   Gläubiger-ID und ihr Konto von heute; rechnet die Stelle nicht mehr ab,
   das Konto, das ihre Schreiben nannten. Die Nachrichten-ID bindet
   Gläubiger-ID und Konto. Eine Lastschrift wird für die Gläubiger-ID ihres
   Rechnungsstellers eingezogen; ein Mandat für eine andere bleibt mit
   „Gläubiger-ID geändert“ draußen. Vorabankündigungsfrist und die Wahl bei
   fehlendem Mandat bleiben Werte des Trägers. Die Übergabe an einen
   Empfänger (ADR 0218) gibt es nur für die Datei des Trägers: Eine Stelle
   reicht ihre Datei bei ihrer eigenen Bank ein.
9. **Finanzexporte nur für den Träger.** Sollstellung und
   DATEV-Buchungsstapel eines Laufs enthalten nur die Belege des Trägers.
   Eine Stelle bucht in ihrem eigenen Haushalt; ihre Forderungen gehören
   nicht in die Bücher des Trägers. Ein Export für die Stelle braucht eine
   Fachentscheidung (Konten, Kostenstellen und Format je Stelle) und ist ein
   eigenes Ticket (#8058).
10. **Wer die Gläubiger-ID hält** (Rechtsfrage aus ADR 0088): Wer abrechnet,
    hält seine eigene. Der Träger trägt seine bei „Lastschrift“ ein, die
    Stelle ihre in ihren Stammdaten. moto zieht nie mit der Gläubiger-ID
    einer Stelle auf das Konto einer anderen ein. Trägt eine Stelle die
    Gläubiger-ID des Trägers, lehnt jede Freigabe ab
    (`parent_billing.issuer_creditor_is_traegers`) und ihre Checkliste nennt
    es; der Träger kann die Gläubiger-ID einer Stelle nicht als seine
    speichern. Organisation & Tenancy kennt die Gläubiger-ID des Trägers
    nicht und kann die Stelle beim Speichern nicht prüfen; die Freigabe ist
    die Stelle, an der es zählt.
11. **Oberfläche.** Die Seite „Zuständigkeiten“ und der Reiter einer Schule
    zeigen je Stelle, die selbst abrechnet, eine Checkliste: Anschrift,
    Gläubiger-ID und Konto, Nummernkreise, Dokumentart mit
    Rechtsbehelfsbelehrung und die Familien mit Lastschrift für die
    Monatsbeiträge ohne gültiges Mandat für
    die Stelle. Die Route `GET /traeger/required-details/issuers` liefert
    sie; sie zählt Familien und nennt keine. Nummernkreise und Dokumentarten
    der Stellen stehen auf ihren Einstellungsseiten unter denen des Trägers.
    Die bestehenden Listen der Nummernkreise und Dokumentarten lesen keine
    Stellen: Ihr Abfragebudget bleibt, wie es ist. Der Hinweis „laufen
    weiter über den Träger“ entfällt. Die Einstellung bleibt unverändert
    wählbar.
12. **Lesen.** Die Elternabrechnung liest die Rechnungssteller über ihren
    Port `BillingIssuers`, den die Wurzel an
    `organizationtenancy.ResponsibleParties` bindet (ADR 0318 §4). `nil` als
    Schulliste fragt alle Schulen des Trägers. Kein Import zwischen den
    Owners, keine neue Regel in der Policy.

## Verworfene Optionen

- **Nur den Absender tauschen.** Vom Product Owner ausgeschlossen; Konto und
  Lastschrift passten nicht zum Schreiben.
- **Rechnungssteller je Schule und Stelle statt je Gläubiger-ID.** Zwei
  Schulen derselben Gemeinde hätten zwei Nummernkreise und könnten dieselbe
  Nummer vergeben; das Mandat einer Familie gälte trotzdem für beide, weil
  es an der Gläubiger-ID hängt.
- **Ein Rechnungssteller je Familie.** Eine Stelle rechnete für eine Schule
  ab, für die sie nicht zuständig ist.
- **Ferien nach der ausrichtenden Schule jeder Woche teilen.** Rabatte,
  Korrekturen, Gutschriften und Neuausstellung hängen am Kind; eine Woche
  je Dokument hätte jede dieser Regeln geteilt. Die Heimatschule folgt dem
  Betreuungsort des Vertrags.
- **Mandate beim Wechsel übertragen.** Kein Mandat ohne Erklärung der
  Familie für den neuen Gläubiger.
- **Muster des Trägers als Rückfall für eine Stelle.** Gleiche Nummern bei
  verschiedenen Gläubigern.
- **Eine Lastschriftdatei mit mehreren Gläubigern** (mehrere `PmtInf`). Das
  Schema erlaubt es, aber jede Stelle reicht bei ihrer eigenen Bank ein.
- **Die Belege einer Stelle in Sollstellung und DATEV des Trägers.** Der
  Träger buchte Forderungen, die ihm nicht gehören.

## Folgen

- Migration: `issuer_key` und `issuer` an den Belegen, `issuer_key` an
  Nummernkreis, Zähler, Startwerten und Dokumentart; die Eindeutigkeit der
  Nummern, der Muster und der Dokumentart je Rechnungssteller; das Mandat in
  Kraft je Gläubiger-ID. Bestehende Zeilen erhalten den leeren Schlüssel des
  Trägers und bleiben unverändert.
- Die Antwort der Lastschriftdatei nennt die Rechnungssteller des Laufs;
  Übersicht, Datei und Bestätigung nehmen den Parameter `issuer`.
- Sollstellung und DATEV des Trägers werden kleiner, sobald eine Stelle
  abrechnet; ein Export für die Stelle folgt mit #8058.
- Hilfe-Artikel „Zuständigkeiten“ beschreibt beide Fälle Schritt für
  Schritt.
