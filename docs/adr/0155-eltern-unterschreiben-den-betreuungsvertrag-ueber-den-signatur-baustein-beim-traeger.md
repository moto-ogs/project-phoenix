---
status: accepted
---

# Eltern unterschreiben den Betreuungsvertrag über den Signatur-Baustein beim Träger

Freigegeben von Yannick Wenger am 07.11.2026

Vorschlag vom 06.11.2026 zu [#4679](https://github.com/moto-ogs/project-phoenix/issues/4679),
Etappe 2 der Spec [#4611](https://github.com/moto-ogs/project-phoenix/issues/4611).
Er setzt die Entscheidung B + D aus #4679 um (einfache elektronische Signatur
und Papier, keine QES nach #3740) und baut auf
[ADR 0153](0153-betreuungsvertrag-entsteht-im-traeger-buero-aus-der-angenommenen-anmeldung.md)
und ADR 0088 §3 auf.

## Kontext

- Der Unterschrift-Baustein der Audit Platform (#4785) speichert Bild,
  Unterzeichner, Zeitpunkt, Prüfsumme des Dokuments und einen Record-Hash in
  `audit.signatures`. Die Tabelle ist an eine Schule gebunden (Tenant-Policy,
  Bezug Kind oder Anmeldung).
- Ein Betreuungsvertrag lebt beim Träger (ADR 0088, ADR 0105). Keine
  Transaktion trägt Schule und Träger zugleich. Ein Vertrag hat nicht immer
  ein Kind im Tenant.
- Eltern unterschreiben in der Eltern-App oder ohne Konto über die Mail.
  Online geschlossene Verträge sind Fernabsatzverträge mit Widerrufsrecht
  (Recherche in #4679).
- #4680 schließt einen Vertrag bei der Annahme ab und legt dafür den
  Übergang `versendet` → `aktiv`, Version `beantragt` → `wirksam` an.

## Entscheidung

1. **Baustein beim Träger.** Die Audit Platform bekommt
   `audit.traeger_signatures` mit Träger-Policy, denselben Prüfungen
   (`ParseSignatureImage`) und demselben Record-Hash. Bezug ist die
   Vertragsversion; mit ihr geht die Signatur. Der Ledger entscheidet keine
   Berechtigung. `care-contract` erreicht ihn über seinen Port
   `SignatureLedger`, die Root bindet ihn.
2. **Abschluss.** `care_contract.contract_signatures` hält je Version
   Verfahren (gezeichnet, getippt, Papier), Weg (Elternkonto, Mail-Link,
   Büro), Prüfsumme der strukturierten Version und des eingefrorenen PDFs,
   Zeitpunkt der Widerrufsbelehrung und den Wunsch nach Beginn in der
   Widerrufsfrist. Eine Signatur je Version; eine geänderte Version
   unterschreibt neu (#4816). Die Unterschrift schließt den versendeten
   Vertrag über den einen Übergang von #4680 ab (`concludeContract`):
   `aktiv` mit `concluded_at` und `conclusion_method` (`einfach_elektronisch`
   online, `papier` auf Papier), die Version `wirksam`. So gilt
   `chk_contracts_active_concluded` aus 1.15.773 auch für unterschriebene
   Verträge; die Migration 1.15.790 hängt von 1.15.773 ab.
3. **Einmaliger Mail-Link.** `<Träger>.<Token>`, gespeichert wird nur der
   SHA-256 des Tokens. Der Link nennt einen Vertrag und das PDF, mit dem er
   ging, gilt 30 Tage und einmal. Lesen verbraucht ihn nicht; nur die
   Unterschrift schließt ihn. Jeder Versand und jede Erinnerung bringt einen
   neuen Link.
4. **Eltern-App.** Der Workflow `parent-portal` prüft die Beziehung mit
   `parent_portal.enrollment.submit` je Kind; der Vertrag muss an die Adresse
   des Kontos gegangen sein. Die Ansicht des Vertrags reicht der Workflow
   unverändert durch, damit Mail-Link und Eltern-App dieselbe Quelle lesen.
5. **Papier.** Das Träger-Büro lädt das unterschriebene PDF hoch (Größe,
   Endung, Inhalt). Ein Entwurf wird dabei eingefroren und gilt als
   übergeben. Beim Download öffnet `PaperDocument` die Träger-Transaktion
   selbst und beendet sie vor dem Eintrag im Schulzugriffsprotokoll über
   `logSchools` (ADR 0088 Abschnitt 7). Ohne diesen Eintrag wird kein PDF
   ausgeliefert. Die Grenze steht in beiden Transaktionsregistern.
6. **Erinnerung.** Träger-Einstellung `care_contract.signature_reminder_days`
   (Standard 7, 0 = keine), höchstens drei Erinnerungen. Der Worker-Job
   läuft je Träger in dessen Transaktion.
7. **Register.** Die Port-Adapter der Root und die Durchreichungen des
   Workflows stehen mit dieser Entscheidung im Pass-Through-Register; die
   Bindungen im Command-Effects-Register.

## Verworfene Optionen

- **`audit.signatures` um eine Organisation erweitern:** ändert eine
  Tabelle mit Tenant-Policy, Fremdschlüsseln auf Schule und Kind und vielen
  Lesern; zwei Policies auf einer Tabelle sind schwerer zu prüfen.
- **Signatur in der Tenant-Transaktion der Schule speichern:** Abschluss
  und Signatur kämen nicht in eine Transaktion (ADR 0105).
- **Link als Klartext speichern:** ein Datenbank-Leser könnte jeden Vertrag
  unterschreiben.
- **QES:** kein Rechtsgewinn für formfreie Verträge, Kosten je Signatur
  (#3740).

## Folgen

- #4816 legt für eine neue Version eine neue Signatur an; der Unique-Key je
  Version bleibt.
- Eine kundenspezifische Schriftform ersetzt die einfache Signatur nicht; das
  prüft das Onboarding.

## Nachtrag 2026-11-24: Einfrieren bei der Übergabe auf Papier (#8030)

Ersetzt den zweiten Satz von §5. Entschieden in
[#8030](https://github.com/moto-ogs/project-phoenix/issues/8030), entstanden
aus #7904 und #7934.

- **Problem.** Das PDF wurde erst beim Hochladen des Scans eingefroren und
  dafür neu gerendert, mit Briefkopf, Brieftext, Branding und Stammdaten
  dieses Tages. Änderte jemand sie zwischen Druck und Hochladen, belegten das
  gespeicherte PDF und `document_sha256` einen Text, den die Familie nie
  unterschrieben hat. Die Vorschau speichert nichts; einen alten Ausdruck
  kann niemand nachbauen.
- **Entscheidung.** Die Papierunterschrift bindet die Fassung, die das Büro
  übergeben hat. `POST /traeger/contracts/{id}/paper-handover`
  (`HandOverOnPaper`) sperrt die Zeile, friert das PDF ein wie ein Versand
  (mit Briefkopf-Pflicht nach #7177) und markiert einen Entwurf als
  `versendet`, ohne Mail, Link und Eintrag in `contract_mailings`. Damit
  löst die Übergabe keine Erinnerung aus. Die Spur hält `send` mit
  `via: office`. Das Büro lädt danach genau dieses PDF über
  `GET /{id}/document`. Ein schon versendeter Vertrag behält sein PDF.
- **Hochladen.** `RecordPaperSignature` nimmt nur einen versendeten Vertrag
  mit eingefrorenem PDF der aktuellen Version und rendert nichts. Ein
  Entwurf antwortet mit dem bestehenden `care_contract.contract_not_signable`.
- **Verworfen.** Ein Lesestand-Token nach ADR 0311 beim Hochladen: er belegt
  nur den Stand beim Hochladen, nicht den Ausdruck.
