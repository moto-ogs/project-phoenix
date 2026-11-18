---
status: proposed
---

# Glocke im Träger-Portal liest den Feed über die Schulen des Trägers in einem Admin-Rahmen

Vorschlag vom 17.11.2026 zu
[#7146](https://github.com/moto-ogs/project-phoenix/issues/7146), Teil der Spec
in [#7127](https://github.com/moto-ogs/project-phoenix/issues/7127). Er folgt
[ADR 0249](0249-glocke-im-elternportal-liest-den-feed-des-kontos-in-einem-admin-rahmen.md)
und [ADR 0161](0161-gleiche-transaktionsrahmen-werden-gebuendelt-admin-geht-nur-einseitig-in-den-tenant.md)
und führt keinen neuen Owner und keine neue Tabelle ein.

## Kontext

Der Benachrichtigungs-Feed gehört Delivery (#7148). Ein Eintrag gehört einem
Konto in einer Schule, `platform.notification_feed_entries` steht unter RLS
pro Schule. Die Spec verlangt eine Glocke im Träger-Portal mit den Einträgen
aller Schulen des Trägers, jeweils mit dem Schulnamen. Die Abfrage soll nur
über die Schulen laufen, auf die das Träger-Konto Zugriff hat; die RLS bleibt
pro Schule.

Die Träger-Sitzung hat keine Schule. Ihr Träger-Rahmen (ADR 0105) lässt keine
Schultabelle zu, also auch den Feed nicht. Nach
[ADR 0084](0084-traeger-portal-liest-ueber-eine-projektion-und-schreibt-in-der-schule.md)
liest das Träger-Portal über Schulgrenzen in einer Admin-Transaktion mit
Filter auf die Schulen des Trägers. Das Register der Transaktionsgrenzen
(`backend/test/transaction_boundaries.json`) wächst nur mit eigener
Entscheidung.

## Entscheidung

1. **Ein Eintrag je Schule und Konto.** Ein Träger-Eintrag ist ein gewöhnlicher
   Feed-Eintrag in der Schule, um die es geht, mit dem Konto des
   Träger-Mitglieds und einem eigenen Typ des Portals `traeger`. Er entsteht in
   der Tenant-Transaktion des Auslösers (ADR 0145, #7148). Löschfrist und
   Löschung von Schule und Konto gelten unverändert.
2. **Der Empfängerkreis kommt aus Delivery.** Die Funktion
   `platform.delivery_traeger_feed_audience()` nennt in der Tenant-Transaktion
   einer Schule die aktiven Mitglieder ihres Trägers mit aktivem Konto. Sie
   läuft als Eigentümerin, weil die Anfragerolle die Mitgliedschaft nicht
   lesen darf, und antwortet nur für die Schule der Transaktion.
3. **Ein Admin-Rahmen je Aufruf.** Delivery liest und markiert die Glocke eines
   Träger-Mitglieds in genau einer Admin-Einheit
   (`modules/delivery/internal/notifications/traeger_feed.go`,
   `traegerFeed.inAdminTx`): Seite und Zähler, ein Eintrag gelesen, alle
   gelesen.
4. **Die Grenze steht in jeder Anweisung.** Jede Anweisung verbindet den Eintrag
   mit `platform.delivery_traeger_feed_readers`: nur Schulen des Trägers der
   Sitzung, nur solange das Konto dort aktives Mitglied mit aktivem Konto ist,
   nur die Typen des Träger-Portals. Der Admin-Rahmen schreibt nur `read_at`.
5. **Kein Push, keine Live-Signale.** Das Träger-Portal hat keine Geräte und
   keinen Live-Kanal. Der Zähler wird beim Seitenwechsel und jede Minute neu
   geladen.

## Folgen

- Die Grenze steht als geprüfte Ausnahme in
  `backend/test/traeger_feed_transaction.go`; jede weitere Grenze braucht
  eine eigene Entscheidung.
- Endet die Mitgliedschaft, verschwinden die Einträge beim nächsten Lesen;
  gelöscht wird nichts. Die Sitzung endet ohnehin beim nächsten Seitenwechsel
  (Sitzungsprüfung der Familie).
- Weitere Typen für den Träger (etwa Caterer- oder Speiseplan-Hinweise) melden
  sich mit dem Portal `traeger` an und erscheinen ohne weitere Grenze.

## Verworfene Alternativen

- **Lesen im Träger-Rahmen mit einer Träger-Policy auf der Feed-Tabelle.**
  Erweiterte die RLS der Tabelle über die Schule hinaus; die Spec verlangt,
  dass sie pro Schule bleibt.
- **Ein Tenant-Rahmen je Schule.** Bräuchte erst die Schulen des Trägers und
  dann je Schule eine Transaktion; mehr Grenzen und Anweisungen ohne
  zusätzlichen Schutz, weil die Prüfung ohnehin in jeder Anweisung steht.
- **Lesen über die Projektion `traeger-view`.** Der Feed gehört Delivery; eine
  zweite Lesestelle für dieselbe Tabelle gäbe ihm einen zweiten Besitzer.
