---
status: proposed
---

# Zuständigkeit je Schule ist Einstellung, die Stelle ist Stammdatum

Entscheidung vom 24.11.2026 zu
[#4811](https://github.com/moto-ogs/project-phoenix/issues/4811), Spec
[#4611](https://github.com/moto-ogs/project-phoenix/issues/4611). Sie folgt
[ADR 0086](0086-traeger-werte-liegen-zwischen-standard-und-schule.md),
[ADR 0088](0088-betreuungsvertrag-und-elternabrechnung-sind-eigene-owner-beim-traeger.md)
und [ADR 0112](0112-stammdaten-des-traegers-liegen-bei-organisation-und-tenancy.md) und
führt keinen neuen Owner ein. Neu sind eine Tabelle bei Organisation &
Tenancy, drei Einstellungen und eine Spalte am eingefrorenen Vertrags-PDF.

## Kontext

Wer Verträge schließt, abrechnet und Personal anstellt, ist je Schule
verschieden: der Träger, der Schulträger oder die Gemeinde. moto kannte nur
den Träger. Der Vertragspartner stand als Freitext in den Vertragsbedingungen,
der Absender kam immer aus dem Briefkopf des Trägers, und die Personalakte
nannte keinen Arbeitgeber.

Zwei Regeln begrenzen den Entwurf. ADR 0086 §1 lässt im Settings-System nur
skalare Werte zu und nennt Bankverbindungen samt Gläubiger-ID ausdrücklich als
fachliche Objekte. ADR 0086 §6 lässt eine Schul-Abweichung nur die Schule
selbst schreiben; das Träger-Büro geht dafür über „In OGS wechseln“.

## Entscheidung

1. **Drei Einstellungen mit Träger-Wert und Schul-Abweichung.**
   `responsibility.contracts`, `responsibility.billing` und
   `responsibility.staff` haben die Werte `traeger`, `schultraeger`,
   `gemeinde`, den Standard `traeger` und die Ebene `beide`. Der Träger legt
   den Wert für alle Schulen fest, eine Schule kann abweichen. Geschrieben
   wird mit „Einstellungen“ (Träger) und `config:manage` (Schule). Jede
   Änderung steht im Settings-Audit der jeweiligen Ebene. Es gibt keinen neuen
   Schreibweg des Trägers in die Schul-Einstellungen.
2. **Die Stelle ist Stammdatum bei Organisation & Tenancy.**
   `platform.school_responsible_parties` hält je Schule höchstens einen
   Schulträger und eine Gemeinde: Name, Anschrift, Ansprechperson und für die
   Abrechnung Gläubiger-ID und Bankverbindung. Die Zeile gehört dem Träger,
   steht unter der Träger-Policy auf `app.current_org_id` (ADR 0105) und nennt
   ihre Schule ohne Fremdschlüssel, wie `parent_billing.care_tariffs`. Lesen
   braucht „Übersicht lesen“, Schreiben „Einstellungen“. Jedes Lesen der
   Übersicht und jede Änderung steht im Stammdaten-Protokoll (Gegenstand
   `school_party`). Die Schule liest die Zeilen nie (ADR 0112).
3. **Ohne Stammdaten bleibt der Träger zuständig.** Nennt die Einstellung
   eine Stelle, zu der die Schule keine Stammdaten hat, ist der Träger
   wirksam zuständig; für die Abrechnung auch, solange Gläubiger-ID oder
   Bankverbindung fehlen. So steht nie eine Stelle ohne Anschrift auf einem
   Dokument, und eine Einstellung kann nicht blockieren. Die Regel steht an
   einer Stelle (`organizationtenancy.EffectiveBody`); die Träger-Oberfläche
   zeigt Wahl und Wirkung nebeneinander.
4. **Lesen über einen Port mit Sammelabfrage.** Organisation & Tenancy
   liest die drei Einstellungen aller gefragten Schulen über den eigenen Port
   `SchoolResponsibilitySettings`. Die Wurzel bindet ihn an
   `ResolveManyForTenants` in einer eigenen Admin-Einheit, weil die
   Träger-Transaktion Schul-Einstellungen nicht sieht (ADR 0105, wie die
   Mensa-Aufbewahrung in #4686). Verbraucher lesen
   `ResponsibleParties(ctx, träger, bereich, schulen)`; gefragt wird nur für
   Schulen des Trägers.
5. **Verträge.** Die für „Verträge“ zuständige Stelle ist Absender neuer
   Betreuungsverträge: Name und Anschrift ersetzen den Absender des
   Briefkopfs, ihre Ansprechperson die des Trägers; Logo und Fußzeile des
   Trägers entfallen. Der Vertragspartner bleibt, was die Vertragsbedingungen
   nennen (ADR 0088), sonst die erste Zeile dieses Absenders. Care Contract
   liest die Stelle über den Port `SchoolIssuers`.
6. **Das eingefrorene PDF hält seine Stelle fest.**
   `care_contract.contract_documents.issuer` speichert Absender und Kontakt
   der Stelle, die das PDF ausgestellt hat; `NULL` ist der Träger. Mails,
   Erinnerungen, die Unterschriftsseite samt Widerrufsbelehrung und die
   Bestätigungen eines verschickten Vertrags nennen diese Stelle. Ein Wechsel
   der Zuständigkeit ändert damit keinen ausgestellten Vertrag.
7. **Personal.** Die Personalakte nennt je Einsatzort den Arbeitgeber, wenn
   es nicht der Träger ist (Port `TraegerStaffEmployers`).
8. **Abrechnung und Lohnexport lesen die Einstellung noch nicht.**
   Rechnungen, Bescheide und Lastschriften brauchen den Rechnungssteller aus
   ADR 0088 §4 (Mandate, Nummernkreise und PAIN.008 je Gläubiger); der
   Lohnexport je Arbeitgeber ändert ADR 0089 §4. Beides sind eigene Tickets
   ([#8040](https://github.com/moto-ogs/project-phoenix/issues/8040),
   [#8041](https://github.com/moto-ogs/project-phoenix/issues/8041)). Die
   Einstellung „Abrechnung“ sagt in ihrer Beschreibung, dass die Schreiben
   bis dahin über den Träger laufen.

## Verworfene Optionen

- **Stelle als Einstellung (Name, Anschrift, IBAN als Schlüssel).** ADR 0086
  §1 schließt das aus; es gäbe weder Lesen-Protokoll noch Feldprüfung.
- **Zuständigkeit als eigene Tabelle bei Organisation & Tenancy.** Das wäre
  ein zweiter Weg für „Träger-Wert mit Schul-Abweichung“ neben ADR 0086, mit
  eigenem Audit und eigener Herkunftsanzeige.
- **Der Träger schreibt die Schul-Abweichung direkt.** Widerspricht ADR 0086
  §6; die Träger-Seite zeigt die Abweichung und führt in die Schule.
- **Stellen je Träger mit Zuordnung zur Schule.** Spart doppelte Eingabe,
  wenn mehrere Schulen dieselbe Gemeinde haben, braucht aber eine zweite
  Liste und eine Zuordnung. Das Ticket verlangt die Angaben je Schule.
- **Nur den Absender der Abrechnung tauschen.** Das Schreiben nennte das
  Konto der Gemeinde, die Lastschrift zöge mit der Gläubiger-ID des Trägers
  ein.
- **Absender eines verschickten Vertrags live lesen.** Dann zeigte die
  Unterschriftsseite nach einem Wechsel eine andere Stelle als das PDF.

## Folgen

- Der Tab „Zuständigkeiten“ erscheint auch in den Einstellungen jeder
  Schule; die Beschreibung sagt, dass das Träger-Büro die Angaben der Stelle
  einträgt.
- Die Demo-Löschung lässt `platform.school_responsible_parties` beim
  Demo-Träger stehen, wie seine übrigen Stammdaten (ADR 0271); das Register
  der Ausnahmen wächst um einen Eintrag.
- Die Vertragsbedingungen einer Schule zeigen in der Widerrufsbelehrung des
  Anmeldeformulars die Anschrift der zuständigen Stelle.
- Zieht eine Schule zu einem anderen Träger, bleiben die Zeilen beim alten
  Träger und werden nicht mehr gelesen.
