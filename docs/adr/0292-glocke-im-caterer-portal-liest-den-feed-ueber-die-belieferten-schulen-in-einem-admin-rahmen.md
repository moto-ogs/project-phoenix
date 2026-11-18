---
status: proposed
---

# Glocke im Caterer-Portal liest den Feed über die belieferten Schulen in einem Admin-Rahmen

Vorschlag vom 18.11.2026 zu
[#7147](https://github.com/moto-ogs/project-phoenix/issues/7147), Teil der Spec
in [#7127](https://github.com/moto-ogs/project-phoenix/issues/7127). Er
überträgt
[ADR 0287](0287-glocke-im-traeger-portal-liest-den-feed-ueber-die-schulen-des-traegers-in-einem-admin-rahmen.md)
auf das Caterer-Portal und ergänzt
[ADR 0077](0077-the-caterer-is-an-identity-across-schools.md) um eine zweite
Lesestelle über Schulgrenzen. Er führt keinen neuen Owner und keine neue
Tabelle ein.

## Kontext

Die Spec verlangt eine Glocke im Caterer-Portal: Speiseplanänderungen und
Schließtage der Schulen, die der Caterer beliefert, damit er die Mengen
richtig plant. Live-Kanal und Push gibt es dort nicht; der Zähler lädt beim
Seitenwechsel und jede Minute neu.

Ein Feed-Eintrag gehört einem Konto in einer Schule,
`platform.notification_feed_entries` steht unter RLS pro Schule. Die
Caterer-Sitzung hat keine Schule (ADR 0077, Punkt 3). ADR 0077 erlaubt bisher
genau eine Lesestelle über Schulgrenzen, die Liste der Schulen des Caterers;
alles andere läuft in der Tenant-Transaktion einer Schule. Das Register der
Transaktionsgrenzen (`backend/test/transaction_boundaries.json`) wächst nur
mit eigener Entscheidung.

## Entscheidung

1. **Ein Eintrag je Schule und Konto.** Ein Caterer-Eintrag ist ein
   gewöhnlicher Feed-Eintrag in der Schule, um die es geht, mit dem Konto des
   Caterers und einem eigenen Typ des Portals `caterer`. Er entsteht in der
   Tenant-Transaktion des Auslösers (ADR 0145, #7148). Löschfrist und Löschung
   von Schule und Konto gelten unverändert.
2. **Der Empfängerkreis kommt aus Delivery.** Die Funktion
   `platform.delivery_caterer_feed_audience()` nennt in der Tenant-Transaktion
   einer Schule die aktiven Konten des Caterers, der die Schule gerade
   beliefert. Sie läuft als Aufruferin: die Anfragerolle liest die
   Belieferung ihrer Schule unter RLS.
3. **Ein Admin-Rahmen je Aufruf.** Delivery liest und markiert die Glocke
   eines Caterer-Kontos in genau einer Admin-Einheit
   (`modules/delivery/internal/notifications/caterer_feed.go`,
   `catererFeed.inAdminTx`): Seite und Zähler, ein Eintrag gelesen, alle
   gelesen.
4. **Die Grenze steht in jeder Anweisung.** Jede Anweisung verbindet den
   Eintrag mit `platform.delivery_caterer_feed_readers(Konto)`: nur Schulen
   mit laufender Belieferung durch den Caterer des Kontos, nur solange das
   Konto aktiv ist, nur die Typen des Caterer-Portals. Der Admin-Rahmen
   schreibt nur `read_at`.
5. **Kein Push, keine Live-Signale.** Wie im Träger-Portal.

## Folgen

- Die Grenze steht als geprüfte Ausnahme in
  `backend/test/caterer_feed_transaction.go`.
- Beendet eine Schule die Belieferung, verschwinden ihre Einträge beim
  nächsten Lesen, wie der Zugriff auf ihre Bestellungen sofort endet (ADR
  0077, Punkt 2); gelöscht wird nichts.
- Die Einträge nennen kein Kind und keine Person. Die Glocke zeigt neben
  jedem Eintrag den Namen der Schule.

## Verworfene Alternativen

- **Ein Tenant-Rahmen je belieferter Schule.** Wie die Bestellübersicht:
  bräuchte erst die Schulliste im globalen Identitätslesen und dann je Schule
  eine Transaktion. Der Zähler liefe bei jedem Seitenwechsel und jede Minute;
  seine Anweisungen wüchsen mit der Zahl der Schulen.
- **Lesen über eine Caterer-Policy auf der Feed-Tabelle.** Erweiterte die RLS
  der Tabelle über die Schule hinaus; die Spec verlangt, dass sie pro Schule
  bleibt.
